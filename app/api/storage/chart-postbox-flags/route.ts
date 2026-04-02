import { NextResponse } from "next/server";

import { SPEC_FOLDER_ROUTES_STORAGE_PATH } from "@/lib/spec/folder-routes-manifest";
import { getSpecBucket } from "@/lib/firebase-admin";
import { listAllSpecCsvFiles } from "@/lib/storage/spec-inventory";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";

/**
 * `.csv` 제거 후 끝의 `{버전}` 도 제거한 **논리 차트명** (우편 item 판별용).
 * 예: `item{7}.csv` → `item`, `item.csv` → `item`
 */
export function logicalChartStemForPostbox(name: string): string {
  const noExt = name.replace(/\.csv$/i, "").trim();
  return noExt.replace(/\{\d+\}$/, "").trim();
}

/**
 * 우편 보상 후보: 논리 차트명이 정확히 `item` 인 것만 (`itemA`, `items` 제외).
 * `displayName` / `fileName` 둘 중 하나라도 맞으면 포함(버전 `{}` 는 비교에서 생략).
 */
export function isPostboxItemChartFile(f: { displayName: string; fileName: string }): boolean {
  const ok = (s: string) => logicalChartStemForPostbox(s).toLowerCase() === "item";
  return ok(f.displayName) || ok(f.fileName);
}

async function readRoutes(): Promise<Record<string, string>> {
  try {
    const [buf] = await getSpecBucket().file(SPEC_FOLDER_ROUTES_STORAGE_PATH).download();
    const manifest = JSON.parse(buf.toString("utf-8")) as { routes?: Record<string, string> };
    return manifest?.routes ?? {};
  } catch {
    return {};
  }
}

/** prefixToVersion은 { "0/": "base" } 형태. */
function chartListMeta(
  file: { folder: string; displayName: string },
  prefixToVersion: Record<string, string>,
): { chartLabel: string; appVersion: string; chartName: string; tableName: string } {
  const appVersion = prefixToVersion[file.folder] || file.folder.replace(/\/$/, "") || file.folder;
  const chartName = file.displayName.replace(/\.csv$/i, "");
  return {
    chartLabel: `${appVersion} / ${chartName}`,
    appVersion,
    chartName,
    tableName: chartName,
  };
}

export type PostboxChartInfo = {
  fullPath: string;
  chartLabel: string; // "앱버전 / 차트명"
  /** 폴더 라우트에 매핑된 표시명(없으면 폴더 prefix) */
  appVersion: string;
  /** 파일 표시명에서 .csv 제거 */
  chartName: string;
  tableName: string;
};

/**
 * GET: 인벤토리에서 논리 차트명이 `item` 인 차트만 `charts`로 반환.
 * (구형 Firestore 플래그 등록 방식은 사용하지 않음 — `flags`는 빈 객체로 고정)
 */
export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const bucket = getSpecBucket();
    const [routes, allFiles] = await Promise.all([
      readRoutes(),
      listAllSpecCsvFiles(bucket).catch(() => []),
    ]);

    // routes: { "base": "0/" } → 뒤집어서 prefixToVersion: { "0/": "base" }
    const prefixToVersion: Record<string, string> = {};
    for (const [displayName, prefix] of Object.entries(routes)) {
      prefixToVersion[prefix] = displayName;
    }

    const charts: PostboxChartInfo[] = allFiles
      .filter((f) => isPostboxItemChartFile(f))
      .map((f) => {
        const m = chartListMeta(f, prefixToVersion);
        return {
          fullPath: f.fullPath,
          chartLabel: m.chartLabel,
          appVersion: m.appVersion,
          chartName: m.chartName,
          tableName: m.tableName,
        };
      })
      .sort((a, b) => a.chartLabel.localeCompare(b.chartLabel));

    return NextResponse.json({ ok: true, flags: {} as Record<string, boolean>, charts });
  } catch (e) {
    return jsonStorageError(e);
  }
}

/** 레거시: 예전 관리 UI가 POST 하던 경로. 더 이상 저장하지 않고 성공만 반환 */
export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    await req.json().catch(() => ({}));
    return NextResponse.json({ ok: true, flags: {} as Record<string, boolean> });
  } catch (e) {
    return jsonStorageError(e);
  }
}
