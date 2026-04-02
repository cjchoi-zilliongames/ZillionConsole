"use client";

import { doc, getFirestore, setDoc } from "firebase/firestore";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";

/**
 * 우편 변경 시그널을 Firestore `signals/postbox`에 기록.
 * 차트 쪽 `signalChartChange` / `signals/chart`와 같은 패턴(문서 ID만 다름).
 */
export async function signalPostboxChange(): Promise<void> {
  try {
    const app = getOrInitFirebaseBrowserApp();
    if (!app) return;
    const db = getFirestore(app);
    await setDoc(
      doc(db, "signals", "postbox"),
      { updatedAt: new Date() },
      { merge: true },
    );
  } catch {
    // 시그널 실패는 무시 — 본 작업은 이미 완료됨
  }
}
