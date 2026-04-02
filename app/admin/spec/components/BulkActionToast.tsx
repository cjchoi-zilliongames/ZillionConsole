"use client";

import { useEffect, useRef, useState } from "react";

import { ADMIN_TOP_BAR_PX } from "../../components/admin-console-constants";

export type BulkToastTone = "default" | "danger" | "success";

type Props = {
  message: string | null;
  tone?: BulkToastTone;
  onClear: () => void;
};

const NAV_GAP_PX = 8;
const TOP_NAV_HEIGHT_PX = ADMIN_TOP_BAR_PX;

const AUTO_HIDE_MS = 3600;
const EXIT_MS = 400;

/** `…중…` 패턴이면 작업 끝날 때까지 토스트 유지 (자동 닫힘 없음) */
function isStickyProgressMessage(msg: string): boolean {
  return msg.includes("중…");
}

/** 상단 탭 바로 아래, 위→아래로 내려온 뒤 잠시 유지되고 다시 위로 스르륵 사라짐. */
export function BulkActionToast({ message, tone = "default", onClear }: Props) {
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [displayTone, setDisplayTone] = useState<BulkToastTone>("default");

  useEffect(() => {
    if (!message) {
      setOpen(false);
      const leave = setTimeout(() => setText(null), EXIT_MS);
      return () => clearTimeout(leave);
    }
    setText(message);
    setDisplayTone(tone);
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, [message, tone]);

  useEffect(() => {
    if (!message || isStickyProgressMessage(message)) return;
    const t = setTimeout(() => {
      setOpen(false);
      setTimeout(() => onClearRef.current(), EXIT_MS);
    }, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [message]);

  if (!text) return null;

  const top = TOP_NAV_HEIGHT_PX + NAV_GAP_PX;
  const assertive = displayTone === "danger";
  const isSuccess = displayTone === "success";

  return (
    <div
      role="status"
      aria-live={assertive ? "assertive" : "polite"}
      style={{
        position: "fixed",
        left: "50%",
        top,
        zIndex: 102,
        width: "min(416px, calc(100vw - 32px))",
        minWidth: 220,
        padding: "13px 22px",
        borderRadius: 14,
        background: isSuccess
          ? "linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)"
          : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
        border: isSuccess ? "1px solid #86efac" : "1px solid #cbd5e1",
        boxShadow: isSuccess
          ? "0 4px 6px rgba(15, 23, 42, 0.04), 0 18px 48px rgba(15, 23, 42, 0.10), 0 0 0 1px rgba(255,255,255,0.9) inset"
          : "0 4px 6px rgba(15, 23, 42, 0.04), 0 18px 48px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(255,255,255,0.9) inset",
        transform: open ? "translate(-50%, 0)" : "translate(-50%, calc(-100% - 28px))",
        opacity: open ? 1 : 0,
        transition: "transform 0.45s cubic-bezier(0.22, 1, 0.32, 1), opacity 0.38s ease",
        pointerEvents: "none",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: isSuccess ? "#15803d" : "#0f172a",
          lineHeight: 1.5,
          letterSpacing: "-0.02em",
        }}
      >
        {text}
      </div>
    </div>
  );
}
