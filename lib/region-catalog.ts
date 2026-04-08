/** 예약 폴백 지역 — ISO 아님, 항상 첫 탭·삭제 불가 */
export const REGION_GLOBAL = "GLOBAL" as const;

export type RegionCatalogEntry = {
  code: string;
  label: string;
  flag: string;
};

/** 폴백 + 주요 서비스 국가 (ISO 3166-1 alpha-2 대문자) */
export const REGION_CATALOG: readonly RegionCatalogEntry[] = [
  { code: REGION_GLOBAL, label: "기본", flag: "🌐" },
  { code: "KR", label: "대한민국", flag: "🇰🇷" },
  { code: "JP", label: "일본", flag: "🇯🇵" },
  { code: "US", label: "미국", flag: "🇺🇸" },
  { code: "TW", label: "대만", flag: "🇹🇼" },
  { code: "CN", label: "중국", flag: "🇨🇳" },
  { code: "HK", label: "홍콩", flag: "🇭🇰" },
  { code: "SG", label: "싱가포르", flag: "🇸🇬" },
  { code: "TH", label: "태국", flag: "🇹🇭" },
  { code: "VN", label: "베트남", flag: "🇻🇳" },
  { code: "ID", label: "인도네시아", flag: "🇮🇩" },
  { code: "MY", label: "말레이시아", flag: "🇲🇾" },
  { code: "PH", label: "필리핀", flag: "🇵🇭" },
  { code: "GB", label: "영국", flag: "🇬🇧" },
  { code: "DE", label: "독일", flag: "🇩🇪" },
  { code: "FR", label: "프랑스", flag: "🇫🇷" },
  { code: "ES", label: "스페인", flag: "🇪🇸" },
  { code: "IT", label: "이탈리아", flag: "🇮🇹" },
  { code: "BR", label: "브라질", flag: "🇧🇷" },
  { code: "MX", label: "멕시코", flag: "🇲🇽" },
  { code: "CA", label: "캐나다", flag: "🇨🇦" },
  { code: "AU", label: "호주", flag: "🇦🇺" },
  { code: "IN", label: "인도", flag: "🇮🇳" },
] as const;

const BY_CODE = new Map<string, RegionCatalogEntry>();
for (const e of REGION_CATALOG) {
  BY_CODE.set(e.code.toUpperCase(), e);
}

export function regionLabel(code: string): string {
  const k = code.trim().toUpperCase();
  return BY_CODE.get(k)?.label ?? code.trim();
}

export function regionFlag(code: string): string {
  const k = code.trim().toUpperCase();
  return BY_CODE.get(k)?.flag ?? "🌐";
}

/** 미리보기 탭: 라벨만 */
export function regionTabLabel(regionCode: string): string {
  const raw = regionCode.trim();
  if (!raw) return "—";
  return regionLabel(raw);
}

/** 국가 추가 드롭다운 — GLOBAL 제외 */
export const REGION_COUNTRY_OPTIONS: readonly { code: string; label: string }[] = REGION_CATALOG.filter(
  (e) => e.code !== REGION_GLOBAL,
).map((e) => ({ code: e.code, label: `${e.flag} ${e.label} (${e.code})` }));

/** 번역 대상 언어 (기존 translate API LANG_NAMES 와 동일 집합) */
export const TRANSLATE_LANG_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文(간체)" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Indonesia" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
] as const;

export function normalizeRegionCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** GLOBAL 또는 ISO 3166-1 alpha-2 (A–Z 두 글자) */
export function isValidRegionCode(code: string): boolean {
  const c = normalizeRegionCode(code);
  if (c === REGION_GLOBAL) return true;
  return /^[A-Z]{2}$/.test(c);
}
