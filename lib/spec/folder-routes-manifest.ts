/**
 * Unity 등 클라이언트가 Storage 물리 폴더 대신 "가상 이름"으로 스펙 루트를 찾을 때 사용하는 매니페스트.
 * 게시 경로: Storage `SPEC_FOLDER_ROUTES_STORAGE_PATH` (application/json).
 *
 * Storage Rules 예: `match /__spec/{file} { allow read: if true; allow write: if false; }`
 * (쓰기는 서비스 계정 / 어드민 SDK로만)
 */

export const SPEC_FOLDER_ROUTES_STORAGE_PATH = "__spec/folder-routes.json";

/** 루트 1단계가 `__` 로 시작하면 시스템용(매니페스트 등)으로 취급해 폴더 목록에서 제외 */
export function isReservedSpecRootPrefix(folderPrefix: string): boolean {
  const first =
    folderPrefix
      .trim()
      .replace(/^\/+/, "")
      .replace(/\/$/, "")
      .split("/")[0] ?? "";
  return first.startsWith("__");
}

export type FolderRoutesManifest = {
  schemaVersion: 1;
  updatedAt: string;
  /** 가상 이름(표시명 등) → 실제 Storage prefix, 항상 `/` 로 끝남 */
  routes: Record<string, string>;
  /** 현재 라이브 가상 키. Unity는 routes[liveRoute] 로 실제 prefix를 조회한다. 없으면 라이브 없음 */
  liveRoute?: string;
};

function normalizeFolderPrefix(input: string): string {
  const t = input.trim().replace(/^\/+/, "");
  if (!t) return "";
  return t.endsWith("/") ? t : `${t}/`;
}

/** Storage JSON 파싱 (깨진 파일·구형 스키마는 null) */
export function parseFolderRoutesManifestJson(data: unknown): FolderRoutesManifest | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;
  const routesRaw = o.routes;
  if (!routesRaw || typeof routesRaw !== "object" || Array.isArray(routesRaw)) return null;
  const routes: Record<string, string> = {};
  for (const [k, v] of Object.entries(routesRaw)) {
    if (typeof v === "string") routes[k] = v;
  }
  const out: FolderRoutesManifest = {
    schemaVersion: 1,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date().toISOString(),
    routes,
  };
  if (typeof o.liveRoute === "string" && o.liveRoute.trim()) {
    out.liveRoute = o.liveRoute.trim();
  }
  return out;
}

/**
 * 다른 사용자가 게시한 표시명이, 로컬에 없는 prefix까지 덮어써 해시 키로 바뀌는 것을 막는다.
 * - `clientFolderNames`에 키가 있으면(빈 문자열 포함) 그 값을 쓴다.
 * - 키가 없으면 기존 매니페스트의 routes를 뒤집어 해당 prefix의 가상 이름을 유지한다.
 */
export function mergeFolderNamesWithExistingManifest(
  folders: string[],
  clientFolderNames: Record<string, string>,
  existing: FolderRoutesManifest | null
): Record<string, string> {
  const prefixToVirtual = new Map<string, string>();
  if (existing?.routes && typeof existing.routes === "object" && !Array.isArray(existing.routes)) {
    for (const [virtualKey, rawPrefix] of Object.entries(existing.routes)) {
      if (typeof rawPrefix !== "string") continue;
      const p = normalizeFolderPrefix(rawPrefix);
      if (!p || isReservedSpecRootPrefix(p)) continue;
      prefixToVirtual.set(p, virtualKey);
    }
  }

  const merged: Record<string, string> = {};
  for (const raw of folders) {
    const prefix = normalizeFolderPrefix(raw);
    if (!prefix || isReservedSpecRootPrefix(prefix)) continue;

    if (Object.prototype.hasOwnProperty.call(clientFolderNames, prefix)) {
      merged[prefix] = (clientFolderNames[prefix] ?? "").trim();
    } else if (prefixToVirtual.has(prefix)) {
      merged[prefix] = prefixToVirtual.get(prefix)!;
    }
  }

  return merged;
}

/**
 * @param folders — 인벤토리에 나온 루트 prefix 목록(예약 `__*` 제외된 것)
 * @param folderNames — `{ "0468a860/": "1.0.0", "0/": "base" }` 형태 (표시명 = Unity가 쓸 가상 키)
 * @param liveRoute — 현재 라이브 가상 키 (routes의 key). null/undefined이면 liveRoute 필드 제외
 */
export function buildFolderRoutesManifest(
  folders: string[],
  folderNames: Record<string, string>,
  liveRoute?: string | null
): FolderRoutesManifest {
  const routes: Record<string, string> = {};
  const usedVirtual = new Set<string>();

  const sorted = [...folders].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  );

  for (const raw of sorted) {
    const prefix = normalizeFolderPrefix(raw);
    if (!prefix || isReservedSpecRootPrefix(prefix)) continue;

    let virtual = (folderNames[prefix] ?? "").trim();
    if (!virtual) {
      virtual = prefix.replace(/\/$/, "") || prefix;
    }
    if (usedVirtual.has(virtual)) {
      throw new Error(
        `가상 이름 "${virtual}" 이(가) 중복됩니다. 해당 폴더 표시명을 서로 다르게 지정해 주세요.`
      );
    }
    usedVirtual.add(virtual);
    routes[virtual] = prefix;
  }

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    routes,
    ...(liveRoute ? { liveRoute } : {}),
  };
}
