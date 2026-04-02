"use client";

import { useState } from "react";
import type { StorageService } from "./useStorageService";
import type { InventoryFile } from "./useInventory";
import { signalChartChange } from "@/lib/firestore-chart-signal";

type FolderState = {
  folderNames: Record<string, string>;
  setFolderNames: (names: Record<string, string>) => void;
  liveFolder: string | null;
  labelOf: (prefix: string) => string;
};

export type MergeConflict = {
  displayName: string;
  srcVersions: number[];
  destVersions: number[];
};

/** 스토리지에 실제로 있는 폴더에 붙은 표시명만 중복으로 본다 (병합·삭제 후 남은 localStorage 고아 키 무시) */
function isDisplayNameUsedByActiveFolder(
  displayName: string,
  names: Record<string, string>,
  activeFolderPrefixes: string[]
): boolean {
  const norm = displayName.trim();
  const active = new Set(activeFolderPrefixes);
  return Object.entries(names).some(
    ([prefix, label]) => active.has(prefix) && label.trim() === norm
  );
}

export function useFolderOperations(
  service: StorageService,
  folderState: FolderState,
  allFiles: InventoryFile[],
  folders: string[],
  refreshInventory: (opts?: { soft?: boolean }) => Promise<{ folders: string[] } | null>
) {
  const { folderNames, setFolderNames, liveFolder, labelOf } = folderState;

  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMsg, setFolderMsg] = useState<string | null>(null);
  const [folderSyncing, setFolderSyncing] = useState(false);

  // Create folder
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Rename folder
  const [renameFolderTarget, setRenameFolderTarget] = useState<string | null>(null);
  const [renameFolderNewName, setRenameFolderNewName] = useState("");

  // Delete folder
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<string | null>(null);
  const [deleteFolderFileCount, setDeleteFolderFileCount] = useState(0);

  // Merge to live
  const [mergeLivePending, setMergeLivePending] = useState<{
    sourceFolder: string;
    conflicts: MergeConflict[];
    additions: string[];
  } | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeFinishing, setMergeFinishing] = useState(false);

  // Live route change confirmation
  const [liveChangePending, setLiveChangePending] = useState<{ targetFolder: string | null } | null>(null);

  async function syncFolderRoutesManifest(
    folderNamesMap: Record<string, string>,
    opts?: { folderRootsHint?: string[] }
  ) {
    const liveVirtual = liveFolder
      ? (folderNamesMap[liveFolder]?.trim() || liveFolder.replace(/\/$/, ""))
      : null;
    setFolderSyncing(true);
    try {
      await service.publishFolderRoutes(folderNamesMap, liveVirtual, opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "게시 실패";
      setFolderMsg(`Unity 매핑 JSON 갱신 실패: ${msg}`);
    } finally {
      setFolderSyncing(false);
    }
  }

  async function handleCreateFolder(displayName: string) {
    if (!displayName) return;
    if (isDisplayNameUsedByActiveFolder(displayName, folderNames, folders)) {
      setFolderMsg(`"${displayName}" 이름이 이미 사용 중입니다`);
      return;
    }
    let actualPath: string;
    do {
      const buf = new Uint8Array(4);
      crypto.getRandomValues(buf);
      actualPath = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
    } while (folders.includes(`${actualPath}/`));
    setFolderBusy(true);
    setFolderMsg(null);
    try {
      await service.createFolder(actualPath);
      const updated = { ...folderNames, [`${actualPath}/`]: displayName };
      setFolderNames(updated);
      setCreateFolderOpen(false);
      setNewFolderName("");
      // 인벤토리 전체 스캔과 매니페스트 게시를 병렬로 — 순차면 게시가 불필요하게 늦어짐
      const newPrefix = `${actualPath}/`;
      const folderRootsHint = [...new Set([...folders, newPrefix])];
      await Promise.all([
        refreshInventory({ soft: true }),
        syncFolderRoutesManifest(updated, { folderRootsHint }),
      ]);
    } catch (e) {
      setFolderMsg(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setFolderBusy(false);
    }
  }

  function openRenameFolder(folder: string) {
    setDeleteFolderTarget(null);
    setRenameFolderTarget(folder);
    setRenameFolderNewName(folderNames[folder] ?? folder.replace(/\/$/, ""));
  }

  /** 표시명만 갱신. 성공 시 `null`, 실패 시 에러 문구. (다이얼로그·인라인 편집 공통) */
  function applyFolderDisplayRename(folder: string, rawNewDisplay: string): string | null {
    const newName = rawNewDisplay.trim();
    if (!newName) return "이름을 입력하세요";
    const currentLabel = (folderNames[folder] ?? folder.replace(/\/$/, "")).trim();
    if (newName === currentLabel) return null;
    const duplicate = Object.entries(folderNames).find(
      ([k, v]) => k !== folder && folders.includes(k) && v.trim() === newName
    );
    if (duplicate) return `"${newName}" 이름이 이미 사용 중입니다`;
    const updated = { ...folderNames, [folder]: newName };
    setFolderNames(updated);
    void syncFolderRoutesManifest(updated, { folderRootsHint: folders });
    return null;
  }

  function confirmRenameFolder(onValidationError?: (msg: string) => void) {
    if (!renameFolderTarget) return;
    const err = applyFolderDisplayRename(renameFolderTarget, renameFolderNewName);
    if (err) {
      onValidationError?.(err);
      return;
    }
    setRenameFolderTarget(null);
    setRenameFolderNewName("");
  }

  function openDeleteFolder(folder: string, selectedFolder: string | null, setSelectedFolder: (f: string | null) => void) {
    setRenameFolderTarget(null);
    setFolderMsg(null);
    if (folder !== selectedFolder) setSelectedFolder(folder);
    setDeleteFolderFileCount(allFiles.filter((f) => f.folder === folder).length);
    setDeleteFolderTarget(folder);
  }

  async function confirmDeleteFolder() {
    if (!deleteFolderTarget) return;
    const target = deleteFolderTarget;
    const nextNames = { ...folderNames };
    delete nextNames[target];
    setFolderBusy(true);
    setFolderMsg(null);
    setDeleteFolderTarget(null);
    try {
      await service.deleteFolder(target);
      setFolderNames(nextNames);
      void signalChartChange({ folderNames: nextNames });
      const inv = await refreshInventory({ soft: true });
      void syncFolderRoutesManifest(nextNames, { folderRootsHint: inv?.folders });
    } catch (e) {
      setFolderMsg(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setFolderBusy(false);
    }
  }

  async function deleteEmptyFolder(folder: string) {
    const nextNames = { ...folderNames };
    delete nextNames[folder];
    setFolderBusy(true);
    setFolderMsg(null);
    try {
      await service.deleteFolder(folder);
      setFolderNames(nextNames);
      void signalChartChange({ folderNames: nextNames });
      const inv = await refreshInventory({ soft: true });
      void syncFolderRoutesManifest(nextNames, { folderRootsHint: inv?.folders });
    } catch (e) {
      setFolderMsg(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setFolderBusy(false);
    }
  }

  function openMergeToLive(sourceFolder: string) {
    if (!liveFolder || sourceFolder === liveFolder) return;
    const srcFiles = allFiles.filter((f) => f.folder === sourceFolder);
    const destFiles = allFiles.filter((f) => f.folder === liveFolder);

    const destByDisplay = new Map<string, number[]>();
    for (const f of destFiles) {
      const arr = destByDisplay.get(f.displayName) ?? [];
      arr.push(f.version);
      destByDisplay.set(f.displayName, arr);
    }

    const conflicts: MergeConflict[] = [];
    const additions: string[] = [];
    const seenSrc = new Map<string, number[]>();
    for (const f of srcFiles) {
      const arr = seenSrc.get(f.displayName) ?? [];
      arr.push(f.version);
      seenSrc.set(f.displayName, arr);
    }
    for (const [displayName, srcVersions] of seenSrc) {
      const destVersions = destByDisplay.get(displayName);
      if (destVersions) {
        conflicts.push({
          displayName,
          srcVersions: srcVersions.sort((a, b) => a - b),
          destVersions: destVersions.sort((a, b) => a - b),
        });
      } else {
        additions.push(displayName);
      }
    }

    setMergeLivePending({ sourceFolder, conflicts, additions });
  }

  async function confirmMergeToLive(
    onComplete?: (sourceFolder: string) => void,
    onFileComplete?: (displayName: string) => void,
  ) {
    if (!mergeLivePending || !liveFolder) return;
    const { sourceFolder } = mergeLivePending;
    setMergeBusy(true);
    try {
      const movedCount = await service.mergeFolder(sourceFolder, liveFolder, onFileComplete);
      await new Promise((r) => setTimeout(r, 380));
      setMergeFinishing(true);
      const inv = await refreshInventory({ soft: true });

      if (movedCount > 0 && inv) {
        const allowed = new Set(inv.folders);
        const nextNames = { ...folderNames };
        const pruned: Record<string, string> = {};
        for (const [k, v] of Object.entries(nextNames)) {
          if (allowed.has(k)) pruned[k] = v;
        }
        setFolderNames(pruned);
        await syncFolderRoutesManifest(pruned, { folderRootsHint: inv.folders });
      }
      setMergeLivePending(null);
      onComplete?.(sourceFolder);
    } catch (e) {
      setFolderMsg(`병합 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMergeFinishing(false);
      setMergeBusy(false);
    }
  }

  async function updateLiveRoute(liveRoute: string | null) {
    try {
      await service.setLiveRoute(liveRoute);
    } catch (e) {
      setFolderMsg(`라이브 설정 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function requestLiveFolderChange(folder: string | null) {
    setLiveChangePending({ targetFolder: folder });
  }

  return {
    // state
    folderBusy,
    folderSyncing,
    folderMsg,
    setFolderMsg,
    createFolderOpen,
    setCreateFolderOpen,
    newFolderName,
    setNewFolderName,
    renameFolderTarget,
    setRenameFolderTarget,
    renameFolderNewName,
    setRenameFolderNewName,
    deleteFolderTarget,
    setDeleteFolderTarget,
    deleteFolderFileCount,
    mergeLivePending,
    setMergeLivePending,
    mergeBusy,
    mergeFinishing,
    liveChangePending,
    setLiveChangePending,
    // actions
    handleCreateFolder,
    openRenameFolder,
    confirmRenameFolder,
    applyFolderDisplayRename,
    openDeleteFolder,
    confirmDeleteFolder,
    openMergeToLive,
    confirmMergeToLive,
    updateLiveRoute,
    requestLiveFolderChange,
    syncFolderRoutesManifest,
    deleteEmptyFolder,
    labelOf,
  };
}
