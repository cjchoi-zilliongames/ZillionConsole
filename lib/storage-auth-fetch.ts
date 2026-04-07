"use client";

import { getAuth } from "firebase/auth";

import { adminFetch } from "@/lib/admin-client-fetch";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";

/**
 * 어드민 세션 쿠키(adminFetch credentials) + (가능하면) Firebase ID 토큰.
 * `requireAnyAuth`가 허용하는 두 경로를 모두 커버해 Storage API를 한 가지로 통일한다.
 */
export function storageAuthFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return (async () => {
    const headers = new Headers(init?.headers);
    const app = getOrInitFirebaseBrowserApp();
    if (app) {
      const user = getAuth(app).currentUser;
      if (user) {
        try {
          // 백그라운드 탭에서 돌아올 때 getIdToken()이 수 초간 블록되는 경우가 있음.
          // 3초 이내에 토큰을 얻지 못하면 세션 쿠키 인증으로 폴백.
          const token = await Promise.race<string | null>([
            user.getIdToken(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
          ]);
          if (token) headers.set("Authorization", `Bearer ${token}`);
        } catch {
          // getIdToken 실패 시 세션 쿠키로 폴백
        }
      }
    }
    return adminFetch(input, { ...init, headers });
  })();
}
