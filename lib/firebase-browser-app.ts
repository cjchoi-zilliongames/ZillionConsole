"use client";

import {
  deleteApp,
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";

import { getFirebaseOptionsFromBrowser } from "@/lib/firebase-web-config-storage";

export function getOrInitFirebaseBrowserApp(): FirebaseApp | null {
  const opts = getFirebaseOptionsFromBrowser();
  if (!opts) return null;
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp(opts);
}

/** 설정 저장·삭제 후 앱 재초기화 */
export function reinitFirebaseBrowserApp(): FirebaseApp | null {
  const opts = getFirebaseOptionsFromBrowser();
  for (const app of getApps()) {
    void deleteApp(app);
  }
  if (!opts) return null;
  return initializeApp(opts);
}
