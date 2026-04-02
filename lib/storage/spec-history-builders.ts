export interface DetailResult {
  detail: string;
  files?: string[];
}

function folderDisplayName(folder: string): string {
  const f = folder.replace(/\/$/, "");
  if (f === "0") return "디폴트 앱버전";
  return `${f} 앱버전`;
}

function fileDisplayName(storagePath: string): string {
  const base = storagePath.split("/").pop() ?? storagePath;
  return base.replace(/\{\d+\}\.csv$/, "").replace(/_\d+\.csv$/, "");
}

/** "displayName\tv3" 형태로 반환 (버전 없으면 탭 없이 이름만) */
function fileDisplayNameWithVersion(storagePath: string): string {
  const base = storagePath.split("/").pop() ?? storagePath;
  const m = base.match(/\{(\d+)\}\.csv$/) ?? base.match(/_(\d+)\.csv$/);
  const name = base.replace(/\{\d+\}\.csv$/, "").replace(/_\d+\.csv$/, "");
  return m ? `${name}\tv${m[1]}` : name;
}

/** names: 표시용 이름(버전 없음), filesWithVersion: 팝업용(버전 포함) */
function summarize(
  names: string[],
  suffix: string,
  filesWithVersion?: string[]
): DetailResult {
  const label =
    names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}개`;
  return {
    detail: `${label}${suffix}`,
    files: names.length > 3 ? (filesWithVersion ?? names) : undefined,
  };
}

export function buildUploadDetail(
  folder: string,
  files: { displayName: string; storedName?: string }[]
): DetailResult {
  const names = files.map((f) => f.displayName.replace(/\.csv$/, ""));
  const filesWithVersion = files.map((f) =>
    f.storedName ? fileDisplayNameWithVersion(f.storedName) : f.displayName.replace(/\.csv$/, "")
  );
  return summarize(names, `를 ${folderDisplayName(folder)}에 업로드`, filesWithVersion);
}

export function buildDeleteDetail(paths: string[]): DetailResult {
  const names = paths.map(fileDisplayName);
  const filesWithVersion = paths.map(fileDisplayNameWithVersion);
  return summarize(names, " 삭제", filesWithVersion);
}

export function buildMoveDetail(
  moved: { from: string; to: string }[],
  getLabel?: (folderPrefix: string) => string
): DetailResult {
  if (moved.length === 0) return { detail: "파일 이동" };
  const label_fn = (prefix: string) =>
    getLabel ? getLabel(`${prefix}/`) : folderDisplayName(prefix);
  const fromFolder = label_fn(moved[0].from.split("/")[0]);
  const toFolder = label_fn(moved[0].to.split("/")[0]);
  const names = moved.map((m) => fileDisplayName(m.from));
  const filesWithVersion = moved.map((m) => fileDisplayNameWithVersion(m.from));
  return summarize(names, `를 ${fromFolder} → ${toFolder}으로 이동`, filesWithVersion);
}

export function buildMergeDetail(
  fromFolder: string,
  moved: { from: string; to: string }[],
  getLabel?: (folderPrefix: string) => string
): DetailResult {
  const fromLabel = getLabel
    ? getLabel(fromFolder)
    : folderDisplayName(fromFolder.replace(/\/$/, ""));
  const filesWithVersion = moved.map((m) => fileDisplayNameWithVersion(m.from));
  return {
    detail: `${fromLabel}을(를) 디폴트 앱버전으로 병합 (${moved.length}개 이동)`,
    files: moved.length > 3 ? filesWithVersion : undefined,
  };
}

export function buildSetLiveDetail(folder: string): DetailResult {
  return { detail: `Live 앱버전을 ${folderDisplayName(folder)}으로 변경` };
}
