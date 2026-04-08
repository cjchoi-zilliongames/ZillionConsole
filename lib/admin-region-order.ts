import { REGION_GLOBAL, normalizeRegionCode } from "@/lib/region-catalog";

/**
 * 우편·공지 Admin: GLOBAL 항상 앞, 나머지 regionCode 알파벳 순.
 * fallback 은 첫 번째(GLOBAL)만 true.
 */

function isGlobalCode(code: string): boolean {
  return normalizeRegionCode(code) === REGION_GLOBAL;
}

export function orderRegionsGlobalFirst<T extends { regionCode: string }>(list: readonly T[]): T[] {
  const globalRows = [...list].filter((c) => isGlobalCode(c.regionCode));
  const rest = [...list]
    .filter((c) => !isGlobalCode(c.regionCode))
    .sort((a, b) => normalizeRegionCode(a.regionCode).localeCompare(normalizeRegionCode(b.regionCode)));
  return [...globalRows, ...rest];
}

export function assignGlobalFirstFallback<T extends { regionCode: string }>(
  list: readonly T[],
): Array<T & { fallback: boolean }> {
  const ordered = orderRegionsGlobalFirst(list);
  return ordered.map((e, i) => ({ ...e, fallback: i === 0 }));
}
