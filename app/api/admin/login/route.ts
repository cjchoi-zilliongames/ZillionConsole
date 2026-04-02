import { NextResponse } from "next/server";

import { isAdminAllowlistActive, parseAdminAllowedEmails } from "@/lib/admin-allowlist";
import {
  adminPasswordAuthConfigured,
  getAdminSessionCookieName,
  signAdminSession,
} from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isAdminAllowlistActive()) {
    return NextResponse.json(
      { ok: false, error: "권한이 없습니다." },
      { status: 403 }
    );
  }

  if (!adminPasswordAuthConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "관리자 비밀번호 로그인: ADMIN_PASSWORD, ADMIN_SESSION_SECRET 이 필요합니다.",
      },
      { status: 503 }
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, {
      status: 400,
    });
  }

  const inputEmail = (body.email ?? "").trim().toLowerCase();
  const inputPassword = body.password ?? "";
  const allowlist = parseAdminAllowedEmails();

  const emailOk = allowlist.includes(inputEmail);

  if (!emailOk || inputPassword !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { ok: false, error: "이메일 또는 비밀번호가 올바르지 않습니다." },
      { status: 401 }
    );
  }

  const secret = process.env.ADMIN_SESSION_SECRET!.trim();
  const token = signAdminSession(inputEmail, secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getAdminSessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
