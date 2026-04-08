import type { MailRegionEntry } from "@/lib/firestore-mail-schema";
import { assignGlobalFirstFallback } from "@/lib/admin-region-order";
import { normalizeRegionCode } from "@/lib/region-catalog";

/** `regionContents[]` 한 행 JSON → MailRegionEntry (`regionCode` 우선, 구 행에만 `language` 키가 있으면 그 값을 코드로 사용) */
export function mailRegionRowFromUnknown(item: unknown): MailRegionEntry | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const rc =
    typeof o.regionCode === "string" && o.regionCode.trim()
      ? normalizeRegionCode(o.regionCode)
      : typeof o.language === "string" && o.language.trim()
        ? normalizeRegionCode(o.language).slice(0, 16)
        : "";
  if (!rc) return null;
  return {
    regionCode: rc,
    title: typeof o.title === "string" ? o.title : "",
    content: typeof o.content === "string" ? o.content : "",
    sender: typeof o.sender === "string" ? o.sender : "",
    fallback: o.fallback === true,
  };
}

/** 저장된 배열을 파싱하고 GLOBAL-first + fallback 플래그 정규화 */
export function regionContentsFromStoredArray(raw: unknown): MailRegionEntry[] {
  if (!Array.isArray(raw)) return [];
  const list = (raw as unknown[]).flatMap((item) => {
    const row = mailRegionRowFromUnknown(item);
    return row ? [row] : [];
  });
  return list.length ? assignGlobalFirstFallback(list) : [];
}
