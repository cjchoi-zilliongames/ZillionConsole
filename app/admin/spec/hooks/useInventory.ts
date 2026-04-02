"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ChartMemos } from "@/lib/spec/chart-memos";
import type { StorageService, InventoryResult } from "./useStorageService";

export type InventoryFile = {
  fullPath: string;
  folder: string;
  /** 표시용 파일명 (버전 마커 제거). 예: "Hero.csv" */
  displayName: string;
  version: number;
  /** 실제 Storage 파일명. 예: "Hero{3}.csv" */
  fileName: string;
  /** 구형 파일 호환용 */
  spec?: string;
};

export type InventoryState = {
  folders: string[];
  files: InventoryFile[];
  globalMaxVersionBySpec: Record<string, number>;
} | null;

export function useInventory(service: StorageService) {
  const router = useRouter();
  // Always hold latest service without it being a useCallback dependency
  const serviceRef = useRef(service);
  serviceRef.current = service;

  const [inventory, setInventory] = useState<InventoryState>(null);
  const [loadingInv, setLoadingInv] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);
  const [chartMemos, setChartMemos] = useState<ChartMemos>({});
  /** `chart-memos.json` Storage generation — 저장 시 동시 수정 방지 */
  const [chartMemosGeneration, setChartMemosGeneration] = useState<string | null>(null);
  const refreshInventory = useCallback(
    async (opts?: { soft?: boolean }): Promise<InventoryResult | null> => {
      const svc = serviceRef.current;
      const soft = opts?.soft === true;
      if (!soft) setLoadingInv(true);
      setInvError(null);
      try {
        const [inv, snap] = await Promise.all([
          svc.fetchInventory(),
          svc.getChartMemos().catch(() => ({ memos: {} as ChartMemos, generation: null as string | null })),
        ]);

        let memos: ChartMemos = snap.memos;
        let generation: string | null = snap.generation;
        const validPaths = new Set(inv.files.map((f) => f.fullPath));
        const orphanKeys = Object.keys(memos).filter((k) => !validPaths.has(k));

        if (orphanKeys.length > 0) {
          try {
            const pruned = await svc.pruneOrphanChartMemos(snap.generation);
            memos = pruned.memos;
            generation = pruned.generation;
          } catch {
            /* 409·generation 누락·네트워크 등 — GET 스냅샷 유지, 다음 새로고침에 재시도 */
          }
        }

        setInventory(inv as InventoryState);
        setChartMemos(memos);
        setChartMemosGeneration(generation);
        return inv;
      } catch (e) {
        if (e instanceof Error && e.message === "Unauthorized") {
          router.replace("/admin/login");
          return null;
        }
        setInvError(e instanceof Error ? e.message : "네트워크 오류 또는 권한이 없습니다.");
        setInventory(null);
        return null;
      } finally {
        if (!soft) setLoadingInv(false);
      }
    },
    [router]
  );

  return {
    inventory,
    loadingInv,
    invError,
    chartMemos,
    setChartMemos,
    chartMemosGeneration,
    setChartMemosGeneration,
    refreshInventory,
  };
}
