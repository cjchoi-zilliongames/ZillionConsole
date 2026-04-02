/** 구형 파일명 형식: Name_N.csv (어떤 이름이든 허용) */
const SPEC_PATTERN = /^([A-Za-z0-9_]+)_(\d+)\.csv$/;

export function parseSpecCsvFileName(
  fileBaseName: string
): { spec: string; version: number } | null {
  const m = fileBaseName.match(SPEC_PATTERN);
  if (!m) return null;
  const version = parseInt(m[2], 10);
  if (!Number.isFinite(version) || version < 1) return null;
  return { spec: m[1], version };
}

export function buildSpecCsvFileName(spec: string, version: number): string {
  if (!Number.isFinite(version) || version < 1) {
    throw new Error("version must be a positive integer");
  }
  return `${spec}_${version}.csv`;
}
