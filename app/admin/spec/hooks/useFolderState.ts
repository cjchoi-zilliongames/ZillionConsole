"use client";

import { useCallback, useState } from "react";

/** localStorage 기반 폴더 표시 상태 (이름, 아이콘, 선택, 라이브). */
export function useFolderState() {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

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
