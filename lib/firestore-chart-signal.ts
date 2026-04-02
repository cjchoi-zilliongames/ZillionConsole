"use client";

import { doc, getFirestore, setDoc } from "firebase/firestore";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";

export type ChartSignalExtra = {
  /** 폴더 표시명. publishFolderRoutes 신호에만 포함. { "0468a860/": "2.0" } 형태 */
  folderNames?: Record<string, string>;
};

/**
 * 차트(스펙) 관리 화면용 변경 시그널 — Firestore `signals/chart`.
 * CSV·메모·우편 플래그·폴더 라우트 등 차트 도구에서 갱신할 때 기록한다.
 */
export async function signalChartChange(extra?: ChartSignalExtra): Promise<void> {
  try {
    const app = getOrInitFirebaseBrowserApp();
    if (!app) return;
    const db = getFirestore(app);
    const data = { updatedAt: new Date(), ...(extra ?? {}) };
    if (extra?.folderNames !== undefined) {
      await setDoc(doc(db, "signals", "chart"), data);
    } else {
      await setDoc(doc(db, "signals", "chart"), data, { merge: true });
    }
  } catch {
    // 시그널 실패는 무시 — 본 작업은 이미 완료됨
  }
}
