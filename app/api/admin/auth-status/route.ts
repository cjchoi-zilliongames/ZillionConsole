import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  adminPasswordAuthConfigured,
  getAdminSessionCookieName,
  verifyAdminSession,
} from "@/lib/admin-session";
import { hasEnvFirebaseConfig } from "@/lib/firebase-admin";
import { hasPublicFirebaseWebConfig } from "@/lib/firebase-public-config";

export const runtime = "nodejs";

export async function GET() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim();
  const token = (await cookies()).get(getAdminSessionCookieName())?.value;
  let loggedIn = false;
  let email: string | null = null;
  if (secret && token) {
    const v = verifyAdminSession(token, secret);
    if (v) {
      loggedIn = true;
      email = v.email;
    }
  }

  return NextResponse.json({
    ok: true,
    loggedIn,
    email,
    webAppConfigured: hasPublicFirebaseWebConfig(),
    firebaseReady: hasEnvFirebaseConfig(),
    adminAuthReady: adminPasswordAuthConfigured(),
  });
}
