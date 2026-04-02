/**
 * 관리자 툴 전용 버전 마커: 파일명에 {N} 을 삽입해 버전을 추적합니다.
 * 실제 파일명과 무관하게 우리만의 버전을 관리합니다.
 *
 * 예) "Hero.csv" + version 3  →  "Hero{3}.csv"
 *     "data_v2.csv" + version 1  →  "data_v2{1}.csv"
 */

// Hero{3}.csv  →  groups: ["Hero", "3", ".csv"]
const VERSIONED_PATTERN = /^(.*)\{(\d+)\}(\.[^./]*)$/;

export function buildVersionedFileName(originalName: string, version: number): string {
  const dotIdx = originalName.lastIndexOf(".");
  if (dotIdx < 0) return `${originalName}{${version}}`;
  return `${originalName.slice(0, dotIdx)}{${version}}${originalName.slice(dotIdx)}`;
}

export function parseVersionedFileName(
  storedName: string
): { displayName: string; version: number } | null {
  const m = storedName.match(VERSIONED_PATTERN);
  if (!m) return null;
  const version = parseInt(m[2], 10);
  if (!Number.isFinite(version) || version < 1) return null;
  return { displayName: m[1] + (m[3] ?? ""), version };
}
