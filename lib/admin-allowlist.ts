/**
 * 툴 접속 허용 이메일 — `ADMIN_ALLOWED_EMAILS` (쉼표·줄바꿈으로 여러 개).
 * 비어 있으면 아무도 통과하지 못함 (반드시 설정).
 *
 * Vercel 등: 값 전체를 따옴표로 감싸 복붙하거나 전각 쉼표(，)를 쓴 경우도 처리한다.
 */
export function parseAdminAllowedEmails(): string[] {
  let raw = process.env.ADMIN_ALLOWED_EMAILS;
  if (typeof raw !== "string") return [];
  raw = raw.trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }
  if (!raw) return [];
  return raw
    .split(/[,;\n\r\uFF0C\u3001]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminAllowlistActive(): boolean {
  return parseAdminAllowedEmails().length > 0;
}

export function isAdminToolEmailAllowed(email: string | null | undefined): boolean {
  if (!isAdminAllowlistActive()) return false;
  if (!email || !email.trim()) return false;
  const normalized = email.trim().toLowerCase();
  return parseAdminAllowedEmails().includes(normalized);
}

/** 목록이 비어 있으면 ALLOWLIST_REQUIRED, 이메일이 없거나 목록에 없으면 FORBIDDEN */
export function assertAdminToolEmailAllowed(email: string | null | undefined): void {
  if (!isAdminAllowlistActive()) {
    throw new Error("ALLOWLIST_REQUIRED");
  }
  if (!isAdminToolEmailAllowed(email)) {
    throw new Error("FORBIDDEN");
  }
}
