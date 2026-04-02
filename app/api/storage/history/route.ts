import { NextResponse } from "next/server";

import { getRequestUserEmail } from "@/lib/get-request-user";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { appendHistory, readHistory } from "@/lib/storage/spec-history";
import { jsonStorageError } from "@/lib/storage-api-response";
import type { HistoryRecord } from "@/lib/storage/spec-history";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const records = await readHistory();
    return NextResponse.json({ ok: true, records });
  } catch (e) {
    return jsonStorageError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const email = await getRequestUserEmail(req);
    const body = (await req.json()) as {
      action?: HistoryRecord["action"];
      detail?: string;
      files?: string[];
    };
    if (!body.action || !body.detail) {
      return NextResponse.json({ ok: false, error: "action and detail are required" }, { status: 400 });
    }
    await appendHistory({
      user: email,
      action: body.action,
      detail: body.detail,
      ...(Array.isArray(body.files) && body.files.length > 0 ? { files: body.files } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonStorageError(e);
  }
}
