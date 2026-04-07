export type RepeatDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/** 다음 반복 발송 시각(UTC 시·분 기준) — 스케줄 API·크론·관리자 UI 공통 */
export function computeNextRunAt(repeatDays: RepeatDay[], repeatTime: string): Date {
  const parts = repeatTime.split(":");
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setUTCDate(now.getUTCDate() + offset);
    candidate.setUTCHours(hours, minutes, 0, 0);
    if (candidate <= now) continue;
    const dayName = dayNames[candidate.getUTCDay()];
    if (repeatDays.includes(dayName as RepeatDay)) {
      return candidate;
    }
  }

  const firstDay = repeatDays[0]!;
  const targetDayIdx = dayNames.indexOf(firstDay);
  const nowDay = now.getUTCDay();
  const daysUntil = ((targetDayIdx - nowDay + 7) % 7) || 7;
  const candidate = new Date(now);
  candidate.setUTCDate(now.getUTCDate() + daysUntil);
  candidate.setUTCHours(hours, minutes, 0, 0);
  return candidate;
}
