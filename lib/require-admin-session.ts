import { cookies } from "next/headers";

import { assertAdminToolEmailAllowed } from "@/lib/admin-allowlist";
import {
  getAdminSessionCookieName,
  verifyAdminSession,
} from "@/lib/admin-session";

/** 레거시: ADMIN_EMAIL+비밀번호 로그인 후 쿠키. 신규는 Firebase 로그인 권장. */
export async function requireAdminSession(): Promise<{ email: string }> {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  const token = (await cookies()).get(getAdminSessionCookieName())?.value;
  if (!secret || !token) {
    throw new Error("UNAUTHORIZED");
  }
  const v = verifyAdminSession(token, secret);
  if (!v) {
    throw new Error("UNAUTHORIZED");
  }
  assertAdminToolEmailAllowed(v.email);
  return v;
}
