/**
 * 예전: Storage 경로 변경 시 Firestore `config/chartPostboxFlags` 동기화.
 * 우편 보상 차트는 이제 `item.csv` 표시명 규칙만 사용하므로 플래그 갱신은 하지 않는다.
 */
export async function applyChartPostboxFlagPathChanges(_opts: {
  deletePaths?: string[];
  renames?: { from: string; to: string }[];
}): Promise<{ changed: boolean }> {
  return { changed: false };
}
