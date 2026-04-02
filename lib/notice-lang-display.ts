/** 공지 다국어 탭/목록용: 코드 → 표시 이름·국기 (생성 모달·미리보기 공통) */

const ENTRIES: { code: string; label: string; flag: string }[] = [
  { code: "ko", label: "한국어", flag: "🇰🇷" },
  { code: "kr", label: "한국어", flag: "🇰🇷" },
  { code: "en", label: "영어", flag: "🌐" },
  { code: "ja", label: "일본어", flag: "🇯🇵" },
  { code: "zh", label: "중국어(간체)", flag: "🇨🇳" },
  { code: "zh-TW", label: "중국어(번체)", flag: "🇹🇼" },
  { code: "th", label: "태국어", flag: "🇹🇭" },
  { code: "vi", label: "베트남어", flag: "🇻🇳" },
  { code: "id", label: "인도네시아어", flag: "🇮🇩" },
  { code: "es", label: "스페인어", flag: "🇪🇸" },
  { code: "pt", label: "포르투갈어", flag: "🇵🇹" },
  { code: "de", label: "독일어", flag: "🇩🇪" },
  { code: "fr", label: "프랑스어", flag: "🇫🇷" },
];

const BY_CODE = new Map<string, { label: string; flag: string }>();
for (const e of ENTRIES) {
  BY_CODE.set(e.code.toLowerCase(), { label: e.label, flag: e.flag });
}

export function noticeLangLabel(code: string): string {
  const key = code.trim().toLowerCase();
  return BY_CODE.get(key)?.label ?? code.trim();
}

export function noticeLangFlag(code: string): string {
  const key = code.trim().toLowerCase();
  return BY_CODE.get(key)?.flag ?? "🌐";
}

/** 미리보기 탭: 언어명만 (코드·「기본」·국기 없음). 미등록 코드는 그대로 표시. */
export function noticeLocaleTabLabel(language: string): string {
  const raw = language.trim();
  if (!raw) return "—";
  return BY_CODE.get(raw.toLowerCase())?.label ?? raw;
}

/** 생성 모달 드롭다운 등 — 원래 catalog와 동일한 라벨(일본어는 자국어 표기 유지) */
export const NOTICE_LANG_CATALOG: readonly { code: string; label: string }[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "영어" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Indonesia" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
] as const;
