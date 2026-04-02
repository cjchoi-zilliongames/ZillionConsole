/**
 * 우편 보상: Storage **실제 파일명**이 `item.csv` 또는 `item{버전}.csv` 인 CSV만 후보.
 * 구형 `item_1.csv`·`items.csv` 등은 제외 (관리자 툴 신형 명명만 허용).
 */

/** 전각 중괄호 → ASCII (일부 업로드/복사본 대비) */
function normalizeBraces(s: string): string {
  return s.replace(/\uff5b/g, "{").replace(/\uff5d/g, "}");
}

/**
 * `.csv` 제거 후 끝의 `{숫자}` 를 **반복** 제거한 표시용 차트명.
 * (필터 통과 파일은 항상 item 계열이므로 UI용)
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

/** 폴더 직하위 실제 객체 이름(또는 fullPath basename) 기준 */
const POSTBOX_ITEM_CSV_NAME = /^item(?:\{\d+\})?\.csv$/i;

export function isPostboxItemStorageBasename(fileOrBaseName: string): boolean {
  const t = normalizeBraces(fileOrBaseName.trim());
  const slash = t.lastIndexOf("/");
  const base = slash === -1 ? t : t.slice(slash + 1);
  return POSTBOX_ITEM_CSV_NAME.test(base.trim());
}

/**
 * 인벤토리 한 행: **Storage fileName** 이 `item.csv` / `item{n}.csv` 일 때만 true.
 */
export function isPostboxItemSpecFile(f: { fileName: string }): boolean {
  return isPostboxItemStorageBasename(f.fileName);
}

function basenameFromFullPath(fullPath: string): string {
  const i = fullPath.lastIndexOf("/");
  return i === -1 ? fullPath : fullPath.slice(i + 1);
}

/**
 * API/클라이언트용: fullPath 끝 파일명이 item.csv / item{n}.csv 인지 재검증.
 */
export function isPostboxItemChartPayload(c: { fullPath: string }): boolean {
  return isPostboxItemStorageBasename(basenameFromFullPath(c.fullPath));
}
