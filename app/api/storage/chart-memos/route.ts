import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { CHART_MEMOS_STORAGE_PATH, type ChartMemos } from "@/lib/spec/chart-memos";
import { requireAnyAuth } from "@/lib/require-any-auth";
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

/** GET: 전체 메모 + Storage generation (동시 수정 방지용) */
export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const bucket = getSpecBucket();
    const [memos, generation] = await Promise.all([readMemos(bucket), memoGeneration(bucket)]);
    return NextResponse.json({ ok: true, memos, generation });
  } catch (e) {
    return jsonStorageError(e);
  }
}

/**
 * POST: 단일 메모 저장 또는 삭제.
 * Body: `{ "key": "…", "memo": "…", "ifGenerationMatch": "123" | null }`
 * — memo가 빈 문자열이면 키 삭제.
 * — 파일이 이미 있으면 ifGenerationMatch 필수(GET의 generation과 동일해야 함).
 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as {
      key?: string;
      memo?: string;
      ifGenerationMatch?: string | null;
    };
    const key = (body.key ?? "").trim();
    if (!key) {
      return NextResponse.json({ ok: false, error: "key is required" }, { status: 400 });
    }
    const memo = (body.memo ?? "").trim();
    const clientGen = body.ifGenerationMatch;

    const bucket = getSpecBucket();
    const file = bucket.file(CHART_MEMOS_STORAGE_PATH);
    const [exists] = await file.exists();

    if (!exists) {
      if (clientGen != null && clientGen !== "") {
        return NextResponse.json(
          { ok: false, error: "chart-memos.json이 없습니다. ifGenerationMatch는 null이어야 합니다." },
          { status: 400 }
        );
      }
      const memos: ChartMemos = {};
      if (memo) memos[key] = memo;
      await file.save(JSON.stringify(memos, null, 2), {
        contentType: "application/json; charset=utf-8",
        resumable: false,
      });
      const gen = await memoGeneration(bucket);
      return NextResponse.json({ ok: true, key, memo, generation: gen });
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
    if (memo) memos[key] = memo;
    else delete memos[key];

    const payload = JSON.stringify(memos, null, 2);
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
    return NextResponse.json({ ok: true, key, memo, generation: genAfter });
  } catch (e) {
    return jsonStorageError(e);
  }
}
