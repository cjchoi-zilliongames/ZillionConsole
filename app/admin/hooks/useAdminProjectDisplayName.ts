"use client";

import { useEffect, useState } from "react";

import { resolveAdminProjectDisplayName } from "@/lib/admin-project-display";
import { getFirebaseOptionsFromBrowser } from "@/lib/firebase-web-config-storage";

/** 브라우저 기준 현재 연결된 Firebase 프로젝트 표시명 */
export function useAdminProjectDisplayName(): string {
  // 초기값은 SSR·hydration 첫 페인트와 동일해야 함 — window/localStorage는 effect에서만 읽는다.
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    setProjectId(getFirebaseOptionsFromBrowser()?.projectId ?? null);
  }, []);

  return resolveAdminProjectDisplayName(projectId);
}
