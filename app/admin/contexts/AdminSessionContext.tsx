"use client";

import { createContext, useContext } from "react";

export type AdminSessionValue = {
  webMode: boolean | null;
  adminSession: boolean;
  bootstrapped: boolean;
  useClientStorage: boolean;
  displayEmail: string | null;
  projectDisplayName: string;
  logout: () => Promise<void>;
  /** 작업 중 nav/logout 잠금 여부. 페이지가 setNavLocked(true)로 활성화. */
  navLocked: boolean;
  setNavLocked: (locked: boolean) => void;
};

export const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function useAdminSessionContext(): AdminSessionValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession() must be used inside <AdminShell>");
  return ctx;
}
