import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { getAuthenticatedToolUser } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { appendHistory, buildUploadDetail } from "@/lib/storage/spec-history";
import { buildVersionedFileName } from "@/lib/spec/versioned-filename";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";
import {
  listSpecCsvFilesUnderPrefix,
  maxVersionByDisplayName,
} from "@/lib/storage/spec-inventory";

function isPreconditionFailure(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: number; message?: string };
  if (err.code === 412) return true;
  return typeof err.message === "string" && err.message.includes("Precondition Failed");
}

/** 지수 백오프 + 랜덤 지터: attempt 0→skip, 1→0~100ms, 2→0~200ms, ... (최대 500ms) */
function jitterDelay(attempt: number): Promise<void> {
  if (attempt === 0) return Promise.resolve();
  const ms = Math.random() * Math.min(100 * attempt, 500);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { email } = await getAuthenticatedToolUser(req);

    const form = await req.formData();
    const folder = (form.get("folder") as string | null)?.trim() ?? "";
    if (!folder) {
      return NextResponse.json({ ok: false, error: "folder is required" }, { status: 400 });
    }

    const normalizedFolder = folder.endsWith("/") ? folder : `${folder}/`;
    assertSafeStorageRelativePath(normalizedFolder.slice(0, -1) || "root");

    const files = form.getAll("files") as File[];
    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "files is required" }, { status: 400 });
    }

    // overwriteVersions: 파일과 1:1 대응. 값이 있으면 해당 버전으로 덮어쓰기, 없으면 새 버전
    const overwriteVersionsRaw = form.getAll("overwriteVersions") as string[];
    const overwriteVersions: (number | null)[] = files.map((_, i) => {
      const v = overwriteVersionsRaw[i];
      const n = v ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : null;
    });

    const bucket = getSpecBucket();

    // 새 버전 파일만 폴더 스캔 (덮어쓰기는 버전 고정)
    const needsScan = overwriteVersions.some((v) => v === null);
    const maxByName: Record<string, number> = {};
    if (needsScan) {
      const existing = await listSpecCsvFilesUnderPrefix(bucket, normalizedFolder);
      Object.assign(maxByName, maxVersionByDisplayName(existing, normalizedFolder));
    }

    const uploaded: { displayName: string; storedName: string; version: number }[] = [];
    const MAX_RETRIES = 10;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      assertSafeStorageRelativePath(file.name);
      const fixedVersion = overwriteVersions[i];
      const buffer = Buffer.from(await file.arrayBuffer());

      if (fixedVersion !== null) {
        // 덮어쓰기 모드: 버전 고정이므로 동시성 문제 없음
        const storedName = buildVersionedFileName(file.name, fixedVersion);
        const path = `${normalizedFolder}${storedName}`;
        await bucket.file(path).save(buffer, {
          contentType: file.type || "text/csv; charset=utf-8",
          resumable: false,
          metadata: { contentType: file.type || "text/csv; charset=utf-8" },
        });
        uploaded.push({ displayName: file.name, storedName, version: fixedVersion });
      } else {
        // 새 버전 모드: ifGenerationMatch:0으로 원자적 쓰기, 충돌 시 지터 후 재스캔하여 재시도
        let saved = false;
        for (let attempt = 0; attempt < MAX_RETRIES && !saved; attempt++) {
          await jitterDelay(attempt);
          if (attempt > 0) {
            const refreshed = await listSpecCsvFilesUnderPrefix(bucket, normalizedFolder);
            const refreshedMax = maxVersionByDisplayName(refreshed, normalizedFolder);
            maxByName[file.name] = Math.max(
              maxByName[file.name] ?? 0,
              refreshedMax[file.name] ?? 0
            );
          }
          const version = (maxByName[file.name] ?? 0) + 1;
          const storedName = buildVersionedFileName(file.name, version);
          const path = `${normalizedFolder}${storedName}`;
          try {
            await bucket.file(path).save(buffer, {
              contentType: file.type || "text/csv; charset=utf-8",
              resumable: false,
              preconditionOpts: { ifGenerationMatch: 0 },
              metadata: { contentType: file.type || "text/csv; charset=utf-8" },
            });
            maxByName[file.name] = version;
            uploaded.push({ displayName: file.name, storedName, version });
            saved = true;
          } catch (err) {
            if (isPreconditionFailure(err) && attempt < MAX_RETRIES - 1) continue;
            throw err;
          }
        }
      }
    }

    void appendHistory({
      user: email,
      action: "upload",
      ...buildUploadDetail(normalizedFolder, uploaded),
    });

    return NextResponse.json({ ok: true, uploaded });
  } catch (e) {
    return jsonStorageError(e);
  }
}
