import { NextResponse } from "next/server";

import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

/** Firebase 웹 로그인 직후 등, 허용 목록·세션 검증용 (클라이언트 Storage 모드 포함) */
export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonStorageError(e);
  }
}
