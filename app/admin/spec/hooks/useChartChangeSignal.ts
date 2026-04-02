"use client";

import { useEffect, useRef } from "react";
import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";
import type { ChartSignalExtra } from "@/lib/firestore-chart-signal";

/**
 * Firestore `signals/chart` 문서를 구독해 다른 탭·기기의 차트(스펙) 데이터 변경을 감지한다.
 * `enabled`가 true가 된 시점(Firebase 앱 초기화 완료 후)에 구독을 시작한다.
 * 초기 스냅샷은 무시하고, 이후 변경 시에만 onChanged를 호출한다.
 */
export function useChartChangeSignal(
  onChanged: (extra: ChartSignalExtra | null) => void,
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
    const signalRef = doc(db, "signals", "chart");
    let initialized = false;

    const unsubscribe = onSnapshot(signalRef, (snap) => {
      if (!initialized) {
        initialized = true;
        return;
      }
      const data = snap.exists() ? (snap.data() as ChartSignalExtra) : null;
      onChangedRef.current(data);
    });

    return unsubscribe;
  }, [enabled]);
}
