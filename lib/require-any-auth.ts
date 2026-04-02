import { assertAdminToolEmailAllowed } from "@/lib/admin-allowlist";
import { verifyFirebaseIdTokenBearer } from "@/lib/firebase-id-token-verify";
import { requireAdminSession } from "@/lib/require-admin-session";

/**
 * 툴 API 공통 인증: (1) 레거시 세션 쿠키 또는 (2) Firebase ID 토큰(Bearer).
 * Bearer는 서비스 계정 없이 공개 JWKS로 검증하고, 이메일은 `ADMIN_ALLOWED_EMAILS`만 본다.
 */
export async function getAuthenticatedToolUser(
  req: Request
): Promise<{ email: string }> {
  try {
    return await requireAdminSession();
  } catch {
    /* 세션 없음 */
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authHeader.slice(7);
  try {
    const { email } = await verifyFirebaseIdTokenBearer(token);
    assertAdminToolEmailAllowed(email);
    if (!email) throw new Error("UNAUTHORIZED");
    return { email };
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") throw e;
    if (e instanceof Error && e.message === "ALLOWLIST_REQUIRED") throw e;
    if (e instanceof Error && e.message === "NO_FIREBASE_PROJECT_ID") throw e;
    throw new Error("UNAUTHORIZED");
  }
}

export async function requireAnyAuth(req: Request): Promise<void> {
  await getAuthenticatedToolUser(req);
}
