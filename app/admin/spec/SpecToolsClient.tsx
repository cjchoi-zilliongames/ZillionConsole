"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { parseCsv } from "@/lib/spec/csv-parser";
import { ChartMemosConflictError } from "@/lib/spec/chart-memos";
import { useStorageService } from "./hooks/useStorageService";
import { useInventory } from "./hooks/useInventory";
import type { InventoryFile } from "./hooks/useInventory";
import { SPEC_SELECTED_FOLDER_SESSION_KEY, useFolderState } from "./hooks/useFolderState";
import { useFileSelection } from "./hooks/useFileSelection";
import { useConflictResolver } from "./hooks/useConflictResolver";
import { useFolderOperations } from "./hooks/useFolderOperations";
import { useChartChangeSignal } from "./hooks/useChartChangeSignal";

import { useAdminConsoleChrome } from "../components/AdminConsoleChromeContext";
import { useAdminSession } from "../hooks/useAdminSession";
import {
  ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX,
  ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX,
  adminListPanelToolbarZeroWidthRhythmSpacerStyle,
} from "@/lib/admin-list-table-layout";
import { FolderSidebar } from "./components/FolderSidebar";
import { SpecFilesTable } from "./components/SpecFilesTable";
import { UploadModal } from "./components/UploadModal";
import { DeleteCsvModal } from "./components/DeleteCsvModal";
import { MoveCsvModal } from "./components/MoveCsvModal";
import { ConflictDialog } from "./components/ConflictDialog";
import { MergeConfirmDialog } from "./components/MergeConfirmDialog";
import { LiveRouteChangeDialog } from "./components/LiveRouteChangeDialog";
import { DeleteFolderDialog } from "./components/DeleteFolderDialog";
import { RenameFolderDialog } from "./components/RenameFolderDialog";
import { CSVPreviewModal } from "./components/CSVPreviewModal";
import { SheetsImportModal } from "./components/SheetsImportModal";
import { ChatBot } from "./components/ChatBot";
import { HistoryPanel } from "./components/HistoryPanel";
import { BulkActionToast, type BulkToastTone } from "./components/BulkActionToast";
import { AdminGlobalLoadingOverlay } from "../components/AdminGlobalLoadingOverlay";

/** 앱 버전 폴더 작업 등 — 동일 오버레이, 문구만 구분 */
const ADMIN_FOLDER_BUSY_MESSAGE = "처리 중…";
/** 우편·공지·`AdminGlobalLoadingOverlay`와 동일 */
const ADMIN_DATA_LOADING_MESSAGE = "데이터 불러오는 중…";

function ConsoleDockedBar({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  const { sidebarWidthPx } = useAdminConsoleChrome();
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: sidebarWidthPx + 24,
        zIndex: 110,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SpecToolsClient() {
  const { bootstrapped, useClientStorage, setNavLocked } = useAdminSession();
  const { historyOpen, setHistoryOpen } = useAdminConsoleChrome();

  // ── Core hooks ──────────────────────────────────────────────────────────────
  const folderState = useFolderState();
  const { selectedFolder, setSelectedFolder, liveFolder, setLiveFolder, folderNames, folderIcons, setFolderIcons, labelOf } = folderState;

  const service = useStorageService(useClientStorage, folderNames);
  const {
    inventory,
    loadingInv,
    invError,
    chartMemos,
    setChartMemos,
    chartMemosGeneration,
    setChartMemosGeneration,
    refreshInventory,
  } = useInventory(service);

  const chartSignalDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChartSignal = useCallback((extra: { folderNames?: Record<string, string> } | null) => {
    if (extra?.folderNames) {
      folderState.setFolderNames(extra.folderNames);
    }
    if (chartSignalDebounceRef.current) clearTimeout(chartSignalDebounceRef.current);
    chartSignalDebounceRef.current = setTimeout(() => {
      chartSignalDebounceRef.current = null;
      void refreshInventory({ soft: true });
    }, 280);
  }, [refreshInventory, folderState.setFolderNames]);
  useChartChangeSignal(onChartSignal, bootstrapped);
  const { selectedPaths, setSelectedPaths, activePathByDisplay, setActivePathByDisplay, toggleGroup, toggleAll, syncActivePathsToGroups } = useFileSelection();
  const { conflictFile, conflictApplyAll, setConflictApplyAll, askConflict, resolveConflict, resetApplyAll } = useConflictResolver();

  const folders = inventory?.folders ?? [];

  const folderOps = useFolderOperations(
    service,
    { folderNames: folderState.folderNames, setFolderNames: folderState.setFolderNames, liveFolder, labelOf },
    inventory?.files ?? [],
    folders,
    refreshInventory
  );

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sheetsImportOpen, setSheetsImportOpen] = useState(false);
  const [sheetsImportBusy, setSheetsImportBusy] = useState<boolean | "loading">(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteModalFiles, setDeleteModalFiles] = useState<InventoryFile[]>([]);
  const [moveModalFiles, setMoveModalFiles] = useState<InventoryFile[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkToast, setBulkToast] = useState<{ text: string; tone?: BulkToastTone } | null>(null);
  const clearBulkToast = useCallback(() => setBulkToast(null), []);
  const showBulkToast = useCallback((text: string, tone: BulkToastTone = "default") => {
    setBulkToast({ text, tone });
  }, []);
  const applyFolderDisplayRenameWithToast = useCallback(
    (folder: string, raw: string) => {
      const err = folderOps.applyFolderDisplayRename(folder, raw);
      if (err) showBulkToast(err, "danger");
      return err;
    },
    [folderOps, showBulkToast]
  );
  const [versionFolderSort, setVersionFolderSort] = useState<"asc" | "desc">("asc");
  const [csvPreview, setCsvPreview] = useState<{ displayName: string; rows: string[][] } | null>(null);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [versionPicker, setVersionPicker] = useState<{ displayName: string; x: number; y: number } | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<{ x: number; y: number; file: InventoryFile } | null>(null);
  const [versionChangeTarget, setVersionChangeTarget] = useState<{ file: InventoryFile; value: string } | null>(null);
  const [detailFolder, setDetailFolder] = useState<string | null>(null);
  const [folderCreatedAtMap, setFolderCreatedAtMap] = useState<Record<string, Date>>({});
  const [editingMemoKey, setEditingMemoKey] = useState<string | null>(null);
  const [editingMemoValue, setEditingMemoValue] = useState("");
  const [emptyFolderAfterMove, setEmptyFolderAfterMove] = useState<string | null>(null);
  const [deleteEmptyFolderTarget, setDeleteEmptyFolderTarget] = useState<string | null>(null);
  const [memoSaving, setMemoSaving] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const mergeTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mergeFileStatuses, setMergeFileStatuses] = useState<Record<string, "moving" | "done">>({});

  useEffect(() => {
    if (!bootstrapped) return;
    void refreshInventory();
  }, [bootstrapped, refreshInventory]);

  useEffect(() => {
    return () => {
      if (chartSignalDebounceRef.current) clearTimeout(chartSignalDebounceRef.current);
    };
  }, []);

  // ── 매니페스트에서 폴더 이름/라이브 폴더 동기화 ────────────────────────────
  useEffect(() => {
    if (!bootstrapped) return;
    void service.loadFolderRoutesManifest().then((manifest) => {
      if (!manifest?.routes) return;
      // routes는 { 표시명: 실제prefix } → 뒤집어서 folderNames 형식으로
      const namesFromManifest: Record<string, string> = {};
      for (const [displayName, prefix] of Object.entries(manifest.routes)) {
        namesFromManifest[prefix] = displayName;
      }
      folderState.setFolderNames(namesFromManifest);
      if (manifest.liveRoute) {
        const livePrefix = manifest.routes[manifest.liveRoute];
        if (livePrefix) folderState.setLiveFolder(livePrefix);
      }
    }).catch(() => { /* 매니페스트 없으면 무시 */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped]);

  // ── 작업 중 페이지 이탈 방지 + nav 잠금 ────────────────────────────────────
  const isBusy = folderOps.folderBusy || bulkBusy || memoSaving || folderOps.folderSyncing || mergeProgress > 0;

  useEffect(() => {
    if (!isBusy) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isBusy]);

  useEffect(() => {
    setNavLocked(isBusy);
    return () => { setNavLocked(false); };
  }, [isBusy, setNavLocked]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const sortedVersionFolders = useMemo(() => {
    const cmpFolders = (a: string, b: string) => {
      const cmp = labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: "base" });
      return versionFolderSort === "asc" ? cmp : -cmp;
    };
    const live = liveFolder && folders.includes(liveFolder) ? liveFolder : null;
    const rest = live ? folders.filter((f) => f !== live) : [...folders];
    rest.sort(cmpFolders);
    return live ? [live, ...rest] : rest;
  }, [folders, labelOf, versionFolderSort, liveFolder]);

  const filesInFolder = useMemo(() => {
    if (!inventory?.files || !selectedFolder) return [];
    return inventory.files.filter((f) => f.folder === selectedFolder);
  }, [inventory?.files, selectedFolder]);

  const fileGroupsInFolder = useMemo(() => {
    const map = new Map<string, InventoryFile[]>();
    for (const f of filesInFolder) {
      const arr = map.get(f.displayName) ?? [];
      arr.push(f);
      map.set(f.displayName, arr);
    }
    const groups: { displayName: string; versions: InventoryFile[] }[] = [];
    for (const [displayName, versions] of map) {
      versions.sort((a, b) => a.version - b.version);
      groups.push({ displayName, versions });
    }
    groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return groups;
  }, [filesInFolder]);

  const filteredFileGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return fileGroupsInFolder;
    return fileGroupsInFolder.filter((g) => g.displayName.toLowerCase().includes(q));
  }, [fileGroupsInFolder, searchQuery]);

  const destFoldersForMove = useMemo(
    () => sortedVersionFolders.filter((f) => f !== selectedFolder && f !== liveFolder),
    [sortedVersionFolders, selectedFolder, liveFolder]
  );

  const allVisibleSelected =
    filteredFileGroups.length > 0 &&
    filteredFileGroups.every(
      (g) => g.versions.length > 0 && g.versions.every((v) => selectedPaths.has(v.fullPath))
    );

  // ── Sync effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedFolder) {
      try {
        sessionStorage.setItem(SPEC_SELECTED_FOLDER_SESSION_KEY, selectedFolder);
      } catch { /* ignore */ }
    }
  }, [selectedFolder]);

  useEffect(() => {
    if (inventory === null) return;
    const f = inventory.folders;
    if (!f.length) {
      try {
        sessionStorage.removeItem(SPEC_SELECTED_FOLDER_SESSION_KEY);
      } catch { /* ignore */ }
      setSelectedFolder(null);
      return;
    }
    setSelectedFolder((prev) => (prev && f.includes(prev) ? prev : f[0]!));
  }, [inventory, setSelectedFolder]);

  useEffect(() => {
    setSelectedPaths(new Set());
    setBulkToast(null);
    setVersionPicker(null);
    setSearchQuery("");
  }, [selectedFolder, setSelectedPaths]);

  useEffect(() => {
    syncActivePathsToGroups(fileGroupsInFolder);
  }, [fileGroupsInFolder, syncActivePathsToGroups]);

  useEffect(() => {
    const name = versionPicker?.displayName;
    if (!name) return;
    if (!fileGroupsInFolder.some((x) => x.displayName === name)) setVersionPicker(null);
  }, [fileGroupsInFolder, versionPicker?.displayName]);

  useEffect(() => {
    const folders = inventory?.folders;
    if (!folders || folders.length === 0) return;
    for (const folder of folders) {
      void service.getFolderCreatedAt(folder).then((date) => {
        if (!date) return;
        setFolderCreatedAtMap((prev) => ({ ...prev, [folder]: date }));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory?.folders]);

  useEffect(() => {
    if (!emptyFolderAfterMove || !inventory) return;
    setEmptyFolderAfterMove(null);
    const hasFiles = inventory.files.some((f) => f.folder === emptyFolderAfterMove);
    if (!hasFiles && inventory.folders.includes(emptyFolderAfterMove)) {
      setDeleteEmptyFolderTarget(emptyFolderAfterMove);
    }
  }, [emptyFolderAfterMove, inventory]);

  useEffect(() => {
    if (!folderOps.mergeBusy) {
      if (mergeTickerRef.current) { clearInterval(mergeTickerRef.current); mergeTickerRef.current = null; }
      setMergeProgress(0);
      setMergeFileStatuses({});
      return;
    }
    const pending = folderOps.mergeLivePending;
    if (pending) {
      const statuses: Record<string, "moving" | "done"> = {};
      for (const c of pending.conflicts) statuses[c.displayName] = "moving";
      for (const a of pending.additions) statuses[a] = "moving";
      setMergeFileStatuses(statuses);
    }
    setMergeProgress(4);
    mergeTickerRef.current = setInterval(() => {
      setMergeProgress((p) => Math.min(p + 1.2, 88));
    }, 100);
    return () => {
      if (mergeTickerRef.current) { clearInterval(mergeTickerRef.current); mergeTickerRef.current = null; }
    };
  }, [folderOps.mergeBusy]);

  useEffect(() => {
    if (!folderOps.liveChangePending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") folderOps.setLiveChangePending(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [folderOps.liveChangePending, folderOps]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  function applySetLiveFolder(folder: string | null) {
    setLiveFolder(folder);
    const liveRoute = folder ? (folderState.folderNames[folder]?.trim() || folder.replace(/\/$/, "")) : null;
    void folderOps.updateLiveRoute(liveRoute);
  }

  async function commitVersionChange(fullPath: string, newVersion: number) {
    const file = filesInFolder.find((f) => f.fullPath === fullPath);
    if (!file || file.version === newVersion) return;
    try {
      await service.renameVersion(fullPath, newVersion);
      await refreshInventory({ soft: true });
    } catch (e) {
      alert(e instanceof Error ? e.message : "버전 변경 실패");
    }
  }

  async function openCsvPreview(file: InventoryFile) {
    setCsvPreviewLoading(true);
    setCsvPreview({ displayName: file.displayName, rows: [] });
    try {
      const text = await service.readCsvFile(file.fullPath);
      setCsvPreview({ displayName: file.displayName, rows: parseCsv(text) });
    } catch (e) {
      setCsvPreview({ displayName: file.displayName, rows: [["오류: " + (e instanceof Error ? e.message : String(e))]] });
    } finally {
      setCsvPreviewLoading(false);
    }
  }

  async function saveChartMemo(key: string, memo: string) {
    const trimmed = memo.trim();
    const prevStored = (chartMemos[key] ?? "").trim();
    if (trimmed === prevStored) return;

    setChartMemos((prev) => {
      const next = { ...prev };
      if (trimmed) next[key] = trimmed; else delete next[key];
      return next;
    });
    setMemoSaving(true);
    try {
      const { generation } = await service.saveChartMemo(key, trimmed, chartMemosGeneration);
      setChartMemosGeneration(generation);
    } catch (e) {
      if (e instanceof ChartMemosConflictError) {
        alert("다른 세션에서 차트 메모가 먼저 저장되었습니다. 최신 내용으로 다시 불러옵니다.");
        await refreshInventory({ soft: true });
        return;
      }
      try {
        const snap = await service.getChartMemos();
        setChartMemos(snap.memos);
        setChartMemosGeneration(snap.generation);
      } catch {
        await refreshInventory({ soft: true });
      }
      showBulkToast(e instanceof Error ? `저장 실패: ${e.message}` : "저장 실패", "danger");
    } finally {
      setMemoSaving(false);
    }
  }

  function toggleSelectAllVisible() {
    toggleAll(filteredFileGroups, allVisibleSelected);
  }

  function openMoveCsvModal() {
    const paths = [...selectedPaths];
    if (paths.length === 0) return;
    const files = paths
      .map((p) => filesInFolder.find((f) => f.fullPath === p))
      .filter((f): f is InventoryFile => Boolean(f));
    if (files.length === 0) return;
    setMoveModalFiles(files);
  }

  const versionFolderHotkeysBlocked =
    uploadOpen ||
    sheetsImportOpen ||
    moveModalFiles.length > 0 ||
    deleteModalOpen ||
    !!folderOps.renameFolderTarget ||
    !!folderOps.deleteFolderTarget ||
    !!folderOps.mergeLivePending ||
    !!folderOps.liveChangePending ||
    folderOps.createFolderOpen ||
    bulkBusy ||
    csvPreview !== null ||
    historyOpen ||
    detailFolder !== null ||
    !!deleteEmptyFolderTarget;

  function openDeleteCsvModal() {
    const paths = [...selectedPaths];
    if (paths.length === 0) return;
    const files = paths
      .map((p) => filesInFolder.find((f) => f.fullPath === p))
      .filter((f): f is InventoryFile => Boolean(f));
    if (files.length === 0) return;
    setDeleteModalFiles(files);
    setDeleteModalOpen(true);
  }

  function handleDeleteFolderClick() {
    if (!selectedFolder || selectedFolder === liveFolder) return;
    folderOps.openDeleteFolder(selectedFolder, selectedFolder, setSelectedFolder);
  }

  return (
    <>
      <AdminGlobalLoadingOverlay
        message={
          sheetsImportBusy === "loading"
            ? "데이터 로드 중…"
            : sheetsImportBusy === true
            ? "처리 중…"
            : folderOps.folderBusy && !folderOps.deleteFolderTarget
              ? ADMIN_FOLDER_BUSY_MESSAGE
              : loadingInv
                ? ADMIN_DATA_LOADING_MESSAGE
                : null
        }
      />
      <style>{`@keyframes _spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{ padding: "19px 0 40px", width: "100%" }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>차트 관리</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#94a3b8" }}>스펙 데이터 / 버전 관리 시스템</p>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "calc(100vh - 240px)",
            maxHeight: "calc(100vh - 240px)",
          }}
        >
            {/* Toolbar — 우편·공지와 동일 패딩·줄 높이·우측 액션 정렬 */}
            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", padding: "0 16px 0 20px", gap: 8, flexShrink: 0, minHeight: ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX }}>
              <div aria-hidden style={adminListPanelToolbarZeroWidthRhythmSpacerStyle} />
              <span style={{ fontWeight: 500, fontSize: 14, color: "#64748b", whiteSpace: "nowrap", flexShrink: 0 }}>
                현재 앱버전
              </span>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#0f172a", whiteSpace: "nowrap", flexShrink: 0, letterSpacing: "-0.02em" }}>
                {selectedFolder ? (folderNames[selectedFolder] ?? "(이름 없음)") : "—"}
              </span>
              {invError && <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 600, marginLeft: 8, flexShrink: 0 }}>{invError}</span>}
              <div style={{ flex: 1 }} />
              {selectedFolder && (
                <>
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    업로드
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy || selectedPaths.size === 0 || destFoldersForMove.length === 0}
                    onClick={() => openMoveCsvModal()}
                    style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: selectedPaths.size === 0 || destFoldersForMove.length === 0 ? "#f8fafc" : "#fff", color: selectedPaths.size === 0 || destFoldersForMove.length === 0 ? "#94a3b8" : "#2563eb", fontWeight: 600, fontSize: 13, cursor: bulkBusy || selectedPaths.size === 0 || destFoldersForMove.length === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                  >
                    이동
                  </button>
                  <button
                    type="button"
                    disabled={bulkBusy || selectedPaths.size === 0}
                    onClick={() => openDeleteCsvModal()}
                    style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: selectedPaths.size === 0 ? "#f8fafc" : "#fff", color: selectedPaths.size === 0 ? "#94a3b8" : "#ef4444", fontWeight: 600, fontSize: 13, cursor: bulkBusy || selectedPaths.size === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                  >
                    삭제
                  </button>
                </>
              )}
              <div style={{ position: "relative" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="차트명 검색…"
                  aria-label="차트명 검색"
                  style={{ paddingLeft: 29, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, color: "#1e293b", width: ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX, outline: "none", boxSizing: "border-box" }}
                />
              </div>
              <button
                type="button"
                onClick={() => void refreshInventory()}
                disabled={loadingInv}
                title="새로고침"
                style={{ width: 32, height: 32, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: loadingInv ? "#cbd5e1" : "#64748b", cursor: loadingInv ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M20 9A8 8 0 0 0 6.93 5.41M4 15a8 8 0 0 0 13.07 3.59" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
              <FolderSidebar
                folders={folders}
                sortedVersionFolders={sortedVersionFolders}
                selectedFolder={selectedFolder}
                setSelectedFolder={setSelectedFolder}
                liveFolder={liveFolder}
                folderNames={folderNames}
                folderIcons={folderIcons}
                setFolderIcons={setFolderIcons}
                versionFolderSort={versionFolderSort}
                setVersionFolderSort={setVersionFolderSort}
                createFolderOpen={folderOps.createFolderOpen}
                setCreateFolderOpen={folderOps.setCreateFolderOpen}
                newFolderName={folderOps.newFolderName}
                setNewFolderName={folderOps.setNewFolderName}
                folderBusy={folderOps.folderBusy}
                folderMsg={folderOps.folderMsg}
                setFolderMsg={folderOps.setFolderMsg}
                loadingInv={loadingInv}
                onCreateFolder={() => void folderOps.handleCreateFolder(folderOps.newFolderName.trim())}
                onDeleteFolderClick={handleDeleteFolderClick}
                onRequestLiveChange={(folder) => folderOps.requestLiveFolderChange(folder)}
                onMergeToLive={(folder) => folderOps.openMergeToLive(folder)}
                onShowDetail={(folder) => setDetailFolder(folder)}
                onRenameFolder={(folder) => folderOps.openRenameFolder(folder)}
                onDeleteFromContext={(folder) => folderOps.openDeleteFolder(folder, selectedFolder, setSelectedFolder)}
                applyFolderDisplayRename={applyFolderDisplayRenameWithToast}
                versionFolderHotkeysBlocked={versionFolderHotkeysBlocked}
                onSheetsImport={() => setSheetsImportOpen(true)}
              />

              {/* ── Main content ── */}
              <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff" }}>
                {/* File list */}
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", padding: "0 0 16px", display: "flex", flexDirection: "column" }}>
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      minWidth: 0,
                      overflow: "auto",
                      overscrollBehavior: "contain",
                    }}
                  >
                    <SpecFilesTable
                      folderSelected={!!selectedFolder}
                      fileGroupsInFolder={filteredFileGroups}
                      inventoryLoading={loadingInv}
                      hasSearchFilter={searchQuery.trim().length > 0}
                      selectedPaths={selectedPaths}
                      activePathByDisplay={activePathByDisplay}
                      setActivePathByDisplay={setActivePathByDisplay}
                      allVisibleSelected={allVisibleSelected}
                      toggleSelectAllVisible={toggleSelectAllVisible}
                      toggleGroup={toggleGroup}
                      chartMemos={chartMemos}
                      editingMemoKey={editingMemoKey}
                      editingMemoValue={editingMemoValue}
                      setEditingMemoKey={setEditingMemoKey}
                      setEditingMemoValue={setEditingMemoValue}
                      onSaveMemo={saveChartMemo}
                      folderNames={folderNames}
                      onCsvPreview={openCsvPreview}
                      onRowContextMenu={(file, x, y) => { setVersionPicker(null); setFileContextMenu({ x, y, file }); }}
                    />
                  </div>
                </div>
              </div>

            </div>
        </div>
      </div>
      <HistoryPanel isOpen={historyOpen} onClose={() => setHistoryOpen(false)} />
      <BulkActionToast message={bulkToast?.text ?? null} tone={bulkToast?.tone ?? "default"} onClear={clearBulkToast} />

      {/* ── Modals & Overlays ── */}

      {uploadOpen && selectedFolder && (
        <UploadModal
          selectedFolder={selectedFolder}
          filesInFolder={filesInFolder}
          service={service}
          onClose={() => setUploadOpen(false)}
          onUploadComplete={() => refreshInventory({ soft: true }).then(() => {})}
          onUploadSuccess={({ count }) => showBulkToast(`업로드 완료: ${count}개`)}
        />
      )}

      {sheetsImportOpen && (
        <SheetsImportModal
          service={service}
          folders={folders}
          folderNames={folderNames}
          setFolderNames={folderState.setFolderNames}
          liveFolder={liveFolder}
          refreshInventory={refreshInventory}
          publishFolderRoutes={service.publishFolderRoutes}
          onClose={() => setSheetsImportOpen(false)}
          onDone={({ count, folderName }) => {
            showBulkToast(`Google Sheets 가져오기 완료: ${count}개 → ${folderName}`);
          }}
          onBusyChange={(busy) => setSheetsImportBusy(busy)}
        />
      )}

      {deleteModalOpen && deleteModalFiles.length > 0 && (
        <DeleteCsvModal
          files={deleteModalFiles}
          service={service}
          onClose={() => {
            setDeleteModalOpen(false);
            setDeleteModalFiles([]);
          }}
          onInventoryRefresh={() => refreshInventory({ soft: false }).then(() => {})}
          onSuccess={({ count }) => {
            showBulkToast(`삭제 완료: ${count}개`);
            setSelectedPaths(new Set());
          }}
          onBusyChange={setBulkBusy}
        />
      )}

      {moveModalFiles.length > 0 && (
        <MoveCsvModal
          files={moveModalFiles}
          destFolders={destFoldersForMove}
          folderNames={folderNames}
          folderIcons={folderIcons}
          service={service}
          askConflict={askConflict}
          onResetApplyAll={resetApplyAll}
          onClose={() => setMoveModalFiles([])} 
          onInventoryRefresh={() => refreshInventory({ soft: false }).then(() => {})}
          onSuccess={({ moved, skipped }) => {
            showBulkToast(skipped > 0 ? `이동 완료: ${moved}개, 건너뜀: ${skipped}개` : `이동 완료: ${moved}개`);
            setSelectedPaths(new Set());
            if (selectedFolder && selectedFolder !== liveFolder) setEmptyFolderAfterMove(selectedFolder);
          }}
          onBusyChange={setBulkBusy}
        />
      )}

      <ConflictDialog
        conflictFile={conflictFile}
        conflictApplyAll={conflictApplyAll}
        setConflictApplyAll={setConflictApplyAll}
        onResolve={resolveConflict}
      />

      <MergeConfirmDialog
        pending={folderOps.mergeLivePending}
        liveFolder={liveFolder}
        folderNames={folderNames}
        mergeBusy={folderOps.mergeBusy}
        mergeFinishing={folderOps.mergeFinishing}
        mergeProgress={mergeProgress}
        fileStatuses={mergeFileStatuses}
        onConfirm={() => void folderOps.confirmMergeToLive(
          (src) => setDeleteEmptyFolderTarget(src),
          (displayName) => setMergeFileStatuses((prev) => ({ ...prev, [displayName]: "done" })),
        )}
        onClose={() => folderOps.setMergeLivePending(null)}
      />

      <LiveRouteChangeDialog
        pending={folderOps.liveChangePending}
        folderNames={folderNames}
        onConfirm={(folder) => { applySetLiveFolder(folder); folderOps.setLiveChangePending(null); }}
        onClose={() => folderOps.setLiveChangePending(null)}
      />

      <DeleteFolderDialog
        target={folderOps.deleteFolderTarget}
        folderNames={folderNames}
        fileCount={folderOps.deleteFolderFileCount}
        folderBusy={folderOps.folderBusy}
        onConfirm={() => void folderOps.confirmDeleteFolder()}
        onClose={() => folderOps.setDeleteFolderTarget(null)}
      />

      <RenameFolderDialog
        target={folderOps.renameFolderTarget}
        newName={folderOps.renameFolderNewName}
        setNewName={folderOps.setRenameFolderNewName}
        folderBusy={folderOps.folderBusy}
        onConfirm={() => folderOps.confirmRenameFolder((msg) => showBulkToast(msg, "danger"))}
        onClose={() => folderOps.setRenameFolderTarget(null)}
      />

      {deleteEmptyFolderTarget && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}>
          <div role="dialog" aria-modal="true" style={{ background: "#fff", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.2)", padding: "26px 26px 22px", minWidth: 320, maxWidth: 440, display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: "#0f172a" }}>빈 폴더 삭제</h2>
            <p style={{ margin: 0, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
              <strong style={{ color: "#0f172a" }}>{folderNames[deleteEmptyFolderTarget] ?? deleteEmptyFolderTarget.replace(/\/$/, "")}</strong> 폴더가 비었습니다.<br />
              폴더도 함께 삭제하시겠습니까?
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeleteEmptyFolderTarget(null)}
                style={{ padding: "9px 18px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, fontWeight: 600, color: "#475569", cursor: "pointer" }}
              >
                남겨두기
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = deleteEmptyFolderTarget;
                  setDeleteEmptyFolderTarget(null);
                  void folderOps.deleteEmptyFolder(target);
                }}
                style={{ padding: "9px 18px", borderRadius: 10, border: "none", background: "linear-gradient(180deg, #dc2626 0%, #b91c1c 100%)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: "0 4px 14px rgba(185,28,28,0.3)" }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      <CSVPreviewModal
        preview={csvPreview}
        loading={csvPreviewLoading}
        onClose={() => setCsvPreview(null)}
      />

      {/* Merge progress indicator */}
      {folderOps.mergeBusy && (
        <ConsoleDockedBar
          style={{
            background: "#fff",
            border: "1px solid #bfdbfe",
            borderRadius: 12,
            padding: "10px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            boxShadow: "0 4px 16px rgba(37,99,235,0.12)",
            minWidth: 220,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#1d4ed8", fontWeight: 600 }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #bfdbfe", borderTopColor: "#2563eb", animation: "_spin 0.7s linear infinite", flexShrink: 0 }} />
            병합 중…
          </div>
          <div style={{ height: 4, borderRadius: 999, background: "#e0e7ff", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${mergeProgress}%`, background: "linear-gradient(90deg, #1d4ed8 0%, #3b82f6 100%)", borderRadius: 999, transition: "width 0.12s linear" }} />
          </div>
        </ConsoleDockedBar>
      )}

      {/* File context menu */}
      {fileContextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 110 }} onClick={() => setFileContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setFileContextMenu(null); }} />
          <div style={{ position: "fixed", top: fileContextMenu.y, left: fileContextMenu.x, zIndex: 111, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 160, padding: "4px 0", fontSize: 13 }}>
            <button type="button"
              onClick={() => { setVersionChangeTarget({ file: fileContextMenu.file, value: String(fileContextMenu.file.version) }); setFileContextMenu(null); }}
              style={{ display: "block", width: "100%", padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#1f2937" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              🔢 버전 변경
            </button>
          </div>
        </>
      )}

      {/* Version change dialog */}
      {versionChangeTarget && (() => {
        const parsedV = parseInt(versionChangeTarget.value, 10);
        const isValid = Number.isFinite(parsedV) && parsedV > 0;
        const isSame = parsedV === versionChangeTarget.file.version;
        const takenVersions = filesInFolder
          .filter((f) => f.displayName === versionChangeTarget.file.displayName && f.fullPath !== versionChangeTarget.file.fullPath)
          .map((f) => f.version);
        const isDuplicate = isValid && takenVersions.includes(parsedV);
        const canSubmit = isValid && !isSame && !isDuplicate;
        const warningMsg = isSame ? "현재 버전과 동일합니다." : isDuplicate ? `v${parsedV}은 이미 존재하는 버전입니다.` : null;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110 }}>
            <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.16)", padding: 24, minWidth: 320 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 4px" }}>버전 변경</h2>
              <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 16px" }}>{versionChangeTarget.file.displayName}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: warningMsg ? 8 : 16 }}>
                <span style={{ fontSize: 13, color: "#374151" }}>새 버전 번호</span>
                <input
                  type="number" min={1} autoFocus
                  value={versionChangeTarget.value}
                  onChange={(e) => setVersionChangeTarget((prev) => prev ? { ...prev, value: e.target.value } : null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) { void commitVersionChange(versionChangeTarget.file.fullPath, parsedV); setVersionChangeTarget(null); }
                    if (e.key === "Escape") setVersionChangeTarget(null);
                  }}
                  style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${warningMsg ? "#f59e0b" : "#2563eb"}`, fontSize: 14, textAlign: "center", fontFamily: "ui-monospace, monospace" }}
                />
              </div>
              {warningMsg && (
                <p style={{ fontSize: 12, color: "#f59e0b", margin: "0 0 16px" }}>{warningMsg}</p>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={() => setVersionChangeTarget(null)}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", fontSize: 13, cursor: "pointer" }}>취소</button>
                <button type="button"
                  disabled={!canSubmit}
                  onClick={() => { void commitVersionChange(versionChangeTarget.file.fullPath, parsedV); setVersionChangeTarget(null); }}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: canSubmit ? "#2563eb" : "#d1d5db", color: "#fff", fontWeight: 700, fontSize: 13, cursor: canSubmit ? "pointer" : "not-allowed" }}>변경</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Folder detail modal */}
      {detailFolder && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}
          role="presentation" onClick={() => setDetailFolder(null)}>
          <div role="dialog" aria-modal="true"
            style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 380, width: "100%", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 16px" }}>앱버전 상세 정보</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[
                  ["표시명", folderNames[detailFolder] ?? <span style={{ color: "#9ca3af" }}>설정 안됨</span>],
                  ["실제 경로", <code key="path" style={{ fontFamily: "ui-monospace, monospace", background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>{detailFolder}</code>],
                  ["파일 수", `${(inventory?.files ?? []).filter((f) => f.folder === detailFolder).length}개`],
                  ["라이브 여부", detailFolder === liveFolder ? <span key="live" style={{ color: "#16a34a", fontWeight: 600 }}>● LIVE</span> : "—"],
                  ["생성일", folderCreatedAtMap[detailFolder] ? folderCreatedAtMap[detailFolder].toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : <span key="cd" style={{ color: "#9ca3af" }}>조회 중…</span>],
                ].map(([k, v]) => (
                  <tr key={String(k)} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "10px 0", color: "#6b7280", width: 90 }}>{k}</td>
                    <td style={{ padding: "10px 0" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => setDetailFolder(null)}
              style={{ marginTop: 18, width: "100%", padding: 10, borderRadius: 10, border: "1px solid #d1d5db", background: "#f9fafb", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Version picker popover (opened programmatically) */}
      {versionPicker && (() => {
        const pg = fileGroupsInFolder.find((x) => x.displayName === versionPicker.displayName);
        if (!pg) return null;
        const popActivePath = activePathByDisplay[pg.displayName] ?? pg.versions[pg.versions.length - 1]!.fullPath;
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 110 }} onClick={() => setVersionPicker(null)} onContextMenu={(e) => { e.preventDefault(); setVersionPicker(null); }} />
            <div role="menu" aria-label={`${pg.displayName} 버전`}
              style={{ position: "fixed", top: versionPicker.y, left: versionPicker.x, zIndex: 111, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 148, maxHeight: Math.min(320, typeof window !== "undefined" ? Math.max(120, window.innerHeight - versionPicker.y - 16) : 320), overflowY: "auto", padding: "4px 0", fontSize: 13 }}>
              {pg.versions.map((v) => {
                const isOn = v.fullPath === popActivePath;
                return (
                  <button key={v.fullPath} type="button" role="menuitem"
                    onClick={() => {
                      if (isOn) { setVersionPicker(null); return; }
                      setActivePathByDisplay((prev) => ({ ...prev, [pg.displayName]: v.fullPath }));
                      setVersionPicker(null);
                    }}
                    style={{ display: "block", width: "100%", padding: "8px 14px", border: "none", background: isOn ? "#eff6ff" : "transparent", cursor: isOn ? "default" : "pointer", fontSize: 13, textAlign: "left", color: isOn ? "#1e40af" : "#1f2937", fontFamily: "ui-monospace, monospace", fontWeight: isOn ? 700 : 500 }}
                    onMouseEnter={(e) => { if (!isOn) e.currentTarget.style.background = "#f0f9ff"; }}
                    onMouseLeave={(e) => { if (!isOn) e.currentTarget.style.background = "transparent"; }}>
                    ver.{v.version}
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}
      <ChatBot />
    </>
  );
}
