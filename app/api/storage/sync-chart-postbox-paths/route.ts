import { NextResponse } from "next/server";

import { applyChartPostboxFlagPathChanges } from "@/lib/firestore/sync-chart-postbox-flag-paths";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

const MAX_OPS = 500;

/**
 * POST: 삭제·이동 후 우편 플래그(fullPath 키) 일괄 동기화.
 * Body: `{ deletePaths?: string[], renames?: { from, to }[] }`
 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as {
      deletePaths?: string[];
      renames?: { from?: string; to?: string }[];
    };

    const deletePaths = Array.isArray(body.deletePaths) ? body.deletePaths.map(String) : [];
    const renames = Array.isArray(body.renames)
      ? body.renames
          .filter((r) => r && typeof r.from === "string" && typeof r.to === "string")
          .map((r) => ({ from: r.from as string, to: r.to as string }))
      : [];

    if (deletePaths.length > MAX_OPS || renames.length > MAX_OPS) {
      return NextResponse.json(
        { ok: false, error: `Too many operations (max ${MAX_OPS} each)` },
        { status: 400 },
      );
    }

    for (const p of deletePaths) {
      assertSafeStorageRelativePath(p);
    }
    for (const { from, to } of renames) {
      assertSafeStorageRelativePath(from);
      assertSafeStorageRelativePath(to);
    }

    const { changed } = await applyChartPostboxFlagPathChanges({ deletePaths, renames });
    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    return jsonStorageError(e);
  }
}
