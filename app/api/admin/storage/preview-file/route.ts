import { NextResponse } from "next/server";
import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guessContentType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/** GET ?path= — Storage 객체 바이너리 (공지 이미지 미리보기 등) */
export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const path = new URL(req.url).searchParams.get("path")?.trim() ?? "";
    if (!path) {
      return NextResponse.json({ ok: false, error: "path가 필요합니다." }, { status: 400 });
    }
    assertSafeStorageRelativePath(path);

    const bucket = getSpecBucket();
    const file = bucket.file(path);
    const [exists] = await file.exists();
    if (!exists) {
      return NextResponse.json({ ok: false, error: "파일을 찾을 수 없습니다." }, { status: 404 });
    }

    const [buf] = await file.download();
    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || guessContentType(path);

    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=120",
      },
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
