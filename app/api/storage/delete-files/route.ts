import { NextResponse } from "next/server";

import { getSpecBucket } from "@/lib/firebase-admin";
import { getRequestUserEmail } from "@/lib/get-request-user";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { applyChartPostboxFlagPathChanges } from "@/lib/firestore/sync-chart-postbox-flag-paths";
import { jsonStorageError } from "@/lib/storage-api-response";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";
import { appendHistory, buildDeleteDetail } from "@/lib/storage/spec-history";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const email = await getRequestUserEmail(req);
    const body = (await req.json()) as { paths?: string[] };

    const paths = body.paths;
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

    const bucket = getSpecBucket();
    const deleted: string[] = [];

    for (const fullPath of paths as string[]) {
      await bucket.file(fullPath).delete({ ignoreNotFound: true });
      deleted.push(fullPath);
    }

    void appendHistory({
      user: email,
      action: "delete",
      ...buildDeleteDetail(deleted),
    });

    void applyChartPostboxFlagPathChanges({ deletePaths: deleted });

    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return jsonStorageError(e);
  }
}
