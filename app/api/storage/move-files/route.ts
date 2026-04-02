import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { getRequestUserEmail } from "@/lib/get-request-user";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { appendHistory, buildMoveDetail } from "@/lib/storage/spec-history";
import {
  assertDirectPathsInSameFolder,
  assertSafeStorageRelativePath,
  storageObjectBasename,
} from "@/lib/storage/storage-path-utils";
import { applyChartPostboxFlagPathChanges } from "@/lib/firestore/sync-chart-postbox-flag-paths";
import { jsonStorageError } from "@/lib/storage-api-response";
import { migrateChartMemosAfterPathChange } from "@/lib/storage/migrate-chart-memos-bucket";

export const runtime = "nodejs";

const SPEC_ADMIN_PLACEHOLDER = ".spec_admin_placeholder";

function normalizeFolder(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("toFolder is required");
  return t.endsWith("/") ? t : `${t}/`;
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const email = await getRequestUserEmail(req);
    const body = (await req.json()) as {
      paths?: string[];
      toFolder?: string;
    };

    const paths = body.paths;
    const toFolder = normalizeFolder(body.toFolder ?? "");

    if (!Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json(
        { ok: false, error: "paths must be a non-empty array" },
        { status: 400 }
      );
    }
    if (paths.length > 500) {
      return NextResponse.json(
        { ok: false, error: "Too many paths (max 500)" },
        { status: 400 }
      );
    }

    for (const p of paths) {
      assertSafeStorageRelativePath(String(p));
    }

    const fromPrefix = assertDirectPathsInSameFolder(paths as string[]);
    if (fromPrefix === toFolder) {
      return NextResponse.json(
        { ok: false, error: "Destination folder must differ from source" },
        { status: 400 }
      );
    }

    const bucket = getSpecBucket();
    const legacyPh = `${toFolder.replace(/\/$/, "")}/${SPEC_ADMIN_PLACEHOLDER}`;
    await bucket.file(legacyPh).delete({ ignoreNotFound: true });

    const moved: { from: string; to: string }[] = [];

    for (const fullPath of paths as string[]) {
      const base = storageObjectBasename(fullPath);
      if (!base.endsWith(".csv")) {
        return NextResponse.json(
          { ok: false, error: `Only .csv allowed: ${fullPath}`, partial: moved },
          { status: 400 }
        );
      }

      const destPath = `${toFolder}${base}`;
      const srcFile = bucket.file(fullPath);
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
      moved.push({ from: fullPath, to: destPath });
    }

    void migrateChartMemosAfterPathChange(bucket, moved);
    void appendHistory({
      user: email,
      action: "move",
      ...buildMoveDetail(moved),
    });

    void applyChartPostboxFlagPathChanges({ renames: moved });

    return NextResponse.json({ ok: true, moved });
  } catch (e) {
    return jsonStorageError(e);
  }
}
