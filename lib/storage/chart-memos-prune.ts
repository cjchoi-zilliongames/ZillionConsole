import type { ChartMemos } from "@/lib/spec/chart-memos";

/** 인벤토리에 있는 CSV fullPath만 남기고 나머지 메모 키는 제거 목록으로 돌린다. */
export function filterChartMemosToValidPaths(
  memos: ChartMemos,
  validCsvFullPaths: ReadonlySet<string>
): { next: ChartMemos; removedKeys: string[] } {
  const next: ChartMemos = {};
  const removedKeys: string[] = [];
  for (const [k, v] of Object.entries(memos)) {
    if (validCsvFullPaths.has(k)) {
      next[k] = v;
    } else {
      removedKeys.push(k);
    }
  }
  return { next, removedKeys };
}
