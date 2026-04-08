export type RepeatDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

const ALL_DAYS: RepeatDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KST_OFFSET_HOURS = 9;

/** 다음 반복 발송 시각(UTC 시·분 기준) — repeatTime/repeatDays는 UTC 전제 */
export function computeNextRunAt(repeatDays: RepeatDay[], repeatTime: string): Date {
  const parts = repeatTime.split(":");
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  const now = new Date();

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setUTCDate(now.getUTCDate() + offset);
    candidate.setUTCHours(hours, minutes, 0, 0);
    if (candidate <= now) continue;
    const dayName = ALL_DAYS[candidate.getUTCDay()];
    if (repeatDays.includes(dayName as RepeatDay)) {
      return candidate;
    }
  }

  const firstDay = repeatDays[0]!;
  const targetDayIdx = ALL_DAYS.indexOf(firstDay);
  const nowDay = now.getUTCDay();
  const daysUntil = ((targetDayIdx - nowDay + 7) % 7) || 7;
  const candidate = new Date(now);
  candidate.setUTCDate(now.getUTCDate() + daysUntil);
  candidate.setUTCHours(hours, minutes, 0, 0);
  return candidate;
}

// ── KST ↔ UTC 변환 ──────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function shiftDays(days: RepeatDay[], offset: number): RepeatDay[] {
  return days.map((d) => {
    const idx = ALL_DAYS.indexOf(d);
    return ALL_DAYS[(idx + offset + 7) % 7]!;
  });
}

/**
 * 관리 콘솔 입력(KST) → Firestore 저장(UTC) 변환.
 * KST 00:00~08:59는 UTC 전날로 넘어가므로 repeatDays도 -1 시프트.
 */
export function repeatKstToUtc(
  kstTime: string,
  kstDays: RepeatDay[],
): { utcTime: string; utcDays: RepeatDay[] } {
  const [h, m] = kstTime.split(":").map(Number) as [number, number];
  const utcH = ((h - KST_OFFSET_HOURS) + 24) % 24;
  const dayShift = h < KST_OFFSET_HOURS ? -1 : 0;
  return {
    utcTime: `${pad2(utcH)}:${pad2(m)}`,
    utcDays: dayShift ? shiftDays(kstDays, dayShift) : kstDays,
  };
}

/**
 * Firestore 저장(UTC) → 관리 콘솔 표시(KST) 변환.
 * UTC 15:00~23:59는 KST 다음 날로 넘어가므로 repeatDays도 +1 시프트.
 */
export function repeatUtcToKst(
  utcTime: string,
  utcDays: RepeatDay[],
): { kstTime: string; kstDays: RepeatDay[] } {
  const [h, m] = utcTime.split(":").map(Number) as [number, number];
  const kstH = (h + KST_OFFSET_HOURS) % 24;
  const dayShift = h + KST_OFFSET_HOURS >= 24 ? 1 : 0;
  return {
    kstTime: `${pad2(kstH)}:${pad2(m)}`,
    kstDays: dayShift ? shiftDays(utcDays, dayShift) : utcDays,
  };
}
