"use client";

import { useEffect, useRef } from "react";
import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";

/**
 * Firestore `signals/notice` 문서를 구독해 다른 탭·기기의 공지 변경을 감지한다.
 * `usePostboxChangeSignal` / `signals/postbox`와 동일한 방식(문서 ID만 다름).
 */
export function useNoticeChangeSignal(
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
    const signalRef = doc(db, "signals", "notice");
    let initialized = false;

    const unsubscribe = onSnapshot(signalRef, () => {
      if (!initialized) {
        initialized = true;
        return;
      }
      onChangedRef.current();
    });

    return unsubscribe;
  }, [enabled]);
}
