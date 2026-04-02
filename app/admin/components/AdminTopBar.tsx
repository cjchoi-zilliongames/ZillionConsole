"use client";

import { ADMIN_TOP_BAR_PX } from "./admin-console-constants";

type AdminTopBarProps = {
  projectDisplayName: string;
  useClientStorage: boolean;
  displayEmail: string | null;
  onLogout: () => void;
};

/** 기존 TopNavbar와 동일한 상단 탭. 네비는 사이드바 — 여기서는 프로젝트명만 표시 */
export function AdminTopBar({
  projectDisplayName,
  useClientStorage,
  displayEmail,
  onLogout,
}: AdminTopBarProps) {
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
        gap: 0,
        zIndex: 100,
        boxShadow: "0 2px 16px rgba(0,0,0,0.28)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="Zillion Games" height={34} width={34} style={{ display: "block", flexShrink: 0 }} />
      <span style={{ color: "#fff", fontWeight: 800, fontSize: 20, letterSpacing: "0.08em", marginLeft: 10, flexShrink: 0 }}>
        ZILLION
      </span>

      <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.15)", margin: "0 20px", flexShrink: 0 }} />

      <span
        style={{
          color: "rgba(255,255,255,0.9)",
          fontWeight: 700,
          fontSize: 18,
          maxWidth: 320,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {projectDisplayName}
      </span>

      <div style={{ flex: 1 }} />

      {displayEmail !== null && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 9px",
            borderRadius: 6,
            marginRight: 16,
            background: useClientStorage ? "rgba(37,99,235,0.25)" : "rgba(5,150,105,0.25)",
            color: useClientStorage ? "#93c5fd" : "#6ee7b7",
            border: `1px solid ${useClientStorage ? "rgba(37,99,235,0.4)" : "rgba(5,150,105,0.4)"}`,
            letterSpacing: "0.04em",
          }}
        >
          {useClientStorage ? "Firebase" : "서버 세션"}
        </span>
      )}

      {displayEmail && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 16 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #f472b6, #818cf8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            {displayEmail[0].toUpperCase()}
          </div>
          <span
            style={{
              color: "rgba(255,255,255,0.65)",
              fontSize: 13,
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayEmail}
          </span>
        </div>
      )}

      {displayEmail !== null && (
        <button
          type="button"
          onClick={onLogout}
          style={{
            padding: "7px 16px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.75)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.12)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          }}
        >
          로그아웃
        </button>
      )}
    </nav>
  );
}
