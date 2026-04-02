"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function loadWidths(key: string, defaults: readonly number[], mins: readonly number[]): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...defaults];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length !== defaults.length) return [...defaults];
    return defaults.map((d, i) => {
      const v = arr[i];
      const m = mins[i] ?? 40;
      return typeof v === "number" && Number.isFinite(v) && v >= m ? v : d;
    });
  } catch {
    return [...defaults];
  }
}

/**
 * 차트 관리 표(SpecFilesTable)와 같이 열 경계를 드래그해 너비 조절.
 * `boundary` i = i번째 열과 i+1번째 열 사이.
 */
export function useResizableAdminTableColumns(opts: {
  storageKey: string;
  defaults: readonly number[];
  mins: readonly number[];
}) {
  const { storageKey, defaults, mins } = opts;

  // SSR·첫 클라이언트 페인트는 항상 defaults로 통일해야 hydration mismatch가 나지 않는다.
  // localStorage는 마운트 후에만 읽는다(서버에는 없고, 첫 렌더에서 읽으면 서버 HTML과 달라짐).
  const [widths, setWidths] = useState<number[]>(() => [...defaults]);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const minsRef = useRef(mins);
  minsRef.current = mins;
  const resizeRef = useRef<{ boundary: number; startX: number; start: number[] } | null>(null);

  useEffect(() => {
    setWidths(loadWidths(storageKey, defaults, mins));
    // defaults/mins는 호출부에서 모듈 상수로 고정되는 전제. storageKey만 바뀔 때 다시 로드.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 배열 참조를 deps에 넣으면 불필요한 리셋 가능
  }, [storageKey]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = resizeRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const next = [...drag.start];
      const i = drag.boundary;
      const minA = minsRef.current[i] ?? 40;
      const minB = minsRef.current[i + 1] ?? 40;
      let a = next[i]! + delta;
      let b = next[i + 1]! - delta;
      if (a < minA) {
        b -= minA - a;
        a = minA;
      }
      if (b < minB) {
        a -= minB - b;
        b = minB;
      }
      if (a < minA || b < minB) return;
      next[i] = a;
      next[i + 1] = b;
      widthsRef.current = next;
      setWidths(next);
    }
    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(storageKey, JSON.stringify(widthsRef.current));
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [storageKey]);

  const startResize = useCallback((boundary: number, clientX: number) => {
    if (boundary < 0 || boundary >= widthsRef.current.length - 1) return;
    resizeRef.current = { boundary, startX: clientX, start: [...widthsRef.current] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const totalWidth = widths.reduce((a, b) => a + b, 0);

  return { widths, totalWidth, startResize };
}
