import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { SPEC_FOLDER_ROUTES_STORAGE_PATH } from "@/lib/spec/folder-routes-manifest";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

/**
 * POST: 기존 folder-routes.json의 liveRoute 필드만 업데이트.
 * Body: `{ "liveRoute": "1.0.0" }` — null 또는 빈 문자열이면 liveRoute 제거.
 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as { liveRoute?: string | null };
    const liveRoute = body.liveRoute || null;

    const bucket = getSpecBucket();
    const file = bucket.file(SPEC_FOLDER_ROUTES_STORAGE_PATH);

    // 기존 manifest 읽기
    let manifest: Record<string, unknown> = {};
    try {
      const [buf] = await file.download();
      manifest = JSON.parse(buf.toString("utf-8")) as Record<string, unknown>;
    } catch {
      // 파일 없으면 빈 객체로 시작
    }

    // liveRoute 업데이트
    if (liveRoute) {
      manifest.liveRoute = liveRoute;
    } else {
      delete manifest.liveRoute;
    }
    manifest.updatedAt = new Date().toISOString();

    await file.save(JSON.stringify(manifest, null, 2), {
      contentType: "application/json; charset=utf-8",
      resumable: false,
    });

    return NextResponse.json({ ok: true, liveRoute });
  } catch (e) {
    return jsonStorageError(e);
  }
}
