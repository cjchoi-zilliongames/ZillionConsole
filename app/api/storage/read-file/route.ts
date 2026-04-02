import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";

export const runtime = "nodejs";

/** GET /api/storage/read-file?path=folder/file.csv — CSV 텍스트 반환 */
export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const { searchParams } = new URL(req.url);
    const path = (searchParams.get("path") ?? "").trim();
    if (!path) {
      return NextResponse.json({ ok: false, error: "path is required" }, { status: 400 });
    }
    assertSafeStorageRelativePath(path);

    const bucket = getSpecBucket();
    const [buf] = await bucket.file(path).download();
    const text = buf.toString("utf-8");

    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
