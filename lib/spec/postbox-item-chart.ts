/**
 * 우편 보상: Storage 스펙 CSV 중 **논리 차트명이 정확히 `item`인 것만** 후보로 쓴다.
 * 파일명의 `{버전}` 접미(및 `.csv`)는 비교에서 제외한다.
 */

/** 전각 중괄호 → ASCII (일부 업로드/복사본 대비) */
function normalizeBraces(s: string): string {
  return s.replace(/\uff5b/g, "{").replace(/\uff5d/g, "}");
}

/**
 * `.csv` 제거 후 끝의 `{숫자}` 를 **반복** 제거한 논리 차트명.
 * 예: `item{7}.csv` → `item`, `Item.CSV` → `Item`, `item{2}{1}.csv` → `item`
 */
export function logicalChartStemForPostbox(name: string): string {
  let s = normalizeBraces(name.trim()).replace(/\.csv$/i, "").trim();
  for (;;) {
    const next = s.replace(/\{\d+\}$/, "").trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function stemIsItem(stem: string): boolean {
  return stem.toLowerCase() === "item";
}

/**
 * 인벤토리 한 행: `displayName` / `fileName` 중 하나라도 논리명이 `item`이면 true.
 * (`itemA`, `items`, `myitem` 은 제외)
 */
export function isPostboxItemSpecFile(f: { displayName: string; fileName: string }): boolean {
  return (
    stemIsItem(logicalChartStemForPostbox(f.displayName)) ||
    stemIsItem(logicalChartStemForPostbox(f.fileName))
  );
}

function basenameFromFullPath(fullPath: string): string {
  const i = fullPath.lastIndexOf("/");
  return i === -1 ? fullPath : fullPath.slice(i + 1);
}

/**
 * API/클라이언트용: 응답 객체가 우편 item 차트인지 재검증 (서버·캐시 불일치 방어).
 */
export function isPostboxItemChartPayload(c: {
  chartName: string;
  tableName: string;
  fullPath: string;
}): boolean {
  const base = basenameFromFullPath(c.fullPath);
  return (
    stemIsItem(logicalChartStemForPostbox(c.chartName)) ||
    stemIsItem(logicalChartStemForPostbox(c.tableName)) ||
    stemIsItem(logicalChartStemForPostbox(base))
  );
}
