import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { getRequestUserEmail } from "@/lib/get-request-user";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { appendHistory, buildMergeDetail } from "@/lib/storage/spec-history";
import {
  listSpecCsvFilesUnderPrefix,
  removeDirectStorageChildrenIfNoTopLevelCsv,
} from "@/lib/storage/spec-inventory";
import { applyChartPostboxFlagPathChanges } from "@/lib/firestore/sync-chart-postbox-flag-paths";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

function normalizeFolder(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("folder is required");
  return t.endsWith("/") ? t : `${t}/`;
}

/**
 * POST: fromFolder의 모든 CSV를 toFolder로 병합.
 * 같은 displayName(스펙명)이 toFolder에 이미 있으면 해당 파일들을 모두 삭제한 뒤 이동.
 * Body: `{ "fromFolder": "1.0/", "toFolder": "0/" }`
 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const email = await getRequestUserEmail(req);
    const body = (await req.json()) as {
      fromFolder?: string;
      toFolder?: string;
    };
    const fromFolder = normalizeFolder(body.fromFolder ?? "");
    const toFolder = normalizeFolder(body.toFolder ?? "");

    if (fromFolder === toFolder) {
      return NextResponse.json(
        { ok: false, error: "fromFolder and toFolder must differ" },
        { status: 400 }
      );
    }

    const bucket = getSpecBucket();
    const [srcFiles, destFiles] = await Promise.all([
      listSpecCsvFilesUnderPrefix(bucket, fromFolder),
      listSpecCsvFilesUnderPrefix(bucket, toFolder),
    ]);

    if (srcFiles.length === 0) {
      return NextResponse.json({ ok: true, moved: [], deleted: [] });
    }

    // displayName 별로 dest 파일 인덱싱
    const destByDisplay = new Map<string, string[]>();
    for (const f of destFiles) {
      const arr = destByDisplay.get(f.displayName) ?? [];
      arr.push(f.fullPath);
      destByDisplay.set(f.displayName, arr);
    }

    // 1단계: 소스 파일을 목적지로 복사 (데이터 보존 우선)
    const moved: { from: string; to: string }[] = [];
    for (const srcFile of srcFiles) {
      const destPath = `${toFolder}${srcFile.fileName}`;
      const srcRef = bucket.file(srcFile.fullPath);
      const destRef = bucket.file(destPath);
      await srcRef.copy(destRef);
      moved.push({ from: srcFile.fullPath, to: destPath });
    }

    // 2단계: 충돌 파일 삭제 (복사 완료 후에만 삭제)
    const deleted: string[] = [];
    const processedDisplayNames = new Set<string>();
    for (const srcFile of srcFiles) {
      if (processedDisplayNames.has(srcFile.displayName)) continue;
      processedDisplayNames.add(srcFile.displayName);
      const conflicting = destByDisplay.get(srcFile.displayName);
      if (conflicting) {
        for (const path of conflicting) {
          await bucket.file(path).delete({ ignoreNotFound: true });
          deleted.push(path);
        }
      }
    }

    // 3단계: 소스 파일 삭제
    for (const srcFile of srcFiles) {
      await bucket.file(srcFile.fullPath).delete({ ignoreNotFound: true });
    }

    // 4단계: 상위에 CSV가 없으면 플레이스홀더 등만 남은 빈 앱 버전 폴더 정리
    await removeDirectStorageChildrenIfNoTopLevelCsv(bucket, fromFolder);

    void appendHistory({
      user: email,
      action: "merge",
      ...buildMergeDetail(fromFolder, moved),
    });

    void applyChartPostboxFlagPathChanges({ deletePaths: deleted, renames: moved });

    return NextResponse.json({ ok: true, moved, deleted });
  } catch (e) {
    return jsonStorageError(e);
  }
}
