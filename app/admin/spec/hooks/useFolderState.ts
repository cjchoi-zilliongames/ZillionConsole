"use client";

import { useCallback, useLayoutEffect, useState } from "react";

export const SPEC_SELECTED_FOLDER_SESSION_KEY = "spec_selected_folder_v1";

function readPersistedSelectedFolder(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(SPEC_SELECTED_FOLDER_SESSION_KEY);
  } catch {
    return null;
  }
}

/** localStorage 기반 폴더 표시 상태 (이름, 아이콘, 선택, 라이브). 선택 폴더는 탭 이동 후에도 표 유지용으로 sessionStorage 복원. */
export function useFolderState() {
  /** SSR/첫 페인트는 서버와 동일하게 null — 복원은 클라이언트에서만 (hydration 불일치 방지) */
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  useLayoutEffect(() => {
    const p = readPersistedSelectedFolder();
    if (p) setSelectedFolder(p);
  }, []);

  const [liveFolder, setLiveFolder] = useState<string | null>(() => {
    try { return localStorage.getItem("spec_live_folder") ?? "0/"; } catch { return "0/"; }
  });

  const [folderNames, setFolderNames] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("spec_folder_names") ?? "{}") as Record<string, string>; }
    catch { return {}; }
  });

  const [folderIcons, setFolderIcons] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("spec_folder_icons") ?? "{}") as Record<string, string>; }
    catch { return {}; }
  });

  function setLiveFolderPersisted(folder: string | null) {
    setLiveFolder(folder);
    try {
      if (folder) localStorage.setItem("spec_live_folder", folder);
      else localStorage.removeItem("spec_live_folder");
    } catch { /* ignore */ }
  }

  const setFolderNamesPersisted = useCallback((names: Record<string, string>) => {
    setFolderNames(names);
    try { localStorage.setItem("spec_folder_names", JSON.stringify(names)); } catch { /* ignore */ }
  }, []);

  function setFolderIconsPersisted(icons: Record<string, string>) {
    setFolderIcons(icons);
    try { localStorage.setItem("spec_folder_icons", JSON.stringify(icons)); } catch { /* ignore */ }
  }

  function labelOf(prefix: string) {
    return (folderNames[prefix] ?? prefix.replace(/\/$/, "") ?? prefix).trim();
  }

  return {
    selectedFolder,
    setSelectedFolder,
    liveFolder,
    setLiveFolder: setLiveFolderPersisted,
    folderNames,
    setFolderNames: setFolderNamesPersisted,
    folderIcons,
    setFolderIcons: setFolderIconsPersisted,
    labelOf,
  };
}
