import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import {
  listAllSpecCsvFiles,
  listRootFolderPrefixes,
  maxVersionBySpec,
} from "@/lib/storage/spec-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const bucket = getSpecBucket();
    const [folders, files] = await Promise.all([
      listRootFolderPrefixes(bucket),
      listAllSpecCsvFiles(bucket),
    ]);
    const globalMax = maxVersionBySpec(files);

    return NextResponse.json({
      ok: true,
      folders,
      files,
      globalMaxVersionBySpec: globalMax,
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
