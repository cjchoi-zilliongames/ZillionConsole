import { NextResponse } from "next/server";

import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCRIPT_URL = process.env.NEXT_PUBLIC_SHEETS_SCRIPT_URL ?? "";

/** Google Apps Script는 POST → 302 리다이렉트 → 최종 URL 패턴.
 *  fetch redirect:"follow"는 리다이렉트 시 body를 버리므로 수동 추적. */
async function fetchWithRedirect(url: string, body: string, maxRedirects = 5): Promise<string> {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await fetch(currentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        "Content-Length": String(Buffer.byteLength(body, "utf-8")),
      },
      body,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("리다이렉트 Location 헤더 없음");
      // 리다이렉트된 URL은 GET으로 결과를 가져옴
      const finalRes = await fetch(location);
      return finalRes.text();
    }
    return res.text();
  }
  throw new Error("리다이렉트 횟수 초과");
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);

    if (!SCRIPT_URL) {
      return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_SHEETS_SCRIPT_URL 미설정" }, { status: 500 });
    }

    const body = await req.text();
    const text = await fetchWithRedirect(SCRIPT_URL, body);

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return jsonStorageError(e);
  }
}
