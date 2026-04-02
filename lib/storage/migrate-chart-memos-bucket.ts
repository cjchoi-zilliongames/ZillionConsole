import type { Bucket } from "@google-cloud/storage";

import { CHART_MEMOS_STORAGE_PATH, type ChartMemos } from "@/lib/spec/chart-memos";

/**
 * Storage CSV 경로가 바뀔 때 chart-memos.json 키(fullPath)를 from → to 로 옮김.
 * move-files, rename-file(버전 변경) 등에서 공통 사용.
 */
export async function migrateChartMemosAfterPathChange(
  bucket: Bucket,
  moved: { from: string; to: string }[]
): Promise<void> {
  if (moved.length === 0) return;
  const file = bucket.file(CHART_MEMOS_STORAGE_PATH);
  let memos: ChartMemos = {};
  try {
    const [buf] = await file.download();
    memos = JSON.parse(buf.toString("utf-8")) as ChartMemos;
  } catch {
    return;
  }
  let changed = false;
  for (const { from, to } of moved) {
    if (from === to || !(from in memos)) continue;
    memos[to] = memos[from];
    delete memos[from];
    changed = true;
  }
  if (!changed) return;
  await file.save(JSON.stringify(memos, null, 2), {
    contentType: "application/json; charset=utf-8",
    resumable: false,
  });
}
