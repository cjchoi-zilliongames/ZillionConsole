"use client";

import { useCallback, useState } from "react";
import type { InventoryFile } from "./useInventory";

type FileGroup = { displayName: string; versions: InventoryFile[] };

export function useFileSelection() {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [activePathByDisplay, setActivePathByDisplay] = useState<Record<string, string>>({});

  /** 같은 차트(displayName) 행의 모든 버전 파일을 한 번에 선택/해제 */
  function toggleGroup(versions: InventoryFile[]) {
    const paths = versions.map((v) => v.fullPath);
    if (paths.length === 0) return;
    setSelectedPaths((prev) => {
      const allIn = paths.every((p) => prev.has(p));
      const n = new Set(prev);
      if (allIn) {
        for (const p of paths) n.delete(p);
      } else {
        for (const p of paths) n.add(p);
      }
      return n;
    });
  }

  function toggleAll(fileGroups: FileGroup[], allSelected: boolean) {
    if (allSelected) {
      setSelectedPaths(new Set());
    } else {
      const paths = fileGroups.flatMap((g) => g.versions.map((v) => v.fullPath));
      setSelectedPaths(new Set(paths));
    }
  }

  function clear() {
    setSelectedPaths(new Set());
  }

  /** 미리보기/메모용 활성 버전만 바꿈. 행 선택(selectedPaths)은 같은 행의 모든 버전이 묶여 유지됨 */
  const pickVersionInGroup = useCallback((displayName: string, chosen: InventoryFile) => {
    setActivePathByDisplay((p) => ({ ...p, [displayName]: chosen.fullPath }));
  }, []);

  const syncActivePathsToGroups = useCallback((fileGroups: FileGroup[]) => {
    setActivePathByDisplay((prev) => {
      const next: Record<string, string> = {};
      for (const g of fileGroups) {
        const paths = new Set(g.versions.map((v) => v.fullPath));
        const newest = g.versions[g.versions.length - 1]!;
        next[g.displayName] =
          prev[g.displayName] && paths.has(prev[g.displayName]!)
            ? prev[g.displayName]!
            : newest.fullPath;
      }
      return next;
    });
  }, []);

  return {
    selectedPaths,
    setSelectedPaths,
    activePathByDisplay,
    setActivePathByDisplay,
    toggleGroup,
    toggleAll,
    clear,
    pickVersionInGroup,
    syncActivePathsToGroups,
  };
}
