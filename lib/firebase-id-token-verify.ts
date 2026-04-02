import * as jose from "jose";

const FIREBASE_JWKS = jose.createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

/** 서비스 계정 없이 ID 토큰 검증에 쓰는 프로젝트 ID */
export function getFirebaseProjectIdForTokenVerification(): string | null {
  const fromServer = process.env.FIREBASE_PROJECT_ID?.trim();
  if (fromServer) return fromServer;
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || null;
}

/**
 * Firebase Auth ID 토큰 검증 (Google 공개 키만 사용, private key 불필요).
 * Google / 이메일 등 Firebase로 발급된 토큰 공통.
 */
export async function verifyFirebaseIdTokenBearer(
  token: string
): Promise<{ email: string | null }> {
  const projectId = getFirebaseProjectIdForTokenVerification();
  if (!projectId) {
    throw new Error("NO_FIREBASE_PROJECT_ID");
  }

  const { payload } = await jose.jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  const email =
    typeof payload.email === "string" && payload.email.trim()
      ? payload.email.trim()
      : null;

  return { email };
}
