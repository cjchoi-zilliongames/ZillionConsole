"use client";

import { ADMIN_TOP_BAR_PX } from "./admin-console-constants";

/** 로그인 화면 — 기존 TopNavbar(메뉴 없음)와 동일한 상단 탭 */
export function AdminLoginBar() {
  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: ADMIN_TOP_BAR_PX,
        background: "#0f172a",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        display: "flex",
        alignItems: "center",
        padding: "0 28px",
        zIndex: 100,
        boxShadow: "0 2px 16px rgba(0,0,0,0.28)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Zillion Games" height={34} width={34} style={{ display: "block", flexShrink: 0 }} />
      <span style={{ color: "#fff", fontWeight: 800, fontSize: 20, letterSpacing: "0.08em", marginLeft: 10, flexShrink: 0 }}>
        ZILLION
      </span>
    </nav>
  );
}
