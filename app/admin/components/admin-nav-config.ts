export type AdminNavSection = {
  id: string;
  label: string;
  collapsible?: boolean;
};

export type AdminNavIcon = "home" | "doc" | "postbox" | "notice";

export type AdminNavItem = {
  id: string;
  href: string;
  label: string;
  sub?: string;
  icon: AdminNavIcon;
  section?: string;
};

export const NAV_SECTIONS: AdminNavSection[] = [
  { id: "ops", label: "운영", collapsible: true },
];

export const NAV_ITEMS: readonly AdminNavItem[] = [
  { id: "home",    href: "/admin",         label: "홈",       icon: "home" },
  { id: "spec",    href: "/admin/spec",    label: "차트 관리", icon: "doc",     section: "ops" },
  { id: "postbox", href: "/admin/postbox", label: "우편", icon: "postbox", section: "ops" },
  { id: "notice",  href: "/admin/notice",  label: "공지", icon: "notice",  section: "ops" },
] as const;

/** AdminNavId는 NAV_ITEMS에서 자동 도출 — 새 기능 추가 시 이 파일만 수정하면 됨 */
export type AdminNavId = (typeof NAV_ITEMS)[number]["id"];

/** pathname → activeNav 결정 */
export function resolveActiveNav(pathname: string): AdminNavId {
  // 정확한 매칭을 먼저, 그 다음 prefix 매칭 (더 긴 href 우선)
  const sorted = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  for (const item of sorted) {
    if (item.href === "/admin") {
      if (pathname === "/admin") return item.id;
    } else if (pathname.startsWith(item.href)) {
      return item.id;
    }
  }
  return "home";
}
