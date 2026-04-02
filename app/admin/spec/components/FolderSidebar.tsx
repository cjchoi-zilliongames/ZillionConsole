"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

function VersionFolderSortIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <line x1="2" y1="3.5" x2="12" y2="3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="2" y1="10.5" x2="12" y2="10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const ICONS = [
  "📁","📂","🚀","⭐","🌟","💫","🔥","⚡","💎","🏆",
  "🎯","🎮","📱","💻","🛠️","⚙️","🔬","🧪","📊","📈",
  "🎨","🎵","🎬","🎭","🎪","🎁","🏅","🛡️","🔮","💡",
  "🌈","🌸","🌙","☀️","🌍","🍎","🦋","🧩","🎲","🏗️",
  "📦","🔑","🗂️","📋","🗒️","🧠","👑","🪄","🔭","🌊",
  "🐶","🐱","🦊","🐼","🦁","🐯","🐸","🐙","🦄","🐲",
  "🍕","🍔","🍜","🍣","🧁","🍩","🍺","☕","🧋","🍭",
  "⚽","🏀","🎾","🏈","🎱","🏄","🚴","🏋️","🎿","🏹",
];
const ICONS_PER_PAGE = 20;

type FolderSidebarProps = {
  folders: string[];
  sortedVersionFolders: string[];
  selectedFolder: string | null;
  setSelectedFolder: (f: string | null) => void;
  liveFolder: string | null;
  folderNames: Record<string, string>;
  folderIcons: Record<string, string>;
  setFolderIcons: (icons: Record<string, string>) => void;
  onIconChange?: () => void;
  versionFolderSort: "asc" | "desc";
  setVersionFolderSort: (s: "asc" | "desc") => void;
  createFolderOpen: boolean;
  setCreateFolderOpen: (v: boolean) => void;
  newFolderName: string;
  setNewFolderName: (v: string) => void;
  folderBusy: boolean;
  folderMsg: string | null;
  setFolderMsg: (msg: string | null) => void;
  loadingInv: boolean;
  onCreateFolder: () => void;
  onDeleteFolderClick: () => void;
  onRequestLiveChange: (folder: string | null) => void;
  onMergeToLive: (folder: string) => void;
  onShowDetail: (folder: string) => void;
  onRenameFolder: (folder: string) => void;
  onDeleteFromContext: (folder: string) => void;
  /** F2 인라인 이름 변경 적용. 실패 시 에러 문자열, 성공 시 `null` */
  applyFolderDisplayRename: (folder: string, rawNewDisplay: string) => string | null;
  /** 열려 있는 모달·다이얼로그 등 있을 때 F2 비활성 */
  versionFolderHotkeysBlocked?: boolean;
};

export function FolderSidebar({
  folders, sortedVersionFolders, selectedFolder, setSelectedFolder,
  liveFolder, folderNames, folderIcons, setFolderIcons, onIconChange,
  versionFolderSort, setVersionFolderSort,
  createFolderOpen, setCreateFolderOpen, newFolderName, setNewFolderName,
  folderBusy, folderMsg, setFolderMsg, loadingInv,
  onCreateFolder, onDeleteFolderClick,
  onRequestLiveChange, onMergeToLive, onShowDetail, onRenameFolder, onDeleteFromContext,
  applyFolderDisplayRename,
  versionFolderHotkeysBlocked = false,
}: FolderSidebarProps) {
  const [inlineEditingFolder, setInlineEditingFolder] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState("");
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const skipInlineBlurCommitRef = useRef(false);

  const [iconPickerFolder, setIconPickerFolder] = useState<string | null>(null);
  const [iconPickerPos, setIconPickerPos] = useState({ x: 0, y: 0 });
  const [iconPickerPage, setIconPickerPage] = useState(0);
  const [versionSortMenu, setVersionSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder: string } | null>(null);
  const [moreSubMenu, setMoreSubMenu] = useState<{ x: number; y: number } | null>(null);
  const moreCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [areaContextMenu, setAreaContextMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!inlineEditingFolder) return;
    const id = requestAnimationFrame(() => {
      const el = inlineInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [inlineEditingFolder]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "F2") return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (versionFolderHotkeysBlocked || folderBusy || inlineEditingFolder) return;
      if (!selectedFolder) return;
      e.preventDefault();
      setInlineEditValue(folderNames[selectedFolder] ?? selectedFolder.replace(/\/$/, ""));
      setInlineEditingFolder(selectedFolder);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    versionFolderHotkeysBlocked,
    folderBusy,
    inlineEditingFolder,
    selectedFolder,
    folderNames,
  ]);

  function cancelInlineRename() {
    skipInlineBlurCommitRef.current = true;
    setInlineEditingFolder(null);
    setInlineEditValue("");
  }

  function commitInlineRename() {
    if (!inlineEditingFolder) return;
    const folder = inlineEditingFolder;
    applyFolderDisplayRename(folder, inlineEditValue);
    setInlineEditingFolder(null);
    setInlineEditValue("");
  }

  return (
    <>
      <aside
        style={{ width: "clamp(160px, 18%, 260px)", minWidth: 160, maxWidth: 260, minHeight: 0, flexShrink: 1, alignSelf: "stretch", borderRight: "1px solid #e5e7eb", background: "#fafafa", overflowY: "auto" }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          e.preventDefault();
          setAreaContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Header */}
        <div style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>앱 버전</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" title="앱 버전 추가" disabled={folderBusy}
              onClick={() => { setCreateFolderOpen(!createFolderOpen); setFolderMsg(null); }}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 14, color: "#6b7280", padding: "0 4px", lineHeight: 1 }}>
              ＋
            </button>
            <button type="button" title="선택 버전 삭제"
              disabled={folderBusy || !selectedFolder || selectedFolder === liveFolder}
              onClick={onDeleteFolderClick}
              style={{ border: "none", background: "transparent", cursor: (selectedFolder && selectedFolder !== liveFolder) ? "pointer" : "default", fontSize: 14, color: (selectedFolder && selectedFolder !== liveFolder) ? "#b91c1c" : "#d1d5db", padding: "0 4px", lineHeight: 1 }}>
              －
            </button>
            <button
              type="button"
              aria-label="앱 버전 목록 정렬"
              aria-expanded={versionSortMenu !== null}
              title={versionFolderSort === "asc" ? "정렬: 오름차순 (라이브 버전은 항상 맨 위)" : "정렬: 내림차순 (라이브 버전은 항상 맨 위)"}
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const menuW = 200;
                const vw = window.innerWidth;
                setVersionSortMenu((prev) => prev ? null : { x: Math.max(8, Math.min(rect.left, vw - menuW - 8)), y: rect.bottom + 4 });
              }}
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: "0 4px", lineHeight: 1, color: "#6b7280", display: "flex", alignItems: "center" }}
            >
              <VersionFolderSortIcon />
            </button>
          </div>
        </div>

        <div style={{ padding: "4px 8px 12px" }}>
          {/* Create folder input */}
          {createFolderOpen && (
            <div style={{ marginBottom: 8 }}>
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCreateFolder();
                  if (e.key === "Escape") { setCreateFolderOpen(false); setNewFolderName(""); }
                }}
                placeholder="표시 이름"
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #93c5fd", fontSize: 13, fontFamily: "ui-monospace, monospace", marginBottom: 4 }}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" disabled={folderBusy || !newFolderName.trim()} onClick={onCreateFolder}
                  style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>
                  {folderBusy ? "…" : "생성"}
                </button>
                <button type="button" onClick={() => { setCreateFolderOpen(false); setNewFolderName(""); setFolderMsg(null); }}
                  style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", fontSize: 12, cursor: "pointer" }}>
                  취소
                </button>
              </div>
              {folderMsg && <p style={{ fontSize: 12, color: "#b91c1c", margin: "4px 0 0" }}>{folderMsg}</p>}
            </div>
          )}
          {!createFolderOpen && folderMsg && (
            <p style={{ fontSize: 12, color: "#b91c1c", margin: "0 8px 8px", padding: "6px 8px", background: "#fef2f2", borderRadius: 6 }}>{folderMsg}</p>
          )}
          {folders.length === 0 && !loadingInv && (
            <div style={{ fontSize: 13, color: "#9ca3af", padding: 8 }}>앱 버전 없음</div>
          )}

          {/* Folder list */}
          {sortedVersionFolders.map((folder) => {
            const label = folderNames[folder] ?? folder.replace(/\/$/, "");
            const active = selectedFolder === folder;
            const isLive = folder === liveFolder;
            const rowStyle: CSSProperties = {
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              textAlign: "left",
              padding: "8px 10px",
              marginBottom: 2,
              border: isLive ? "1px solid #bbf7d0" : "none",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "ui-monospace, monospace",
              background: active ? (isLive ? "#dcfce7" : "#dbeafe") : isLive ? "#f0fdf4" : "transparent",
              color: active ? (isLive ? "#166534" : "#1e40af") : "#1f2937",
              fontWeight: active ? 600 : 400,
              boxSizing: "border-box",
            };

            const iconSpan = (
              <span
                aria-hidden
                title="아이콘 변경"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setIconPickerFolder(folder);
                  setIconPickerPos({ x: rect.right + 6, y: rect.top });
                  setIconPickerPage(0);
                }}
                style={{ cursor: "pointer", fontSize: 16, lineHeight: 1, borderRadius: 4, padding: "1px 2px", transition: "background 0.1s", flexShrink: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {folderIcons[folder] ?? (isLive ? "🟢" : "📁")}
              </span>
            );

            const liveBadge = isLive ? (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  background: "#16a34a",
                  color: "#fff",
                  borderRadius: 4,
                  padding: "1px 5px",
                  letterSpacing: "0.05em",
                  fontFamily: "ui-sans-serif, sans-serif",
                  flexShrink: 0,
                }}
              >
                LIVE
              </span>
            ) : null;

            if (inlineEditingFolder === folder) {
              return (
                <div key={folder} style={{ ...rowStyle, cursor: "default", outline: "2px solid #2563eb", outlineOffset: -1 }}>
                  {iconSpan}
                  <input
                    ref={inlineInputRef}
                    value={inlineEditValue}
                    onChange={(e) => setInlineEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitInlineRename();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelInlineRename();
                      }
                    }}
                    onBlur={() => {
                      if (skipInlineBlurCommitRef.current) {
                        skipInlineBlurCommitRef.current = false;
                        return;
                      }
                      commitInlineRename();
                    }}
                    disabled={folderBusy}
                    aria-label="앱 버전 표시 이름"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "4px 6px",
                      borderRadius: 6,
                      border: "1px solid #93c5fd",
                      fontSize: 13,
                      fontFamily: "ui-monospace, monospace",
                      fontWeight: 600,
                      color: "#0f172a",
                      background: "#fff",
                      outline: "none",
                    }}
                  />
                  {liveBadge}
                </div>
              );
            }

            return (
              <button
                key={folder}
                type="button"
                onClick={() => setSelectedFolder(folder)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setVersionSortMenu(null);
                  setMoreSubMenu(null);
                  setContextMenu({ x: e.clientX, y: e.clientY, folder });
                }}
                style={{ ...rowStyle, cursor: "pointer", border: isLive ? "1px solid #bbf7d0" : "none" }}
              >
                {iconSpan}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                {liveBadge}
              </button>
            );
          })}
        </div>
      </aside>

      {/* Version sort menu */}
      {versionSortMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 72 }} onClick={() => setVersionSortMenu(null)} onContextMenu={(e) => { e.preventDefault(); setVersionSortMenu(null); }} />
          <div role="menu" aria-label="앱 버전 정렬" style={{ position: "fixed", top: versionSortMenu.y, left: versionSortMenu.x, zIndex: 73, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 200, padding: "4px 0", fontSize: 13 }}>
            {(["asc", "desc"] as const).map((dir) => (
              <button key={dir} type="button" role="menuitem"
                onClick={() => { setVersionFolderSort(dir); setVersionSortMenu(null); }}
                style={{ display: "flex", width: "100%", padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#1f2937", alignItems: "center", gap: 8 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ width: 18, fontSize: 12 }}>{versionFolderSort === dir ? "✓" : ""}</span>
                {dir === "asc" ? "오름차순" : "내림차순"}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Folder context menu */}
      {contextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => { setContextMenu(null); setMoreSubMenu(null); }} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); setMoreSubMenu(null); }} />
          <div style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, zIndex: 71, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 180, padding: "4px 0", fontSize: 13 }}>
            <button type="button" onClick={() => { onShowDetail(contextMenu.folder); setContextMenu(null); setMoreSubMenu(null); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#374151" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; setMoreSubMenu(null); }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span style={{ width: 14, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>≡</span>
              상세 정보
            </button>
            <button type="button" onClick={() => { onRenameFolder(contextMenu.folder); setContextMenu(null); setMoreSubMenu(null); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#374151" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f9fafb"; setMoreSubMenu(null); }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              <span style={{ width: 14, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>✎</span>
              이름 변경
            </button>
            {contextMenu.folder !== liveFolder && liveFolder !== null && (
              <button type="button" onClick={() => { onMergeToLive(contextMenu.folder); setContextMenu(null); setMoreSubMenu(null); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#1d4ed8" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#eff6ff"; setMoreSubMenu(null); }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ width: 14, textAlign: "center", fontSize: 11, color: "#93c5fd" }}>⇑</span>
                라이브로 병합
              </button>
            )}
            {contextMenu.folder !== liveFolder && ( 
              <>
                <div style={{ borderTop: "1px solid #f3f4f6", margin: "4px 0" }} />
                <button type="button" onClick={() => { onDeleteFromContext(contextMenu.folder); setContextMenu(null); setMoreSubMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#dc2626" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; setMoreSubMenu(null); }}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 14, textAlign: "center", fontSize: 11, color: "#fca5a5" }}>✕</span>
                  삭제
                </button>
              </>
            )}
            <div style={{ borderTop: "1px solid #f3f4f6", margin: "4px 0" }} />
            {/* 더보기 → 우측 서브메뉴 */}
            <button
              type="button"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "7px 14px", border: "none", background: moreSubMenu ? "#f9fafb" : "transparent", cursor: "pointer", fontSize: 13, color: "#374151" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#f9fafb";
                if (moreCloseTimer.current) clearTimeout(moreCloseTimer.current);
                const rect = e.currentTarget.getBoundingClientRect();
                setMoreSubMenu({ x: rect.right + 2, y: rect.top });
              }}
              onMouseLeave={() => {
                moreCloseTimer.current = setTimeout(() => setMoreSubMenu(null), 120);
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 14, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>···</span>
                더보기
              </span>
              <span style={{ fontSize: 9, color: "#9ca3af", marginLeft: 8 }}>▶</span>
            </button>
          </div>

          {/* 더보기 서브메뉴 */}
          {moreSubMenu && (
            <div
              style={{ position: "fixed", top: moreSubMenu.y, left: moreSubMenu.x, zIndex: 72, background: "#fff", border: "1px solid #fca5a5", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.14)", minWidth: 170, padding: "4px 0", fontSize: 13 }}
              onMouseEnter={() => { if (moreCloseTimer.current) clearTimeout(moreCloseTimer.current); }}
              onMouseLeave={() => { moreCloseTimer.current = setTimeout(() => setMoreSubMenu(null), 120); }}
            >
              {contextMenu.folder === liveFolder ? (
                <button type="button" onClick={() => { onRequestLiveChange(null); setContextMenu(null); setMoreSubMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#dc2626" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 14, textAlign: "center", fontSize: 11, color: "#fca5a5" }}>○</span>
                  라이브 해제
                </button>
              ) : (
                <button type="button" onClick={() => { onRequestLiveChange(contextMenu.folder); setContextMenu(null); setMoreSubMenu(null); }}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#dc2626" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#fef2f2")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 14, textAlign: "center", fontSize: 11, color: "#fca5a5" }}>●</span>
                  라이브 버전으로 설정
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Area context menu */}
      {areaContextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 70 }} onClick={() => setAreaContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setAreaContextMenu(null); }} />
          <div style={{ position: "fixed", top: areaContextMenu.y, left: areaContextMenu.x, zIndex: 71, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 160, padding: "4px 0", fontSize: 13 }}>
            <button type="button" onClick={() => { setAreaContextMenu(null); setCreateFolderOpen(true); setFolderMsg(null); }}
              style={{ display: "block", width: "100%", padding: "8px 14px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, textAlign: "left", color: "#1f2937" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              ＋ 앱 버전 추가
            </button>
          </div>
        </>
      )}

      {/* Icon picker */}
      {iconPickerFolder && (() => {
        const totalPages = Math.ceil(ICONS.length / ICONS_PER_PAGE);
        const page = Math.min(iconPickerPage, totalPages - 1);
        const pageIcons = ICONS.slice(page * ICONS_PER_PAGE, (page + 1) * ICONS_PER_PAGE);
        const current = folderIcons[iconPickerFolder] ?? null;
        const PW = 256;
        const left = Math.min(iconPickerPos.x, window.innerWidth - PW - 8);
        const top = Math.min(iconPickerPos.y, window.innerHeight - 300 - 8);
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 80 }} onClick={() => setIconPickerFolder(null)} onContextMenu={(e) => { e.preventDefault(); setIconPickerFolder(null); }} />
            <div style={{ position: "fixed", top, left, zIndex: 81, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", width: PW, padding: "12px 12px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <button type="button" onClick={() => setIconPickerPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  style={{ width: 26, height: 26, border: "1px solid #e5e7eb", borderRadius: 8, background: page === 0 ? "#f9fafb" : "#fff", cursor: page === 0 ? "default" : "pointer", fontSize: 14, color: page === 0 ? "#d1d5db" : "#374151", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  아이콘 선택 &nbsp;{page + 1}/{totalPages}
                </span>
                <button type="button" onClick={() => setIconPickerPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                  style={{ width: 26, height: 26, border: "1px solid #e5e7eb", borderRadius: 8, background: page === totalPages - 1 ? "#f9fafb" : "#fff", cursor: page === totalPages - 1 ? "default" : "pointer", fontSize: 14, color: page === totalPages - 1 ? "#d1d5db" : "#374151", display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                {pageIcons.map((icon) => {
                  const selected = current === icon;
                  return (
                    <button key={icon} type="button"
                      onClick={() => {
                        setFolderIcons({ ...folderIcons, [iconPickerFolder]: icon });
                        onIconChange?.();
                        setIconPickerFolder(null);
                      }}
                      style={{ fontSize: 20, lineHeight: 1, padding: "7px 0", border: selected ? "2px solid #2563eb" : "2px solid transparent", borderRadius: 10, background: selected ? "#dbeafe" : "transparent", cursor: "pointer", transition: "background 0.1s, transform 0.1s", display: "flex", alignItems: "center", justifyContent: "center" }}
                      onMouseEnter={(e) => { if (!selected) { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.transform = "scale(1.15)"; } }}
                      onMouseLeave={(e) => { if (!selected) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.transform = "scale(1)"; } }}
                    >{icon}</button>
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 10 }}>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button key={i} type="button" onClick={() => setIconPickerPage(i)}
                    style={{ width: i === page ? 16 : 6, height: 6, borderRadius: 3, border: "none", background: i === page ? "#2563eb" : "#d1d5db", cursor: "pointer", padding: 0, transition: "width 0.2s, background 0.2s" }} />
                ))}
              </div>
              {current && (
                <button type="button"
                  onClick={() => {
                    const updated = { ...folderIcons };
                    delete updated[iconPickerFolder];
                    setFolderIcons(updated);
                    setIconPickerFolder(null);
                  }}
                  style={{ marginTop: 8, width: "100%", padding: "7px 0", borderRadius: 8, border: "1px solid #e5e7eb", background: "transparent", fontSize: 12, color: "#6b7280", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >기본값으로 재설정</button>
              )}
            </div>
          </>
        );
      })()}
    </>
  );
}
