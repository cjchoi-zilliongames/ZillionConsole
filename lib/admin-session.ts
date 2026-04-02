import { createHmac, timingSafeEqual } from "node:crypto";

import { isAdminAllowlistActive } from "@/lib/admin-allowlist";

const COOKIE_NAME = "spec_admin_session";

export function getAdminSessionCookieName(): string {
  return COOKIE_NAME;
}

export function signAdminSession(email: string, secret: string): string {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = JSON.stringify({ exp, email });
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ p: payload, s: sig })).toString(
    "base64url"
  );
}

export function verifyAdminSession(
  token: string,
  secret: string
): { email: string } | null {
  try {
    const { p, s } = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8")
    ) as { p: string; s: string };
    const expected = createHmac("sha256", secret).update(p).digest("hex");
    const a = Buffer.from(s, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const { exp, email } = JSON.parse(p) as { exp: number; email: string };
    if (typeof exp !== "number" || typeof email !== "string") return null;
    if (Date.now() > exp) return null;
    return { email };
  } catch {
    return null;
  }
}

export function adminPasswordAuthConfigured(): boolean {
  const hasSecret = !!process.env.ADMIN_SESSION_SECRET?.trim();
  const hasPassword = !!process.env.ADMIN_PASSWORD;
  return !!(hasPassword && hasSecret && isAdminAllowlistActive());
}
