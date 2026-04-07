import { format } from "date-fns";
import { ko } from "date-fns/locale";

/** 예약 발송 시각 표시 — 로컬, `react-datepicker` `dateFormat`과 동일 */
export const SCHEDULED_AT_DISPLAY_FORMAT = "yyyy'년 'M'월 'd'일 ('EEE')' HH:mm";

export function formatScheduledAtKo(d: Date): string {
  return format(d, SCHEDULED_AT_DISPLAY_FORMAT, { locale: ko });
}
