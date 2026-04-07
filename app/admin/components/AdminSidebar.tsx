"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import {
  ADMIN_SIDEBAR_COLLAPSED_PX,
  ADMIN_SIDEBAR_EXPANDED_PX,
  ADMIN_SIDEBAR_OPS_SECTION_LS_KEY,
  ADMIN_TOP_BAR_PX,
} from "./admin-console-constants";
import { type AdminNavIcon, type AdminNavId, NAV_ITEMS, NAV_SECTIONS } from "./admin-nav-config";

type AdminSidebarProps = {
  projectDisplayName: string;
  activeNav: AdminNavId;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function NavIconHome() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: "block" }}>
      <path d="M3 10.5L12 3l9 7.5V21a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-10.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function NavIconDoc() {
  const sw = 1.7;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <rect x="5" y="4" width="14" height="16" rx="2.5" stroke="currentColor" strokeWidth={sw} />
      <path
        d="M8.5 9h7M8.5 12h7M8.5 15h7"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
}

function NavIconPostbox() {
  const sw = 1.7;
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth={sw} />
      <path
        d="M2 4l10 8 10-8"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavIconNotice() {
  const sw = 1.7;
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      <path
        d="M11 5L6 9H3v6h3l5 4V5z"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9.5a3.5 3.5 0 010 5M18 7a7 7 0 010 10"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
}

function renderNavIcon(icon: AdminNavIcon) {
  switch (icon) {
    case "home":    return <NavIconHome />;
    case "doc":     return <NavIconDoc />;
    case "postbox": return <NavIconPostbox />;
    case "notice":  return <NavIconNotice />;
  }
}

/** 사이드 접기: 왼쪽 쌍셰브론 느낌 */
function IconSidebarCollapse() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M14 7l-5 5 5 5M19 7l-5 5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 사이드 펼치기 */
function IconSidebarExpand() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ItemProps = {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  sub?: string;
  collapsed: boolean;
  /** 「운영」 등 그룹 안 항목 — 살짝 들여쓰기 */
  nestIndent?: boolean;
};

function IconChevronSection({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{
        color: "#64748b",
        flexShrink: 0,
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
        transition: "transform 0.18s ease",
      }}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 상단 탭(AdminTopBar)과 동일 슬레이트 톤 */
const BAR_SLATE = "#0f172a";

/** 사이드바 요소 ↔ 왼쪽(가로) 간격만 ~30% 넓힘 — 세로는 별도 상수 */
function inset(n: number) {
  return Math.round(n * 1.3);
}

/** 세로 간격 (기준값 × 1.2 ≈ 20% 넓힘) */
function vSpace(n: number) {
  return Math.round(n * 1.2);
}

const SIDEBAR_NAV_PAD_TOP = vSpace(10);
const SIDEBAR_NAV_PAD_BOTTOM = vSpace(20);
const SIDEBAR_ITEM_PAD_Y = vSpace(10);
const SIDEBAR_ITEM_PAD_Y_COLLAPSED = vSpace(8);
const SIDEBAR_SEP_MARGIN_Y = vSpace(8);
const SIDEBAR_HEADER_PAD_TOP = vSpace(12);
const SIDEBAR_HEADER_PAD_BOTTOM = vSpace(10);
const SIDEBAR_HEADER_COLLAPSE_PAD_Y = vSpace(10);
const SIDEBAR_OPS_PAD_Y = vSpace(7);
const SIDEBAR_OPS_MARGIN_BOTTOM = vSpace(5);

/** 한 줄 라벨과 아이콘을 같은 높이 박스로 맞춤 */
const SIDEBAR_NAV_ICON_BOX_PX = 26;

function SidebarNavItem({ href, active, icon, label, sub, collapsed, nestIndent }: ItemProps) {
  const hasSub = Boolean(sub);
  const padLeft = collapsed ? 0 : nestIndent ? Math.round(inset(32) * 1.2 * 1.2) : inset(15);
  const mx = inset(8);
  return (
    <Link
      href={href}
      title={collapsed ? (sub ? `${label} — ${sub}` : label) : undefined}
      className={`admin-sidebar-nav-item${active ? " admin-sidebar-nav-item--active" : ""}`}
      style={{
        display: "flex",
        alignItems: hasSub ? "flex-start" : "center",
        gap: 12,
        padding: collapsed
          ? `${SIDEBAR_ITEM_PAD_Y_COLLAPSED}px 0`
          : `${SIDEBAR_ITEM_PAD_Y}px ${inset(14)}px ${SIDEBAR_ITEM_PAD_Y}px ${padLeft}px`,
        margin: `0 ${mx}px`,
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 8,
        textDecoration: "none",
        color: active ? BAR_SLATE : "#475569",
        background: active ? "rgba(15, 23, 42, 0.06)" : "transparent",
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        lineHeight: 1.4,
        transition: "background 0.12s, color 0.12s",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: SIDEBAR_NAV_ICON_BOX_PX,
          flexShrink: 0,
          color: active ? BAR_SLATE : "#64748b",
        }}
        aria-hidden
      >
        {icon}
      </span>
      {!collapsed && (
        <span
          style={{
            display: "flex",
            flexDirection: "column",
            gap: hasSub ? 3 : 0,
            minWidth: 0,
          }}
        >
          <span>{label}</span>
          {sub && (
            <span style={{ fontSize: 11, fontWeight: 500, color: active ? "#64748b" : "#94a3b8", lineHeight: 1.35 }}>{sub}</span>
          )}
        </span>
      )}
    </Link>
  );
}

export function AdminSidebar({
  projectDisplayName,
  activeNav,
  collapsed,
  onToggleCollapsed,
}: AdminSidebarProps) {
  const w = collapsed ? ADMIN_SIDEBAR_COLLAPSED_PX : ADMIN_SIDEBAR_EXPANDED_PX;
  const [opsOpen, setOpsOpen] = useState(true);


  useEffect(() => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem(ADMIN_SIDEBAR_OPS_SECTION_LS_KEY) === "1") {
        setOpsOpen(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function toggleOpsOpen() {
    setOpsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ADMIN_SIDEBAR_OPS_SECTION_LS_KEY, next ? "0" : "1");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside
      style={{
        position: "fixed",
        top: ADMIN_TOP_BAR_PX,
        left: 0,
        bottom: 0,
        width: w,
        zIndex: 90,
        background: "#fff",
        borderRight: "1px solid #e8ecef",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.2s ease",
        boxShadow: "2px 0 12px rgba(15, 23, 42, 0.04)",
      }}
    >
      <style>{`
        .admin-sidebar-collapse-toggle:focus,
        .admin-sidebar-collapse-toggle:focus-visible,
        .admin-sidebar-ops-toggle:focus,
        .admin-sidebar-ops-toggle:focus-visible {
          outline: none;
          box-shadow: none;
        }
        /* 사이드바(#fff)와 동일 — slate 배경·브라우저 기본 버튼 틴트 제거 */
        .admin-sidebar-ops-toggle {
          appearance: none;
          -webkit-appearance: none;
          background: #fff !important;
          color: #334155 !important;
        }
        .admin-sidebar-ops-toggle:hover,
        .admin-sidebar-ops-toggle:active,
        .admin-sidebar-ops-toggle:focus,
        .admin-sidebar-ops-toggle:focus-visible,
        .admin-sidebar-ops-toggle[aria-expanded="true"] {
          background: #fff !important;
          color: #334155 !important;
        }
        .admin-sidebar-nav-item:hover:not(.admin-sidebar-nav-item--active) {
          background: rgba(15, 23, 42, 0.04) !important;
        }
      `}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          padding: collapsed
            ? `${SIDEBAR_HEADER_COLLAPSE_PAD_Y}px ${inset(8)}px`
            : `${SIDEBAR_HEADER_PAD_TOP}px ${inset(14)}px ${SIDEBAR_HEADER_PAD_BOTTOM}px ${inset(26)}px`,
          borderBottom: "1px solid #f1f5f9",
          minHeight: vSpace(50),
          gap: 8,
        }}
      >
        {!collapsed && (
          <div
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: "#1e293b",
              letterSpacing: "-0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
          >
            {projectDisplayName}
          </div>
        )}
        <button
          type="button"
          className="admin-sidebar-collapse-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? "펼치기" : "접기"}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          style={{
            width: 34,
            height: 34,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: "#334155",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            outline: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {collapsed ? <IconSidebarExpand /> : <IconSidebarCollapse />}
        </button>
      </div>

      <nav
        style={{
          flex: 1,
          overflowY: "auto",
          padding: `${SIDEBAR_NAV_PAD_TOP}px 0 ${SIDEBAR_NAV_PAD_BOTTOM}px`,
        }}
      >
        {NAV_ITEMS.filter(item => !item.section).map(item => (
          <SidebarNavItem
            key={item.id}
            href={item.href}
            active={activeNav === item.id}
            collapsed={collapsed}
            icon={renderNavIcon(item.icon)}
            label={item.label}
            sub={item.sub}
          />
        ))}
        {NAV_SECTIONS.length > 0 && (
          <div
            role="separator"
            style={{
              height: 1,
              margin: `${SIDEBAR_SEP_MARGIN_Y}px ${inset(16)}px`,
              background: "#e2e8f0",
              flexShrink: 0,
            }}
          />
        )}
        {collapsed ? (
          <>
            {NAV_SECTIONS.flatMap(section =>
              NAV_ITEMS.filter(item => item.section === section.id)
            ).map(item => (
              <SidebarNavItem
                key={item.id}
                href={item.href}
                active={activeNav === item.id}
                collapsed
                icon={renderNavIcon(item.icon)}
                label={item.label}
                sub={item.sub}
              />
            ))}
          </>
        ) : (
          <>
            {NAV_SECTIONS.map(section => {
              const sectionItems = NAV_ITEMS.filter(item => item.section === section.id);
              if (sectionItems.length === 0) return null;
              return (
                <div key={section.id}>
                  {section.collapsible ? (
                    <>
                      <button
                        type="button"
                        className="admin-sidebar-ops-toggle"
                        onClick={toggleOpsOpen}
                        aria-expanded={opsOpen}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: `calc(100% - ${inset(8) * 2}px)`,
                          margin: `0 ${inset(8)}px ${SIDEBAR_OPS_MARGIN_BOTTOM}px`,
                          padding: `${SIDEBAR_OPS_PAD_Y}px ${inset(12)}px`,
                          borderRadius: 6,
                          border: "none",
                          background: "#fff",
                          color: "#334155",
                          fontSize: 14,
                          fontWeight: 400,
                          lineHeight: 1.35,
                          letterSpacing: "-0.02em",
                          fontFamily: "inherit",
                          cursor: "pointer",
                          textAlign: "left",
                          outline: "none",
                          WebkitTapHighlightColor: "transparent",
                        }}
                      >
                        <span>{section.label}</span>
                        <IconChevronSection open={opsOpen} />
                      </button>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateRows: opsOpen ? "1fr" : "0fr",
                          transition: "grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                        inert={opsOpen ? undefined : true}
                      >
                        <div style={{ overflow: "hidden", minHeight: 0 }}>
                          {sectionItems.map(item => (
                            <SidebarNavItem
                              key={item.id}
                              href={item.href}
                              active={activeNav === item.id}
                              collapsed={false}
                              icon={renderNavIcon(item.icon)}
                              label={item.label}
                              sub={item.sub}
                              nestIndent
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    sectionItems.map(item => (
                      <SidebarNavItem
                        key={item.id}
                        href={item.href}
                        active={activeNav === item.id}
                        collapsed={false}
                        icon={renderNavIcon(item.icon)}
                        label={item.label}
                        sub={item.sub}
                        nestIndent
                      />
                    ))
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}
