import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1024 * 1024; // 1MB
const PREFIX = "__notice/images/";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function safeBasename(name: string): string {
  const base = name.replace(/[/\\]/g, "").replace(/\0/g, "").trim() || "image";
  return base.slice(0, 120);
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "file 필드가 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "이미지는 최대 1MB까지 업로드할 수 있습니다." }, { status: 400 });
    }
    const ct = (file.type || "").toLowerCase();
    if (!ALLOWED_TYPES.has(ct)) {
      return NextResponse.json(
        { ok: false, error: "JPEG, PNG, WebP, GIF만 업로드할 수 있습니다." },
        { status: 400 },
      );
    }

    const bucket = getSpecBucket();
    const id = randomUUID();
    const extFromName = safeBasename(file.name).match(/\.[a-z0-9]{1,8}$/i);
    const ext =
      extFromName?.[0] ??
      (ct === "image/png"
        ? ".png"
        : ct === "image/webp"
          ? ".webp"
          : ct === "image/gif"
            ? ".gif"
            : ".jpg");
    const objectPath = `${PREFIX}${id}${ext}`;
    assertSafeStorageRelativePath(objectPath);

    const buf = Buffer.from(await file.arrayBuffer());
    await bucket.file(objectPath).save(buf, {
      contentType: ct || "application/octet-stream",
      resumable: false,
      metadata: { cacheControl: "public, max-age=3600" },
    });

    return NextResponse.json({ ok: true, path: objectPath });
  } catch (e) {
    return jsonStorageError(e);
  }
}
