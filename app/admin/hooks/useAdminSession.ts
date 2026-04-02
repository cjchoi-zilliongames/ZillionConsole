"use client";

import { useAdminSessionContext } from "../contexts/AdminSessionContext";

export function useAdminSession() {
  return useAdminSessionContext();
}
