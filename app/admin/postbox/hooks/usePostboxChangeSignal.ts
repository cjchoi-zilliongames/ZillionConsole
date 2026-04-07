"use client";

import { useEffect, useRef } from "react";
import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";

/**
 * Firestore `signals/postbox` 문서를 구독해 다른 탭·기기의 우편 변경을 감지한다.
 * `useChartChangeSignal` / `signals/chart`와 동일한 방식(문서 ID만 다름).
 */
export function usePostboxChangeSignal(
  onChanged: () => void,
  enabled: boolean,
): void {
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useEffect(() => {
    if (!enabled) return;

    const app = getOrInitFirebaseBrowserApp();
    if (!app) return;

    const db = getFirestore(app);
    const signalRef = doc(db, "signals", "postbox");
    let initialized = false;

    const unsubscribe = onSnapshot(signalRef, () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      onChangedRef.current();
    });

    // 탭이 다시 활성화될 때 데이터를 갱신해 백그라운드 정체 현상을 방지
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        onChangedRef.current();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled]);
}
