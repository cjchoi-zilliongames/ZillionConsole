/**
 * 레거시 타입·문서 상수. 우편 보상 후보 차트는 API에서 `item.csv` 표시명으로만 판별한다.
 * (구 `config/chartPostboxFlags` 플래그 등록 UI는 제거됨.)
 */
export const CHART_POSTBOX_FLAGS_DOC = { collection: "config", doc: "chartPostboxFlags" } as const;

export type ChartPostboxFlags = Record<string, boolean>;
