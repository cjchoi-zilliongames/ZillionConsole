"use client";

import { getAuth } from "firebase/auth";
import type { FirebaseStorage } from "firebase/storage";
import {
  deleteObject,
  getMetadata,
  list,
  ref,
  uploadBytes,
  uploadString,
} from "firebase/storage";

/**
 * Firebase SDK의 getBytes/getBlob은 storage.googleapis.com으로 리다이렉트돼
 * CORS가 없으면 무한 hang함. firebasestorage.googleapis.com REST API에
 * Firebase auth 토큰을 직접 붙여 요청하면 CORS 없이 동작함.
 */
async function downloadFileBytes(
  storage: FirebaseStorage,
  fullPath: string
): Promise<Uint8Array> {
  const user = getAuth(storage.app).currentUser;
  if (!user) throw new Error("로그인이 필요합니다");
  const idToken = await user.getIdToken();
  const bucket = ref(storage).bucket;
  const encodedPath = encodeURIComponent(fullPath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Firebase ${idToken}` },
  });
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

import {
  buildSpecCsvFileName,
  parseSpecCsvFileName,
} from "@/lib/spec/csv-filename";
import {
  buildFolderRoutesManifest,
  isReservedSpecRootPrefix,
  mergeFolderNamesWithExistingManifest,
  SPEC_FOLDER_ROUTES_STORAGE_PATH,
} from "@/lib/spec/folder-routes-manifest";
import {
  CHART_MEMOS_STORAGE_PATH,
  type ChartMemos,
} from "@/lib/spec/chart-memos";
import {
  buildVersionedFileName,
  parseVersionedFileName,
} from "@/lib/spec/versioned-filename";
import type { SpecFileRow } from "@/lib/storage/spec-inventory";
import { filterChartMemosToValidPaths } from "@/lib/storage/chart-memos-prune";
import {
  assertDirectPathsInSameFolder,
  assertSafeStorageRelativePath,
  storageObjectBasename,
} from "@/lib/storage/storage-path-utils";

/** 예전 버전에서 쓰던 빈 폴더 마커(더 이상 만들지 않음, 있으면 이동 전에만 제거) */
const SPEC_ADMIN_PLACEHOLDER_FILE = ".spec_admin_placeholder";

function specAdminPlaceholderObjectPath(folderWithTrailingSlash: string): string {
  const base = folderWithTrailingSlash.replace(/\/$/, "");
  return `${base}/${SPEC_ADMIN_PLACEHOLDER_FILE}`;
}

function maxVersionBySpec(files: SpecFileRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of files) {
    if (f.spec && (map[f.spec] ?? 0) < f.version) map[f.spec] = f.version;
  }
  return map;
}

function normalizeFolder(input: string): string {
  const t = input.trim();
  if (!t) throw new Error("targetFolder is required");
  return t.endsWith("/") ? t : `${t}/`;
}

function refAtPath(storage: FirebaseStorage, path: string) {
  const p = path.replace(/^\/+|\/+$/g, "");
  return p === "" ? ref(storage) : ref(storage, p);
}

const LIST_MAX_PAGES = 500;

async function listOneLevel(storage: FirebaseStorage, path: string) {
  const r = refAtPath(storage, path);
  const prefixes: string[] = [];
  const itemRefs: { fullPath: string; name: string }[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    if (pages > LIST_MAX_PAGES) {
      throw new Error(
        `Storage 목록 페이지가 너무 많습니다 (${LIST_MAX_PAGES} 초과). 폴더당 객체 수를 줄이거나 문의하세요.`
      );
    }
    const page = await list(r, { maxResults: 1000, pageToken });
    for (const p of page.prefixes) {
      prefixes.push(p.fullPath);
    }
    for (const it of page.items) {
      itemRefs.push({ fullPath: it.fullPath, name: it.name });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { prefixes, itemRefs };
}

function toFolderPrefix(fullPath: string): string {
  return fullPath.endsWith("/") ? fullPath : `${fullPath}/`;
}

/**
 * SDK list()는 일부 경로에서 stale/오류 결과를 반환하므로
 * REST API로 전체 객체를 나열한 뒤 최상위 폴더명을 추출한다.
 * 객체가 없는 폴더는 Firebase Storage에 실재하지 않으므로 결과에 포함되지 않는다.
 */
export async function listRootFolderPrefixesClient(
  storage: FirebaseStorage
): Promise<string[]> {
  const user = getAuth(storage.app).currentUser;
  if (!user) throw new Error("로그인이 필요합니다");
  const idToken = await user.getIdToken();
  const bucket = ref(storage).bucket;
  const set = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages++;
    if (pages > LIST_MAX_PAGES) throw new Error("목록 페이지 초과");
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Firebase ${idToken}` },
    });
    if (!res.ok) throw new Error(`Storage 목록 조회 실패: ${res.status}`);
    const data = (await res.json()) as {
      items?: { name: string }[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      const i = item.name.indexOf("/");
      if (i > 0) {
        const norm = item.name.slice(0, i + 1);
        if (!isReservedSpecRootPrefix(norm)) set.add(norm);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function listSpecCsvFilesUnderPrefixClient(
  storage: FirebaseStorage,
  folderPrefix: string
): Promise<SpecFileRow[]> {
  const prefix = normalizeFolder(folderPrefix);
  if (!prefix) return [];

  const path = prefix.replace(/\/$/, "");
  const { itemRefs } = await listOneLevel(storage, path);
  const rows: SpecFileRow[] = [];

  for (const it of itemRefs) {
    if (!it.name.endsWith(".csv")) continue;

    // 신형: Hero{3}.csv
    const versioned = parseVersionedFileName(it.name);
    if (versioned) {
      rows.push({
        fullPath: it.fullPath,
        folder: prefix,
        displayName: versioned.displayName,
        version: versioned.version,
        fileName: it.name,
      });
      continue;
    }

    // 구형 fallback: Hero_1.csv
    const parsed = parseSpecCsvFileName(it.name);
    if (parsed) {
      rows.push({
        fullPath: it.fullPath,
        folder: prefix,
        displayName: `${parsed.spec}.csv`,
        version: parsed.version,
        fileName: it.name,
        spec: parsed.spec,
      });
      continue;
    }

    if (/^.+\.csv$/i.test(it.name)) {
      rows.push({
        fullPath: it.fullPath,
        folder: prefix,
        displayName: it.name,
        version: 1,
        fileName: it.name,
      });
    }
  }

  return rows;
}

export async function listAllSpecCsvFilesClient(
  storage: FirebaseStorage
): Promise<SpecFileRow[]> {
  const roots = await listRootFolderPrefixesClient(storage);
  const out: SpecFileRow[] = [];
  for (const root of roots) {
    out.push(...(await listSpecCsvFilesUnderPrefixClient(storage, root)));
  }
  return out;
}

export async function fetchInventoryClient(storage: FirebaseStorage) {
  const files = await listAllSpecCsvFilesClient(storage);
  const folders = await listRootFolderPrefixesClient(storage);
  return {
    folders,
    files,
    globalMaxVersionBySpec: maxVersionBySpec(files),
  };
}

export async function clientUploadSpecs(
  storage: FirebaseStorage,
  targetFolder: string,
  items: { spec: string; csvText: string }[]
): Promise<{ spec: string; version: number; path: string }[]> {
  const folder = normalizeFolder(targetFolder);
  const allFiles = await listAllSpecCsvFilesClient(storage);
  const globalMax = { ...maxVersionBySpec(allFiles) };

  const results: { spec: string; version: number; path: string }[] = [];

  for (const item of items) {
    const nextVersion = (globalMax[item.spec] ?? 0) + 1;
    globalMax[item.spec] = nextVersion;
    const fileName = buildSpecCsvFileName(item.spec, nextVersion);
    const path = `${folder}${fileName}`.replace(/^\/+/, "");
    const r = ref(storage, path);
    await uploadString(r, item.csvText, "raw", {
      contentType: "text/csv; charset=utf-8",
    });
    results.push({ spec: item.spec, version: nextVersion, path });
  }

  return results;
}

async function deleteObjectIgnoreMissing(storage: FirebaseStorage, fullPath: string) {
  try {
    await deleteObject(ref(storage, fullPath));
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: string }).code)
        : "";
    if (code === "storage/object-not-found") return;
    throw e;
  }
}

async function deleteLegacySpecAdminPlaceholderClient(
  storage: FirebaseStorage,
  folderWithTrailingSlash: string
): Promise<void> {
  await deleteObjectIgnoreMissing(
    storage,
    specAdminPlaceholderObjectPath(folderWithTrailingSlash)
  );
}

/** 직접 하위에 .csv가 없으면 플레이스홀더 등 잔여 객체만 제거(병합 후 빈 앱 버전 정리) */
async function removeDirectChildrenIfNoTopLevelCsv(
  storage: FirebaseStorage,
  folderWithTrailingSlash: string
): Promise<void> {
  const folder = normalizeFolder(folderWithTrailingSlash);
  const path = folder.replace(/\/$/, "");
  const { itemRefs } = await listOneLevel(storage, path);
  if (itemRefs.some((it) => it.name.endsWith(".csv"))) return;
  for (const it of itemRefs) {
    await deleteObjectIgnoreMissing(storage, it.fullPath);
  }
}

export type ConflictResolution = "overwrite" | "skip" | "cancel";

/** 인벤토리에 나온 스펙 CSV 경로들을 다른 버전 폴더로 이동 */
export async function clientMoveFilesByFullPaths(
  storage: FirebaseStorage,
  paths: string[],
  toFolderInput: string,
  onConflict?: (fileName: string) => Promise<ConflictResolution>
): Promise<{ moved: { from: string; to: string }[]; skipped: string[] }> {
  if (paths.length === 0) return { moved: [], skipped: [] };
  for (const p of paths) assertSafeStorageRelativePath(p);
  const fromPrefix = assertDirectPathsInSameFolder(paths);
  const to = normalizeFolder(toFolderInput);
  if (fromPrefix === to) {
    throw new Error("Destination folder must differ from source");
  }

  const moved: { from: string; to: string }[] = [];
  const skipped: string[] = [];
  let cancelled = false;
  // 충돌 다이얼로그는 한 번에 하나씩 표시 (직렬 큐)
  let conflictQueue = Promise.resolve();

  // 목적지 폴더의 기존 파일 목록을 한 번에 가져와 메모리에서 충돌 체크
  // (getMetadata 개별 호출 시 브라우저 콘솔에 404 로그가 남는 문제 방지)
  const existingDestPaths = new Set(await listAllFilesInFolder(storage, to));

  await Promise.all(
    paths.map(async (fullPath) => {
      const base = storageObjectBasename(fullPath);
      if (!base.endsWith(".csv")) {
        throw new Error(`Only .csv allowed: ${fullPath}`);
      }
      const destPath = `${to}${base}`.replace(/^\/+/, "");
      const destRef = ref(storage, destPath);
      const srcRef = ref(storage, fullPath);

      // 목적지 파일 존재 여부 확인 (사전에 가져온 목록으로 체크)
      const destExists = existingDestPaths.has(destPath);

      if (destExists) {
        let resolution: ConflictResolution = "skip";
        // 충돌 다이얼로그는 직렬로 처리
        await (conflictQueue = conflictQueue.then(async () => {
          if (cancelled) return;
          resolution = onConflict ? await onConflict(base) : "skip";
          if (resolution === "cancel") cancelled = true;
        }));
        if (cancelled || resolution === "skip") {
          skipped.push(fullPath);
          return;
        }
      }

      if (cancelled) return;

      const bytes = await downloadFileBytes(storage, fullPath);
      if (cancelled) return;
      await uploadBytes(destRef, bytes, {
        contentType: "text/csv; charset=utf-8",
      });
      await deleteObject(srcRef);
      moved.push({ from: fullPath, to: destPath });
    })
  );

  // 소스 폴더가 비어도 계속 표시되도록 플레이스홀더 복구
  if (moved.length > 0 && fromPrefix) {
    await uploadString(
      ref(storage, specAdminPlaceholderObjectPath(fromPrefix)),
      "",
      "raw",
      { contentType: "text/plain" }
    );
  }

  return { moved, skipped };
}

export async function clientDeleteFilesByFullPaths(
  storage: FirebaseStorage,
  paths: string[]
): Promise<void> {
  for (const p of paths) assertSafeStorageRelativePath(p);
  for (const fullPath of paths) {
    await deleteObjectIgnoreMissing(storage, fullPath);
  }
}

async function assertDestNotExists(storage: FirebaseStorage, fullPath: string) {
  const r = ref(storage, fullPath);
  try {
    await getMetadata(r);
    throw new Error(`Destination already exists: ${fullPath}`);
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? String((e as { code: string }).code)
        : "";
    if (code === "storage/object-not-found") return;
    throw e;
  }
}

export async function clientMoveSpecs(
  storage: FirebaseStorage,
  fromFolder: string,
  toFolder: string,
  specs: string[] | "ALL"
): Promise<{
  moved: { from: string; to: string }[];
  sourceFolderEmpty: boolean;
}> {
  const from = normalizeFolder(fromFolder);
  const to = normalizeFolder(toFolder);
  if (from === to) {
    throw new Error("fromFolder and toFolder must differ");
  }

  const sourceRows = await listSpecCsvFilesUnderPrefixClient(storage, from);
  const specSet = specs === "ALL" ? null : new Set(specs);
  const toMove = specSet
    ? sourceRows.filter((r) => r.spec && specSet.has(r.spec))
    : sourceRows;


  const moved: { from: string; to: string }[] = [];

  for (const row of toMove) {
    const destPath = `${to}${row.fileName}`.replace(/^\/+/, "");
    await assertDestNotExists(storage, destPath);

    const srcRef = ref(storage, row.fullPath);
    const destRef = ref(storage, destPath);
    const bytes = await downloadFileBytes(storage, row.fullPath);
    await uploadBytes(destRef, bytes, {
      contentType: "text/csv; charset=utf-8",
    });
    await deleteObject(srcRef);
    moved.push({ from: row.fullPath, to: destPath });
  }

  // 소스 폴더가 비어도 계속 표시되도록 플레이스홀더 복구
  if (moved.length > 0) {
    await uploadString(
      ref(storage, specAdminPlaceholderObjectPath(from)),
      "",
      "raw",
      { contentType: "text/plain" }
    );
  }

  const remaining = await listSpecCsvFilesUnderPrefixClient(storage, from);
  return { moved, sourceFolderEmpty: remaining.length === 0 };
}

/**
 * fromFolder의 모든 CSV를 toFolder로 병합.
 * 같은 displayName이 toFolder에 있으면 해당 파일들을 먼저 삭제한 뒤 이동.
 */
export async function mergeFolderClient(
  storage: FirebaseStorage,
  fromFolder: string,
  toFolder: string,
  onFileComplete?: (displayName: string) => void,
): Promise<{ moved: { from: string; to: string }[]; deleted: string[] }> {
  const from = normalizeFolder(fromFolder);
  const to = normalizeFolder(toFolder);
  if (from === to) throw new Error("fromFolder and toFolder must differ");

  const [srcFiles, destFiles] = await Promise.all([
    listSpecCsvFilesUnderPrefixClient(storage, from),
    listSpecCsvFilesUnderPrefixClient(storage, to),
  ]);

  if (srcFiles.length === 0) return { moved: [], deleted: [] };

  // displayName 별로 dest 파일 인덱싱
  const destByDisplay = new Map<string, string[]>();
  for (const f of destFiles) {
    const arr = destByDisplay.get(f.displayName) ?? [];
    arr.push(f.fullPath);
    destByDisplay.set(f.displayName, arr);
  }

  // 충돌 파일 삭제 (병렬)
  const deleted: string[] = [];
  await Promise.all(
    srcFiles.flatMap((srcFile) => {
      const conflicting = destByDisplay.get(srcFile.displayName);
      if (!conflicting) return [];
      destByDisplay.delete(srcFile.displayName);
      return conflicting.map(async (path) => {
        await deleteObjectIgnoreMissing(storage, path);
        deleted.push(path);
      });
    })
  );

  // 소스 파일 이동 (병렬)
  const moved: { from: string; to: string }[] = [];
  await Promise.all(
    srcFiles.map(async (srcFile) => {
      const destPath = `${to}${srcFile.fileName}`;
      const bytes = await downloadFileBytes(storage, srcFile.fullPath);
      await uploadBytes(ref(storage, destPath), bytes, {
        contentType: "text/csv; charset=utf-8",
      });
      await deleteObject(ref(storage, srcFile.fullPath));
      moved.push({ from: srcFile.fullPath, to: destPath });
      onFileComplete?.(srcFile.displayName);
    })
  );

  return { moved, deleted };
}

/** 버전 폴더 생성 (placeholder 파일 업로드) */
export async function createFolderClient(
  storage: FirebaseStorage,
  folderName: string
): Promise<void> {
  const folder = normalizeFolder(folderName);
  const placeholderPath = specAdminPlaceholderObjectPath(folder);
  await uploadString(ref(storage, placeholderPath), "", "raw", {
    contentType: "text/plain",
  });
}

/** 폴더 표시명(가상 키) → 실제 prefix 매핑을 Storage JSON으로 게시 */
export async function publishFolderRoutesManifestClient(
  storage: FirebaseStorage,
  folders: string[],
  folderNames: Record<string, string>,
  liveRoute?: string | null
): Promise<void> {
  const existing = await readFolderRoutesManifestClient(storage);
  const merged = mergeFolderNamesWithExistingManifest(folders, folderNames, existing);
  const manifest = buildFolderRoutesManifest(folders, merged, liveRoute);
  await uploadString(
    ref(storage, SPEC_FOLDER_ROUTES_STORAGE_PATH),
    JSON.stringify(manifest, null, 2),
    "raw",
    { contentType: "application/json; charset=utf-8" }
  );
}

/** folder-routes.json 매니페스트 읽기 (없으면 null) */
export async function readFolderRoutesManifestClient(
  storage: FirebaseStorage
): Promise<import("@/lib/spec/folder-routes-manifest").FolderRoutesManifest | null> {
  const user = getAuth(storage.app).currentUser;
  if (!user) return null;
  const idToken = await user.getIdToken();
  const bucket = ref(storage).bucket;
  const encodedPath = encodeURIComponent(SPEC_FOLDER_ROUTES_STORAGE_PATH);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Firebase ${idToken}` } });
  if (!res.ok) return null;
  return (await res.json()) as import("@/lib/spec/folder-routes-manifest").FolderRoutesManifest;
}

/** CSV 파일 텍스트 읽기 */
export async function readCsvFileClient(
  storage: FirebaseStorage,
  fullPath: string
): Promise<string> {
  const bytes = await downloadFileBytes(storage, fullPath);
  return new TextDecoder("utf-8").decode(bytes);
}

/** chart-memos.json 전체 읽기 */
export async function getChartMemosClient(storage: FirebaseStorage): Promise<ChartMemos> {
  const user = getAuth(storage.app).currentUser;
  if (!user) throw new Error("로그인이 필요합니다");
  const idToken = await user.getIdToken();
  const bucket = ref(storage).bucket;
  const encodedPath = encodeURIComponent(CHART_MEMOS_STORAGE_PATH);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Firebase ${idToken}` } });
  if (!res.ok) return {};
  return (await res.json()) as ChartMemos;
}

/** 파일 이동 후 메모 키(= fullPath)를 새 경로로 일괄 재매핑 */
export async function migrateChartMemosClient(
  storage: FirebaseStorage,
  moved: { from: string; to: string }[]
): Promise<void> {
  if (moved.length === 0) return;
  const memos = await getChartMemosClient(storage);
  let changed = false;
  for (const { from, to } of moved) {
    if (from === to || !(from in memos)) continue;
    memos[to] = memos[from];
    delete memos[from];
    changed = true;
  }
  if (!changed) return;
  await uploadString(
    ref(storage, CHART_MEMOS_STORAGE_PATH),
    JSON.stringify(memos, null, 2),
    "raw",
    { contentType: "application/json; charset=utf-8" }
  );
}

/** 인벤토리에 없는 CSV fullPath 키의 차트 메모 제거 */
export async function pruneOrphanChartMemosClient(
  storage: FirebaseStorage
): Promise<{ removedKeys: string[]; memos: ChartMemos }> {
  const inv = await fetchInventoryClient(storage);
  const valid = new Set(inv.files.map((f) => f.fullPath));
  const memos = await getChartMemosClient(storage);
  const { next, removedKeys } = filterChartMemosToValidPaths(memos, valid);
  if (removedKeys.length === 0) {
    return { removedKeys, memos: next };
  }
  await uploadString(
    ref(storage, CHART_MEMOS_STORAGE_PATH),
    JSON.stringify(next, null, 2),
    "raw",
    { contentType: "application/json; charset=utf-8" }
  );
  return { removedKeys, memos: next };
}

/** chart-memos.json에 단일 메모 저장 (memo가 빈 문자열이면 키 삭제). 업로드 결과 generation 반환(추가 getMetadata 왕복 생략). */
export async function saveChartMemoClient(
  storage: FirebaseStorage,
  key: string,
  memo: string
): Promise<string | null> {
  const memos = await getChartMemosClient(storage);
  if (memo.trim()) {
    memos[key] = memo.trim();
  } else {
    delete memos[key];
  }
  const r = ref(storage, CHART_MEMOS_STORAGE_PATH);
  const result = await uploadString(
    r,
    JSON.stringify(memos, null, 2),
    "raw",
    { contentType: "application/json; charset=utf-8" }
  );
  const g = result.metadata.generation;
  if (g !== undefined && g !== null) return String(g);
  try {
    const m = await getMetadata(r);
    return m.generation != null ? String(m.generation) : null;
  } catch {
    return null;
  }
}

/** folder-routes.json의 liveRoute 필드만 업데이트 */
export async function setLiveRouteClient(
  storage: FirebaseStorage,
  liveRoute: string | null
): Promise<void> {
  const user = getAuth(storage.app).currentUser;
  if (!user) throw new Error("로그인이 필요합니다");
  const idToken = await user.getIdToken();
  const bucket = ref(storage).bucket;
  const encodedPath = encodeURIComponent(SPEC_FOLDER_ROUTES_STORAGE_PATH);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media`;

  let manifest: Record<string, unknown> = {};
  const res = await fetch(url, { headers: { Authorization: `Firebase ${idToken}` } });
  if (res.ok) {
    manifest = (await res.json()) as Record<string, unknown>;
  }

  if (liveRoute) {
    manifest.liveRoute = liveRoute;
  } else {
    delete manifest.liveRoute;
  }
  manifest.updatedAt = new Date().toISOString();

  await uploadString(
    ref(storage, SPEC_FOLDER_ROUTES_STORAGE_PATH),
    JSON.stringify(manifest, null, 2),
    "raw",
    { contentType: "application/json; charset=utf-8" }
  );
}

/**
 * 버전 폴더 안 모든 파일 나열 (CSV + placeholder 포함, 재귀).
 * SDK의 list()가 일부 경로에서 빈 결과를 반환하는 문제를 피하기 위해
 * REST API를 직접 사용한다 (downloadFileBytes와 동일한 방식).
 */
async function listAllFilesInFolder(
  storage: FirebaseStorage,
  folderName: string
): Promise<string[]> {
  const user = getAuth(storage.app).currentUser;
  if (!user) throw new Error("로그인이 필요합니다");
  const idToken = await user.getIdToken();
  const bucket = ref(storage).bucket;
  const folder = normalizeFolder(folderName);
  const encodedPrefix = encodeURIComponent(folder);
  const paths: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages++;
    if (pages > LIST_MAX_PAGES) throw new Error("목록 페이지 초과");
    const url =
      `https://firebasestorage.googleapis.com/v0/b/${bucket}/o` +
      `?prefix=${encodedPrefix}&maxResults=1000` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Firebase ${idToken}` },
    });
    if (!res.ok) throw new Error(`목록 조회 실패: ${res.status}`);
    const data = (await res.json()) as {
      items?: { name: string }[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      paths.push(item.name);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return paths;
}

/** 버전 폴더 안 파일 수 반환 (CSV만) */
export async function countFilesInFolderClient(
  storage: FirebaseStorage,
  folderName: string
): Promise<number> {
  const all = await listAllFilesInFolder(storage, folderName);
  return all.filter((p) => p.endsWith(".csv")).length;
}

/** 버전 폴더 삭제 (안의 파일 전부 삭제) */
export async function deleteFolderClient(
  storage: FirebaseStorage,
  folderName: string
): Promise<void> {
  const paths = await listAllFilesInFolder(storage, folderName);
  const results = await Promise.allSettled(
    paths.map((p) => deleteObject(ref(storage, p)))
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    const msgs = failed.map((r) =>
      r.status === "rejected"
        ? (r.reason instanceof Error ? r.reason.message : String(r.reason))
        : ""
    );
    throw new Error(`삭제 실패 ${failed.length}개: ${msgs[0]}`);
  }
}

/** 버전 번호 변경: 기존 파일을 새 버전명으로 copy 후 삭제 */
export async function renameVersionClient(
  storage: FirebaseStorage,
  fullPath: string,
  newVersion: number
): Promise<{ from: string; to: string }> {
  const { parseVersionedFileName, buildVersionedFileName } = await import("@/lib/spec/versioned-filename");
  const slashIdx = fullPath.lastIndexOf("/");
  const folder = slashIdx >= 0 ? fullPath.slice(0, slashIdx + 1) : "";
  const fileName = slashIdx >= 0 ? fullPath.slice(slashIdx + 1) : fullPath;
  const parsed = parseVersionedFileName(fileName);
  if (!parsed) throw new Error("버전 마커가 없는 파일입니다");
  if (parsed.version === newVersion) return { from: fullPath, to: fullPath };
  const newFileName = buildVersionedFileName(parsed.displayName, newVersion);
  const newFullPath = `${folder}${newFileName}`;
  // download
  const bytes = await downloadFileBytes(storage, fullPath);
  // upload with new name
  await uploadBytes(ref(storage, newFullPath), bytes, {
    contentType: "text/csv; charset=utf-8",
  });
  // delete old
  await deleteObject(ref(storage, fullPath));

  try {
    await migrateChartMemosClient(storage, [{ from: fullPath, to: newFullPath }]);
  } catch {
    /* rename은 완료됨; 메모 이전만 실패한 경우 새로고침으로 동기화 */
  }

  return { from: fullPath, to: newFullPath };
}

export async function uploadFilesClient(
  storage: FirebaseStorage,
  folder: string,
  files: File[]
): Promise<void> {
  const normalizedFolder = folder.endsWith("/") ? folder : `${folder}/`;

  // 폴더 내 기존 파일 조회 → displayName 별 최대 버전 계산
  const existingPaths = await listAllFilesInFolder(storage, folder);
  const maxByName: Record<string, number> = {};
  for (const p of existingPaths) {
    const base = storageObjectBasename(p);
    const versioned = parseVersionedFileName(base);
    if (versioned) {
      if ((maxByName[versioned.displayName] ?? 0) < versioned.version) {
        maxByName[versioned.displayName] = versioned.version;
      }
    }
  }

  for (const file of files) {
    const nextVersion = (maxByName[file.name] ?? 0) + 1;
    maxByName[file.name] = nextVersion;
    const storedName = buildVersionedFileName(file.name, nextVersion);
    await uploadBytes(ref(storage, `${normalizedFolder}${storedName}`), file, {
      contentType: file.type || "text/csv; charset=utf-8",
    });
  }
}
