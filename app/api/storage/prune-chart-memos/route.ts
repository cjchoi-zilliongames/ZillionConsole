import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { CHART_MEMOS_STORAGE_PATH, type ChartMemos } from "@/lib/spec/chart-memos";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { filterChartMemosToValidPaths } from "@/lib/storage/chart-memos-prune";
import { listAllSpecCsvFiles } from "@/lib/storage/spec-inventory";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

function isPreconditionFailure(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { code?: number; message?: string };
  if (err.code === 412) return true;
  return typeof err.message === "string" && err.message.includes("Precondition Failed");
}

async function readMemos(bucket: ReturnType<typeof getSpecBucket>): Promise<ChartMemos> {
  try {
    const [buf] = await bucket.file(CHART_MEMOS_STORAGE_PATH).download();
    return JSON.parse(buf.toString("utf-8")) as ChartMemos;
  } catch {
    return {};
  }
}

async function memoGeneration(
  bucket: ReturnType<typeof getSpecBucket>
): Promise<string | null> {
  const file = bucket.file(CHART_MEMOS_STORAGE_PATH);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [metadata] = await file.getMetadata();
  const g = metadata.generation;
  return g !== undefined && g !== null ? String(g) : null;
}

/**
 * POST: 현재 스펙 CSV 인벤토리에 없는 키의 차트 메모를 삭제.
 * Body: `{ "ifGenerationMatch": string | null }` — chart-memos.json과 동일 규칙.
 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as { ifGenerationMatch?: string | null };
    const clientGen = body.ifGenerationMatch;

    const bucket = getSpecBucket();
    const file = bucket.file(CHART_MEMOS_STORAGE_PATH);
    const [exists] = await file.exists();

    const rows = await listAllSpecCsvFiles(bucket);
    const validPaths = new Set(rows.map((r) => r.fullPath));

    if (!exists) {
      if (clientGen != null && clientGen !== "") {
        return NextResponse.json(
          { ok: false, error: "chart-memos.json이 없습니다. ifGenerationMatch는 null이어야 합니다." },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        removedKeys: [] as string[],
        generation: null,
        memos: {} as ChartMemos,
      });
    }

    const [metadata] = await file.getMetadata();
    const currentGen = metadata.generation;
    if (currentGen === undefined || currentGen === null) {
      return NextResponse.json({ ok: false, error: "generation을 읽을 수 없습니다" }, { status: 500 });
    }
    const currentGenStr = String(currentGen);

    if (clientGen == null || clientGen === "") {
      return NextResponse.json(
        {
          ok: false,
          error: "ifGenerationMatch가 필요합니다. 목록을 새로고침한 뒤 다시 시도하세요.",
        },
        { status: 400 }
      );
    }
    if (String(clientGen) !== currentGenStr) {
      return NextResponse.json(
        { ok: false, error: "CHART_MEMOS_CONFLICT", generation: currentGenStr },
        { status: 409 }
      );
    }

    const memos = await readMemos(bucket);
    const { next, removedKeys } = filterChartMemosToValidPaths(memos, validPaths);

    if (removedKeys.length === 0) {
      const gen = await memoGeneration(bucket);
      return NextResponse.json({
        ok: true,
        removedKeys,
        generation: gen,
        memos: next,
      });
    }

    const payload = JSON.stringify(next, null, 2);
    try {
      await file.save(payload, {
        contentType: "application/json; charset=utf-8",
        resumable: false,
        preconditionOpts: { ifGenerationMatch: Number(currentGen) },
      });
    } catch (e) {
      if (isPreconditionFailure(e)) {
        const [meta] = await file.getMetadata();
        const g = meta.generation != null ? String(meta.generation) : null;
        return NextResponse.json(
          { ok: false, error: "CHART_MEMOS_CONFLICT", generation: g },
          { status: 409 }
        );
      }
      throw e;
    }

    const genAfter = await memoGeneration(bucket);
    return NextResponse.json({
      ok: true,
      removedKeys,
      generation: genAfter,
      memos: next,
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
