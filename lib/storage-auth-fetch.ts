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
        const token = await user.getIdToken();
        headers.set("Authorization", `Bearer ${token}`);
      }
    }
    return adminFetch(input, { ...init, headers });
  })();
}
