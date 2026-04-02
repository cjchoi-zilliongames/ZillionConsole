/**
 * 차트별 메모 — Firebase Storage와 무관한 서버 전용 주석.
 * 게시 경로: Storage `__spec/chart-memos.json`
 * key: CSV Storage fullPath (예: "0/Hero{3}.csv") — 버전 변경 시 rename 경로에서 키 이전 필요.
 * 고아 키는 인벤토리 새로고침 시 자동 정리(prune). API: POST /api/storage/prune-chart-memos
 */
export const CHART_MEMOS_STORAGE_PATH = "__spec/chart-memos.json";

export type ChartMemos = Record<string, string>;

/** 서버가 chart-memos.json 저장 시 generation 불일치(동시 수정)로 거절했을 때 */
export class ChartMemosConflictError extends Error {
  constructor() {
    super("CHART_MEMOS_CONFLICT");
    this.name = "ChartMemosConflictError";
  }
}

export type ChartMemosSnapshot = {
  memos: ChartMemos;
  /** 객체가 없으면 null — 최초 저장 시 POST에 null 전달 */
  generation: string | null;
};
