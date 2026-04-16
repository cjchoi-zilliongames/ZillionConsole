/**
 * 현재 브라우저 경로를 `next`에 넣어 로그인 페이지 URL 생성.
 * (usePathname을 effect deps에 넣지 않기 위해 window 사용)
 */
export function buildRedirectToAdminLoginUrl(opts?: { denied?: boolean }): string {
  const params = new URLSearchParams();
  if (opts?.denied) params.set("denied", "1");
  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    if (path.startsWith("/admin") && !path.startsWith("/admin/login")) {
      params.set("next", path);
    }
  }
  const q = params.toString();
  return q ? `/admin/login?${q}` : "/admin/login";
}

/**
 * 로그인 직후 이동 경로. open redirect 방지: `/admin` 하위만, 로그인 페이지는 제외.
 */
export function resolvePostLoginAdminPath(nextParam: string | null): string {
  if (nextParam == null || nextParam === "") return "/admin";
  let decoded = nextParam;
  try {
    decoded = decodeURIComponent(nextParam);
  } catch {
    return "/admin";
  }
  const t = decoded.trim();
  if (!t.startsWith("/admin")) return "/admin";
  if (t.startsWith("/admin/login")) return "/admin";
  if (t.includes("//") || t.includes("..")) return "/admin";
  return t;
} 
 