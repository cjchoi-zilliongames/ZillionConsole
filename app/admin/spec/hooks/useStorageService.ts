"use client";

import { useRouter } from "next/navigation";
import { getMetadata, getStorage, ref } from "firebase/storage";

import { adminFetch } from "@/lib/admin-client-fetch";
import {
  clientDeleteFilesByFullPaths,
  clientMoveFilesByFullPaths,
  type ConflictResolution,
  createFolderClient,
  deleteFolderClient,
  fetchInventoryClient,
  getChartMemosClient,
  listRootFolderPrefixesClient,
  mergeFolderClient,
  migrateChartMemosClient,
  pruneOrphanChartMemosClient,
  publishFolderRoutesManifestClient,
  readCsvFileClient,
  readFolderRoutesManifestClient,
  renameVersionClient,
  saveChartMemoClient,
  setLiveRouteClient,
  uploadFilesClient,
} from "@/lib/client-spec-storage";
import type { FolderRoutesManifest } from "@/lib/spec/folder-routes-manifest";
import {
  CHART_MEMOS_STORAGE_PATH,
  ChartMemosConflictError,
  type ChartMemos,
  type ChartMemosSnapshot,
} from "@/lib/spec/chart-memos";
import type { HistoryRecord } from "@/lib/storage/spec-history-types";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";
import { storageAuthFetch } from "@/lib/storage-auth-fetch";
import { buildDeleteDetail, buildMoveDetail } from "@/lib/storage/spec-history-builders";
import { signalChartChange } from "@/lib/firestore-chart-signal";

export type { ConflictResolution };

function getStorage_() {
  const app = getOrInitFirebaseBrowserApp();
  if (!app) throw new Error("Firebase 앱을 초기화할 수 없습니다.");
  return getStorage(app);
}

export type InventoryResult = {
  folders: string[];
  files: Array<{
    fullPath: string;
    folder: string;
    displayName: string;
    version: number;
    fileName: string;
    spec?: string;
  }>;
  globalMaxVersionBySpec: Record<string, number>;
};

type UploadRow = {
  file: File;
  mode: "new" | "overwrite";
  overwriteVersion: number | null;
  customVersion: number | null;
};

/**
 * Returns a stable service object whose methods internally fork between
 * Firebase client SDK (useClientStorage=true) and server API calls.
 *
 * NOTE: The returned object is memoised per `useClientStorage` value, so
 * callers can safely spread/destructure inside renders.
 */
export function useStorageService(
  useClientStorage: boolean,
  folderNames: Record<string, string> = {}
) {
  const router = useRouter();

  async function appendHistoryRemote(
    action: HistoryRecord["action"],
    detail: string,
    files?: string[],
  ): Promise<void> {
    // Firebase 웹 로그인 모드는 쿠키 없음 — Bearer 필요 (adminFetch만 쓰면 401 → 로그인으로 튕김)
    const res = await storageAuthFetch("/api/storage/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, detail, ...(files && files.length > 0 ? { files } : {}) }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "히스토리 기록 실패");
  }

  /** 클라이언트 Storage 모드에서 CSV 경로 변경 시 Firestore 우편 플래그(fullPath 키) 동기화 */
  async function syncPostboxPathsRemote(
    deletePaths: string[],
    renames: { from: string; to: string }[],
  ): Promise<void> {
    const d = deletePaths.filter(Boolean);
    const r = renames.filter((x) => x.from && x.to && x.from !== x.to);
    if (d.length === 0 && r.length === 0) return;
    const res = await storageAuthFetch("/api/storage/sync-chart-postbox-paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deletePaths: d, renames: r }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "우편 플래그 동기화 실패");
  }

  async function throwIfStorageAuthFailed(res: Response): Promise<void> {
    if (res.status === 401) {
      router.replace("/admin/login");
      throw new Error("Unauthorized");
    }
    if (res.status === 403) {
      const text = await res.text();
      let msg = "이 계정은 관리자 툴 사용이 허용되지 않습니다.";
      try {
        const j = JSON.parse(text) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 본문 없음 */
      }
      throw new Error(msg);
    }
    if (res.status === 503) {
      const text = await res.text();
      let msg = "서버 설정 오류입니다.";
      try {
        const j = JSON.parse(text) as { error?: string; code?: string };
        if (j.error) msg = j.error;
      } catch {
        /* 본문 없음 */
      }
      throw new Error(msg);
    }
  }

  function getLabel(folderPrefix: string): string {
    return (folderNames[folderPrefix] ?? folderPrefix.replace(/\/$/, "")).trim();
  }

  async function fetchInventory(): Promise<InventoryResult> {
    if (useClientStorage) {
      const storage = getStorage_();
      const inv = await fetchInventoryClient(storage);
      return inv as InventoryResult;
    }
    const res = await storageAuthFetch("/api/storage/inventory", { cache: "no-store" });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok: boolean; folders?: string[]; files?: InventoryResult["files"]; globalMaxVersionBySpec?: Record<string, number>; error?: string };
    if (!data.ok) throw new Error(data.error ?? "목록 조회 실패");
    return {
      folders: data.folders ?? [],
      files: data.files ?? [],
      globalMaxVersionBySpec: data.globalMaxVersionBySpec ?? {},
    };
  }

  /** 웹 로그인 + 클라이언트 Storage 모드면 브라우저 SDK로 직접 읽고, 아니면 Admin API. */
  async function getChartMemos(): Promise<ChartMemosSnapshot> {
    if (useClientStorage) {
      const storage = getStorage_();
      const memos = await getChartMemosClient(storage);
      let generation: string | null = null;
      try {
        const m = await getMetadata(ref(storage, CHART_MEMOS_STORAGE_PATH));
        if (m.generation != null) generation = String(m.generation);
      } catch {
        /* 객체 없음 */
      }
      return { memos, generation };
    }
    const res = await storageAuthFetch("/api/storage/chart-memos", { cache: "no-store" });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as {
      ok?: boolean;
      memos?: ChartMemosSnapshot["memos"];
      generation?: string | null;
    };
    return {
      memos: data.memos ?? {},
      generation: data.generation ?? null,
    };
  }

  async function saveChartMemo(
    key: string,
    memo: string,
    ifGenerationMatch: string | null
  ): Promise<{ generation: string | null }> {
    if (useClientStorage) {
      const storage = getStorage_();
      const generation = await saveChartMemoClient(storage, key, memo);
      void signalChartChange();
      return { generation };
    }
    const res = await storageAuthFetch("/api/storage/chart-memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, memo, ifGenerationMatch }),
    });
    await throwIfStorageAuthFailed(res);
    if (res.status === 409) {
      throw new ChartMemosConflictError();
    }
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      generation?: string | null;
    };
    if (!data.ok) throw new Error(data.error ?? "저장 실패");
    void signalChartChange();
    return { generation: data.generation ?? null };
  }

  async function pruneOrphanChartMemos(
    ifGenerationMatch: string | null
  ): Promise<{ removedKeys: string[]; generation: string | null; memos: ChartMemos }> {
    if (useClientStorage) {
      const storage = getStorage_();
      const { removedKeys, memos } = await pruneOrphanChartMemosClient(storage);
      let generation: string | null = null;
      try {
        const m = await getMetadata(ref(storage, CHART_MEMOS_STORAGE_PATH));
        if (m.generation != null) generation = String(m.generation);
      } catch {
        /* 객체 없음 */
      }
      return { removedKeys, generation, memos };
    }
    const res = await storageAuthFetch("/api/storage/prune-chart-memos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ifGenerationMatch }),
    });
    await throwIfStorageAuthFailed(res);
    if (res.status === 409) {
      throw new ChartMemosConflictError();
    }
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      removedKeys?: string[];
      generation?: string | null;
      memos?: ChartMemos;
    };
    if (!data.ok) throw new Error(data.error ?? "차트 메모 정리 실패");
    return {
      removedKeys: data.removedKeys ?? [],
      generation: data.generation ?? null,
      memos: data.memos ?? {},
    };
  }

  async function readCsvFile(fullPath: string): Promise<string> {
    if (useClientStorage) {
      const storage = getStorage_();
      return readCsvFileClient(storage, fullPath);
    }
    const res = await adminFetch(`/api/storage/read-file?path=${encodeURIComponent(fullPath)}`);
    await throwIfStorageAuthFailed(res);
    if (!res.ok) throw new Error(`파일 읽기 실패: ${res.status}`);
    return res.text();
  }

  async function uploadFiles(folder: string, rows: UploadRow[]): Promise<void> {
    const overwriteRows = rows.filter((r) => r.mode === "overwrite" && r.overwriteVersion !== null);
    const newRows = rows.filter((r) => r.mode === "new");

    if (useClientStorage) {
      const storage = getStorage_();
      for (const row of overwriteRows) {
        const { buildVersionedFileName } = await import("@/lib/spec/versioned-filename");
        const storedName = buildVersionedFileName(row.file.name, row.overwriteVersion!);
        const { ref: storageRef, uploadBytes } = await import("firebase/storage");
        const prefix = folder.endsWith("/") ? folder : `${folder}/`;
        await uploadBytes(storageRef(storage, `${prefix}${storedName}`), row.file, {
          contentType: row.file.type || "text/csv; charset=utf-8",
        });
      }
      if (newRows.length > 0) {
        await uploadFilesClient(storage, folder, newRows.map((r) => r.file));
      }
      void signalChartChange();
      return;
    }

    if (overwriteRows.length > 0) {
      const form = new FormData();
      form.append("folder", folder);
      for (const row of overwriteRows) {
        form.append("files", row.file);
        form.append("overwriteVersions", String(row.overwriteVersion));
      }
      const res = await adminFetch("/api/storage/upload-files", { method: "POST", body: form });
      await throwIfStorageAuthFailed(res);
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "업로드 실패");
    }
    if (newRows.length > 0) {
      const form = new FormData();
      form.append("folder", folder);
      for (const row of newRows) {
        form.append("files", row.file);
        form.append("overwriteVersions", row.customVersion !== null ? String(row.customVersion) : "");
      }
      const res = await adminFetch("/api/storage/upload-files", { method: "POST", body: form });
      await throwIfStorageAuthFailed(res);
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "업로드 실패");
    }
    void signalChartChange();
  }

  async function moveFiles(
    paths: string[],
    toFolder: string,
    askConflict: (fileName: string) => Promise<ConflictResolution>
  ): Promise<{ moved: number; skipped: number }> {
    if (useClientStorage) {
      const storage = getStorage_();
      const result = await clientMoveFilesByFullPaths(storage, paths, toFolder, askConflict);
      if (result.moved.length > 0) {
        void migrateChartMemosClient(storage, result.moved);
        const md = buildMoveDetail(result.moved, getLabel);
        void appendHistoryRemote("move", md.detail, md.files).catch(() => {});
        await syncPostboxPathsRemote([], result.moved);
      }
      void signalChartChange();
      return { moved: result.moved.length, skipped: result.skipped.length };
    }
    const res = await adminFetch("/api/storage/move-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths, toFolder }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok?: boolean; error?: string; moved?: unknown[] };
    if (!data.ok) throw new Error(data.error ?? "이동 실패");
    void signalChartChange();
    return { moved: data.moved?.length ?? 0, skipped: 0 };
  }

  async function deleteFiles(paths: string[]): Promise<void> {
    if (useClientStorage) {
      const storage = getStorage_();
      await clientDeleteFilesByFullPaths(storage, paths);
      const dd = buildDeleteDetail(paths);
      void appendHistoryRemote("delete", dd.detail, dd.files).catch(() => {});
      await syncPostboxPathsRemote(paths, []);
      void signalChartChange();
      return;
    }
    const res = await adminFetch("/api/storage/delete-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "삭제 실패");
    void signalChartChange();
  }

  async function renameVersion(fullPath: string, newVersion: number): Promise<void> {
    if (useClientStorage) {
      const storage = getStorage_();
      const r = await renameVersionClient(storage, fullPath, newVersion);
      if (r.from !== r.to) {
        await syncPostboxPathsRemote([], [{ from: r.from, to: r.to }]);
      }
      void signalChartChange();
      return;
    }
    const res = await adminFetch("/api/storage/rename-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullPath, newVersion }),
    });
    await throwIfStorageAuthFailed(res);
    const data = await res.json() as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "버전 변경 실패");
    void signalChartChange();
  }

  async function createFolder(actualPath: string): Promise<void> {
    // folder creation always uses Firebase client SDK (server has no dedicated endpoint)
    const storage = getStorage_();
    await createFolderClient(storage, actualPath);
    // 인벤토리 시그널은 호출부에서 publishFolderRoutes 직후에 folderNames와 함께 보냄.
    // 여기서 무 folderNames 시그널을 쏘면 Firestore 덮어쓰기(구버전) 시 상대 쪽 표시명이 깨질 수 있음.
  }

  async function deleteFolder(prefix: string): Promise<void> {
    // folder deletion always uses Firebase client SDK
    const storage = getStorage_();
    await deleteFolderClient(storage, prefix);
    void signalChartChange();
  }

  function normalizeFolderRootsHint(hint: string[]): string[] {
    const out: string[] = [];
    for (const raw of hint) {
      const t = raw.trim().replace(/^\/+/, "");
      if (!t) continue;
      out.push(t.endsWith("/") ? t : `${t}/`);
    }
    return out;
  }

  async function publishFolderRoutes(
    folderNamesMap: Record<string, string>,
    liveRoute: string | null,
    opts?: { folderRootsHint?: string[] }
  ): Promise<void> {
    if (useClientStorage) {
      const storage = getStorage_();
      const hint = opts?.folderRootsHint;
      // 인벤토리와 동일한 루트 목록을 알면 전 버킷 객체 나열(list 페이지)을 건너뜀 — CSV가 많을 때 체감 지연의 주원인
      const folders =
        hint && hint.length > 0
          ? normalizeFolderRootsHint(hint)
          : await listRootFolderPrefixesClient(storage);
      await publishFolderRoutesManifestClient(storage, folders, folderNamesMap, liveRoute);
      void signalChartChange({ folderNames: folderNamesMap });
      return;
    }
    const res = await adminFetch("/api/storage/publish-folder-routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderNames: folderNamesMap, liveRoute }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "게시 실패");
    void signalChartChange({ folderNames: folderNamesMap });
  }

  async function mergeFolder(fromFolder: string, toFolder: string, onFileComplete?: (displayName: string) => void): Promise<number> {
    if (useClientStorage) {
      const storage = getStorage_();
      const { moved, deleted } = await mergeFolderClient(storage, fromFolder, toFolder, onFileComplete);
      if (deleted.length > 0 || moved.length > 0) {
        await syncPostboxPathsRemote(deleted, moved);
      }
      void signalChartChange();
      return moved.length;
    }
    const res = await adminFetch("/api/storage/merge-folder", {
      method: "POST",
      headers: { "Content": "application/json" },
      body: JSON.stringify({ fromFolder, toFolder }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as {
      ok?: boolean;
      moved?: { from: string; to: string }[];
      error?: string;
    };
    if (!data.ok) throw new Error(data.error ?? "병합 실패");
    void signalChartChange();
    return data.moved?.length ?? 0;
  }

  async function getFolderCreatedAt(folderPrefix: string): Promise<Date | null> {
    try {
      const storage = getStorage_();
      const base = folderPrefix.replace(/\/$/, "");
      const m = await getMetadata(ref(storage, `${base}/.spec_admin_placeholder`));
      return m.timeCreated ? new Date(m.timeCreated) : null;
    } catch {
      return null;
    }
  }

  async function loadFolderRoutesManifest(): Promise<FolderRoutesManifest | null> {
    if (useClientStorage) {
      const storage = getStorage_();
      return readFolderRoutesManifestClient(storage);
    }
    const res = await adminFetch("/api/storage/read-file?path=__spec%2Ffolder-routes.json");
    await throwIfStorageAuthFailed(res);
    if (!res.ok) return null;
    try { return JSON.parse(await res.text()) as FolderRoutesManifest; } catch { return null; }
  }

  async function setLiveRoute(liveRoute: string | null): Promise<void> {
    if (useClientStorage) {
      const storage = getStorage_();
      await setLiveRouteClient(storage, liveRoute);
      void signalChartChange();
      return;
    }
    const res = await adminFetch("/api/storage/set-live-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ liveRoute }),
    });
    await throwIfStorageAuthFailed(res);
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) throw new Error(data.error ?? "라이브 설정 실패");
    void signalChartChange();
  }

  return {
    fetchInventory,
    getChartMemos,
    saveChartMemo,
    pruneOrphanChartMemos,
    readCsvFile,
    uploadFiles,
    moveFiles,
    deleteFiles,
    renameVersion,
    createFolder,
    deleteFolder,
    publishFolderRoutes,
    mergeFolder,
    setLiveRoute,
    getFolderCreatedAt,
    loadFolderRoutesManifest,
  };
}

export type StorageService = ReturnType<typeof useStorageService>;
