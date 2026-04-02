import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { listSpecCsvFilesUnderPrefix } from "@/lib/storage/spec-inventory";

export const runtime = "nodejs";

const SPEC_ADMIN_PLACEHOLDER = ".spec_admin_placeholder";

function normalizeFolder(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("folder is required");
  return t.endsWith("/") ? t : `${t}/`;
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as {
      fromFolder?: string;
      toFolder?: string;
      specs?: string[] | "ALL";
    };

    const fromFolder = normalizeFolder(body.fromFolder ?? "");
    const toFolder = normalizeFolder(body.toFolder ?? "");
    const specs = body.specs;

    if (fromFolder === toFolder) {
      return NextResponse.json(
        { ok: false, error: "fromFolder and toFolder must differ" },
        { status: 400 }
      );
    }

    if (specs !== "ALL" && (!Array.isArray(specs) || specs.length === 0)) {
      return NextResponse.json(
        { ok: false, error: 'specs must be "ALL" or a non-empty string array' },
        { status: 400 }
      );
    }

    const bucket = getSpecBucket();
    const sourceRows = await listSpecCsvFilesUnderPrefix(bucket, fromFolder);

    const specSet = specs === "ALL" ? null : new Set(specs);

    const toMove = specSet
      ? sourceRows.filter((r) => r.spec && specSet.has(r.spec))
      : sourceRows;

    if (toMove.length === 0) {
      return NextResponse.json({
        ok: true,
        moved: [],
        sourceFolderEmpty: (await listSpecCsvFilesUnderPrefix(bucket, fromFolder))
          .length === 0,
      });
    }

    const legacyPh = `${toFolder.replace(/\/$/, "")}/${SPEC_ADMIN_PLACEHOLDER}`;
    await bucket.file(legacyPh).delete({ ignoreNotFound: true });

    const moved: { from: string; to: string }[] = [];

    for (const row of toMove) {
      const destPath = `${toFolder}${row.fileName}`;
      const srcFile = bucket.file(row.fullPath);
      const destFile = bucket.file(destPath);

      const [exists] = await destFile.exists();
      if (exists) {
        return NextResponse.json(
          {
            ok: false,
            error: `Destination already exists: ${destPath}`,
            partial: moved,
          },
          { status: 409 }
        );
      }

      await srcFile.copy(destFile);
      await srcFile.delete({ ignoreNotFound: true });
      moved.push({ from: row.fullPath, to: destPath });
    }

    const remaining = await listSpecCsvFilesUnderPrefix(bucket, fromFolder);

    return NextResponse.json({
      ok: true,
      moved,
      sourceFolderEmpty: remaining.length === 0,
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
