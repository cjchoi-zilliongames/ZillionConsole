"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { AdminConsoleChromeProvider } from "./AdminConsoleChromeContext";
import { AdminSidebar } from "./AdminSidebar";
import { type AdminNavId } from "./admin-nav-config";
import { AdminTopBar } from "./AdminTopBar";
import {
  ADMIN_SIDEBAR_COLLAPSED_LS_KEY,
  ADMIN_SIDEBAR_COLLAPSED_PX,
  ADMIN_SIDEBAR_EXPANDED_PX,
  ADMIN_TOP_BAR_PX,
} from "./admin-console-constants";

type AdminConsoleLayoutProps = {
  children: ReactNode;
  activeNav: AdminNavId;
  projectDisplayName: string;
  useClientStorage: boolean;
  displayEmail: string | null;
  onLogout: () => void | Promise<void>;
};

export function AdminConsoleLayout({
  children,
  activeNav,
  projectDisplayName,
  useClientStorage,
  displayEmail,
  onLogout,
}: AdminConsoleLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_LS_KEY) === "1") {
        setSidebarCollapsed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_LS_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const mainMargin = sidebarCollapsed ? ADMIN_SIDEBAR_COLLAPSED_PX : ADMIN_SIDEBAR_EXPANDED_PX;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f0f4f8",
        fontFamily:
          'var(--font-admin-ui), var(--font-geist-sans), "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "#111827",
      }}
    >
      <AdminTopBar
        projectDisplayName={projectDisplayName}
        useClientStorage={useClientStorage}
        displayEmail={displayEmail}
        onLogout={() => void onLogout()}
      />
      <AdminSidebar
        projectDisplayName={projectDisplayName}
        activeNav={activeNav}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      />

      <AdminConsoleChromeProvider sidebarWidthPx={mainMargin}>
        <div
          style={{
            marginLeft: mainMargin,
            paddingTop: ADMIN_TOP_BAR_PX,
            minHeight: "100vh",
            transition: "margin-left 0.2s ease",
            /* 사이드바와 본문 사이 여백 (+30%) */
            paddingLeft: "clamp(26px, 3.9vw, 52px)",
            paddingRight: "clamp(20px, 4vw, 48px)",
            boxSizing: "border-box",
          }}
        >
          <div style={{ width: "100%", maxWidth: 1600 }}>
            {children}
          </div>
        </div>
      </AdminConsoleChromeProvider>
    </div>
  );
}
