import { NextResponse } from "next/server";

import { applyChartPostboxFlagPathChanges } from "@/lib/firestore/sync-chart-postbox-flag-paths";
import { getSpecBucket } from "@/lib/firebase-admin";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { buildVersionedFileName, parseVersionedFileName } from "@/lib/spec/versioned-filename";
import { migrateChartMemosAfterPathChange } from "@/lib/storage/migrate-chart-memos-bucket";
import { assertSafeStorageRelativePath } from "@/lib/storage/storage-path-utils";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const body = (await req.json()) as { fullPath?: string; newVersion?: number };

    const fullPath = body.fullPath?.trim();
    if (!fullPath) {
      return NextResponse.json({ ok: false, error: "fullPath is required" }, { status: 400 });
    }
    const newVersion = body.newVersion;
    if (!Number.isFinite(newVersion) || newVersion! < 1) {
      return NextResponse.json({ ok: false, error: "newVersion must be a positive integer" }, { status: 400 });
    }

    const slashIdx = fullPath.lastIndexOf("/");
    const folder = slashIdx >= 0 ? fullPath.slice(0, slashIdx + 1) : "";
    const fileName = slashIdx >= 0 ? fullPath.slice(slashIdx + 1) : fullPath;

    assertSafeStorageRelativePath(fileName);

    const parsed = parseVersionedFileName(fileName);
    if (!parsed) {
      return NextResponse.json({ ok: false, error: "File is not a versioned file" }, { status: 400 });
    }
    if (parsed.version === newVersion) {
      return NextResponse.json({ ok: true, fullPath }); // no-op
    }

    const newFileName = buildVersionedFileName(parsed.displayName, newVersion!);
    const newFullPath = `${folder}${newFileName}`;

    const bucket = getSpecBucket();
    const srcFile = bucket.file(fullPath);
    const destFile = bucket.file(newFullPath);

    const [destExists] = await destFile.exists();
    if (destExists) {
      return NextResponse.json(
        { ok: false, error: `버전 {${newVersion}}이 이미 존재합니다: ${newFileName}` },
        { status: 409 }
      );
    }

    await srcFile.copy(destFile);
    await srcFile.delete({ ignoreNotFound: true });

    try {
      await migrateChartMemosAfterPathChange(bucket, [
        { from: fullPath, to: newFullPath },
      ]);
    } catch {
      /* CSV rename은 완료됨; chart-memos 저장만 실패한 경우 */
    }

    void applyChartPostboxFlagPathChanges({
      renames: [{ from: fullPath, to: newFullPath }],
    });

    return NextResponse.json({ ok: true, from: fullPath, to: newFullPath });
  } catch (e) {
    return jsonStorageError(e);
  }
}
