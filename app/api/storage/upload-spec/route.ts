import { NextResponse } from "next/server";

import { buildSpecCsvFileName } from "@/lib/spec/csv-filename";
import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { listAllSpecCsvFiles, maxVersionBySpec } from "@/lib/storage/spec-inventory";

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

type UploadItem = { spec: string; csvText: string };

function normalizeFolder(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("targetFolder is required");
  return t.endsWith("/") ? t : `${t}/`;
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as {
      targetFolder?: string;
      items?: UploadItem[];
    };

    const targetFolder = normalizeFolder(body.targetFolder ?? "");
    const items = body.items ?? [];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "items must be a non-empty array" },
        { status: 400 }
      );
    }

    const bucket = getSpecBucket();
    const allFiles = await listAllSpecCsvFiles(bucket);
    const globalMax = maxVersionBySpec(allFiles);

    const results: { spec: string; version: number; path: string }[] = [];
    const MAX_RETRIES = 10;

    for (const item of items) {
      if (typeof item.csvText !== "string") {
        return NextResponse.json(
          { ok: false, error: `Missing csvText for ${item.spec}` },
          { status: 400 }
        );
      }

      const buf = Buffer.from(item.csvText, "utf8");
      let saved = false;
      for (let attempt = 0; attempt < MAX_RETRIES && !saved; attempt++) {
        await jitterDelay(attempt);
        if (attempt > 0) {
          const refreshedFiles = await listAllSpecCsvFiles(bucket);
          const refreshedMax = maxVersionBySpec(refreshedFiles);
          globalMax[item.spec] = Math.max(
            globalMax[item.spec] ?? 0,
            refreshedMax[item.spec] ?? 0
          );
        }
        const nextVersion = (globalMax[item.spec] ?? 0) + 1;
        const fileName = buildSpecCsvFileName(item.spec, nextVersion);
        const path = `${targetFolder}${fileName}`;
        const file = bucket.file(path);
        try {
          await file.save(buf, {
            contentType: "text/csv; charset=utf-8",
            resumable: false,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: "text/csv; charset=utf-8" },
          });
          globalMax[item.spec] = nextVersion;
          results.push({ spec: item.spec, version: nextVersion, path });
          saved = true;
        } catch (err) {
          if (isPreconditionFailure(err) && attempt < MAX_RETRIES - 1) continue;
          throw err;
        }
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return jsonStorageError(e);
  }
}
