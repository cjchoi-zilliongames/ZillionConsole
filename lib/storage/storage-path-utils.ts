/** Storage 객체 전체 경로에서 파일명만 */
export function storageObjectBasename(fullPath: string): string {
  const i = fullPath.lastIndexOf("/");
  return i < 0 ? fullPath : fullPath.slice(i + 1);
}

export function assertSafeStorageRelativePath(path: string): void {
  const p = path.trim();
  if (!p) throw new Error("path required");
  if (p.startsWith("/") || p.includes("..") || p.includes("\0")) {
    throw new Error("Invalid path");
  }
}

/**
 * 같은 폴더 바로 아래 객체들만 허용. 반환값은 `1.0/` 형태(끝 슬래시) 또는 루트면 `""`.
 */
export function assertDirectPathsInSameFolder(paths: string[]): string {
  if (paths.length === 0) throw new Error("paths required");
  let folder: string | null = null;
  for (const p of paths) {
    assertSafeStorageRelativePath(p);
    const i = p.lastIndexOf("/");
    const f = i < 0 ? "" : p.slice(0, i + 1);
    if (folder === null) folder = f;
    else if (folder !== f) {
      throw new Error("Paths must be in the same folder");
    }
    const name = i < 0 ? p : p.slice(i + 1);
    if (name.includes("/")) {
      throw new Error("Nested paths not supported");
    }
  }
  return folder ?? "";
}
