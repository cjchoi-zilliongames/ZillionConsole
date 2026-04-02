import { NextResponse } from "next/server";

import { getAdminSessionCookieName } from "@/lib/admin-session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(getAdminSessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
