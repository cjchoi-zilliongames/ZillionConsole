"use client";

import { doc, getFirestore, setDoc } from "firebase/firestore";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";

/**
 * 공지 변경 시그널을 Firestore `signals/notice`에 기록.
 * 우편 `signalPostboxChange` / `signals/postbox`와 같은 패턴(문서 ID만 다름).
 */
export async function signalNoticeChange(): Promise<void> {
  try {
    const app = getOrInitFirebaseBrowserApp();
    if (!app) return;
    const db = getFirestore(app);
    await setDoc(
      doc(db, "signals", "notice"),
      { updatedAt: new Date() },
      { merge: true },
    );
  } catch {
    // 시그널 실패는 무시 — 본 작업은 이미 완료됨
  }
}
