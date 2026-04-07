"use client";

import { createContext, useContext, useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { ADMIN_SIDEBAR_EXPANDED_PX } from "./admin-console-constants";

type Value = {
  sidebarWidthPx: number;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
};

const noop: Dispatch<SetStateAction<boolean>> = () => {};

const Ctx = createContext<Value>({
  sidebarWidthPx: ADMIN_SIDEBAR_EXPANDED_PX,
  historyOpen: false,
  setHistoryOpen: noop,
});

export function AdminConsoleChromeProvider({
  sidebarWidthPx,
  historyOpen,
  setHistoryOpen,
  children,
}: {
  sidebarWidthPx: number;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ sidebarWidthPx, historyOpen, setHistoryOpen }),
    [sidebarWidthPx, historyOpen, setHistoryOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdminConsoleChrome(): Value {
  return useContext(Ctx);
}
