import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import {
  buildFolderRoutesManifest,
  mergeFolderNamesWithExistingManifest,
  parseFolderRoutesManifestJson,
  SPEC_FOLDER_ROUTES_STORAGE_PATH,
} from "@/lib/spec/folder-routes-manifest";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { listRootFolderPrefixes } from "@/lib/storage/spec-inventory";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

/**
 * POST: 폴더 표시명(가상 키) → 실제 prefix 매핑을 `__spec/folder-routes.json` 에 기록.
 * Body: `{ "folderNames": { "0468a860/": "1.0.0", "0/": "base" } }`
 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as {
      folderNames?: Record<string, string>;
      liveRoute?: string | null;
    };
    const folderNames = body.folderNames ?? {};
    if (
      typeof folderNames !== "object" ||
      folderNames === null ||
      Array.isArray(folderNames)
    ) {
      return NextResponse.json(
        { ok: false, error: "folderNames must be an object" },
        { status: 400 }
      );
    }

    const bucket = getSpecBucket();
    const file = bucket.file(SPEC_FOLDER_ROUTES_STORAGE_PATH);

    let existing = null as ReturnType<typeof parseFolderRoutesManifestJson>;
    try {
      const [buf] = await file.download();
      existing = parseFolderRoutesManifestJson(JSON.parse(buf.toString("utf-8")));
    } catch {
      // 파일 없음 또는 손상
    }

    const folders = await listRootFolderPrefixes(bucket);
    const merged = mergeFolderNamesWithExistingManifest(folders, folderNames, existing);
    const manifest = buildFolderRoutesManifest(folders, merged, body.liveRoute ?? null);
    await file.save(JSON.stringify(manifest, null, 2), {
      contentType: "application/json; charset=utf-8",
      resumable: false,
    });

    return NextResponse.json({
      ok: true,
      path: SPEC_FOLDER_ROUTES_STORAGE_PATH,
      manifest,
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
