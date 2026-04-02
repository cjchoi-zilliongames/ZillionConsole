/**
 * 상단바·사이드바에 표시할 프로젝트 이름.
 * `NEXT_PUBLIC_FIREBASE_PROJECT_DISPLAY_NAME` 이 있으면 우선 (예: TeamBattle).
 */
export function resolveAdminProjectDisplayName(projectId: string | null | undefined): string {
  const display = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_DISPLAY_NAME?.trim();
  if (display) return display;

  const id = projectId?.trim();
  if (!id) return "프로젝트";

  const first = id.split("-")[0] ?? id;
  if (!first) return id;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
