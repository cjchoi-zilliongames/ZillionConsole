/** 스펙 종류 (스킬 spec-data-management 와 동일) */
export const SPEC_NAMES = [
  "Option",
  "Hero",
  "GemMergeExp",
  "Ring",
  "Equip",
  "Item",
  "Exchange",
  "SmithList",
  "StatList",
  "Relic",
  "BoxInfo",
] as const;

export type SpecName = (typeof SPEC_NAMES)[number];

export const SPEC_NAME_SET = new Set<string>(SPEC_NAMES);
