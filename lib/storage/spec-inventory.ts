import type { Bucket } from "@google-cloud/storage";

import { parseSpecCsvFileName } from "@/lib/spec/csv-filename";
import { isReservedSpecRootPrefix } from "@/lib/spec/folder-routes-manifest";
import { parseVersionedFileName } from "@/lib/spec/versioned-filename";

export type SpecFileRow = {
  fullPath: string;
  folder: string;
  /** 표시용 파일명 (버전 마커 제거). 예: "Hero.csv" */
  displayName: string;
  version: number;
  /** 실제 Storage 파일명. 예: "Hero{3}.csv" */
  fileName: string;
  /** 구형 파일(Hero_1.csv)의 스펙명. 신형 파일은 undefined */
  spec?: string;
};

function normalizeFolderPrefix(input: string): string {
  const t = input.trim();
  if (!t) return "";
  return t.endsWith("/") ? t : `${t}/`;
}

/** 루트 1단계 폴더 prefix 목록 (예: 0/, 1.0/) */
export async function listRootFolderPrefixes(bucket: Bucket): Promise<string[]> {
  const prefixes = new Set<string>();

  const [, , apiResponse] = await bucket.getFiles({
    prefix: "",
    delimiter: "/",
    maxResults: 1000,
    autoPaginate: true,
  });

  const raw = apiResponse as { prefixes?: string[] } | undefined;
  if (raw?.prefixes?.length) {
    for (const p of raw.prefixes) {
      if (p && p !== "/") {
        const norm = p.endsWith("/") ? p : `${p}/`;
        if (!isReservedSpecRootPrefix(norm)) prefixes.add(norm);
      }
    }
  }

  if (prefixes.size === 0) {
    const [allFiles] = await bucket.getFiles({ autoPaginate: true });
    for (const f of allFiles) {
      const i = f.name.indexOf("/");
      if (i > 0) {
        const norm = f.name.slice(0, i + 1);
        if (!isReservedSpecRootPrefix(norm)) prefixes.add(norm);
      }
    }
  }

  return [...prefixes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function listSpecCsvFilesUnderPrefix(
  bucket: Bucket,
  folderPrefix: string
): Promise<SpecFileRow[]> {
  const prefix = normalizeFolderPrefix(folderPrefix);
  if (!prefix) return [];

  const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
  const rows: SpecFileRow[] = [];

  for (const f of files) {
    if (!f.name.endsWith(".csv")) continue;
    const rel = f.name.slice(prefix.length);
    if (rel.includes("/")) continue;

    // 신형: Hero{3}.csv
    const versioned = parseVersionedFileName(rel);
    if (versioned) {
      rows.push({
        fullPath: f.name,
        folder: prefix,
        displayName: versioned.displayName,
        version: versioned.version,
        fileName: rel,
      });
      continue;
    }

    // 구형 fallback: Hero_1.csv
    const parsed = parseSpecCsvFileName(rel);
    if (parsed) {
      rows.push({
        fullPath: f.name,
        folder: prefix,
        displayName: `${parsed.spec}.csv`,
        version: parsed.version,
        fileName: rel,
        spec: parsed.spec,
      });
      continue;
    }

    // 버전 접미 없이 곧바로 Chart.csv 만 있는 경우 (예: item.csv) — 위 패턴에 안 걸리면 인벤토리에서 사라지므로 ver.1 로 포함
    if (/^.+\.csv$/i.test(rel)) {
      rows.push({
        fullPath: f.name,
        folder: prefix,
        displayName: rel,
        version: 1,
        fileName: rel,
      });
    }
  }

  return rows;
}

/**
 * 폴더 직접 하위에 .csv가 없으면 그 직접 하위 객체만 삭제(플레이스홀더 등).
 * 병합 후 소스 앱 버전 prefix가 스토리지에 남지 않게 할 때 사용.
 */
export async function removeDirectStorageChildrenIfNoTopLevelCsv(
  bucket: Bucket,
  folderPrefix: string
): Promise<string[]> {
  const prefix = normalizeFolderPrefix(folderPrefix);
  if (!prefix) return [];

  const [under] = await bucket.getFiles({ prefix, autoPaginate: true });
  const direct = under.filter((f) => !f.name.slice(prefix.length).includes("/"));
  if (direct.some((f) => f.name.endsWith(".csv"))) return [];

  const removed: string[] = [];
  for (const f of direct) {
    await f.delete({ ignoreNotFound: true });
    removed.push(f.name);
  }
  return removed;
}

export async function listAllSpecCsvFiles(bucket: Bucket): Promise<SpecFileRow[]> {
  const roots = await listRootFolderPrefixes(bucket);
  const out: SpecFileRow[] = [];
  for (const root of roots) {
    const part = await listSpecCsvFilesUnderPrefix(bucket, root);
    out.push(...part);
  }
  return out;
}

/** 폴더 내 displayName 별 최대 버전 (업로드 시 next version 계산용) */
export function maxVersionByDisplayName(
  files: SpecFileRow[],
  folder: string
): Record<string, number> {
  const map: Record<string, number> = {};
  const normalized = folder.endsWith("/") ? folder : `${folder}/`;
  for (const f of files) {
    if (f.folder !== normalized) continue;
    if ((map[f.displayName] ?? 0) < f.version) map[f.displayName] = f.version;
  }
  return map;
}

/** @deprecated 구형 spec 기반 버전 조회 (upload-spec API용 유지) */
export function maxVersionBySpec(files: SpecFileRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const f of files) {
    if (f.spec && (map[f.spec] ?? 0) < f.version) map[f.spec] = f.version;
  }
  return map;
}
