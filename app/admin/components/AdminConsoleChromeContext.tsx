"use client";

import { createContext, useContext, type ReactNode } from "react";

import { ADMIN_SIDEBAR_EXPANDED_PX } from "./admin-console-constants";

type Value = { sidebarWidthPx: number };

const Ctx = createContext<Value>({ sidebarWidthPx: ADMIN_SIDEBAR_EXPANDED_PX });

export function AdminConsoleChromeProvider({
  sidebarWidthPx,
  children,
}: {
  sidebarWidthPx: number;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ sidebarWidthPx }}>{children}</Ctx.Provider>;
}

export function useAdminConsoleChrome(): Value {
  return useContext(Ctx);
}
