/**
 * 우편 Firestore 구조 (게임 클라이언트와 동일 스키마 가정)
 *
 * global_mails/{globalMailId}
 * personal_mails/{userUID}
 *   - personal_list[]
 *   - global_history[] (전체 우편 수령 기록)
 *
 * personal_mail_dispatches/{mailId} — 개인 우편 메타(소형). 수신자 목록은 Storage mail-dispatches/{mailId}/recipients.json
 *
 * 공통 필드 (global / dispatch): sender (유저에게 보이는 발송인 표시명)
 */

import type { Timestamp } from "firebase-admin/firestore";

export const COLLECTION_GLOBAL_MAILS = "global_mails";
export const COLLECTION_PERSONAL_MAILS = "personal_mails";
/** 개인 우편 발송 메타(제목·보상·recipientListPath 등). 수신자 본문은 Storage */
export const COLLECTION_PERSONAL_MAIL_DISPATCHES = "personal_mail_dispatches";

export type MailLocaleEntry = {
  language: string;
  title: string;
  content: string;
  /** 언어별 발송인 (v2). 없으면 전역 sender 폴백 */
  sender?: string;
  fallback: boolean;
};

export type MailRewardStored = {
  table: string;
  row: string;
  count: number;
  rowValues?: Record<string, string>;
};

export type RepeatDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/** 우편 발송 방식 — Firestore 문서에 저장 */
export type DispatchMode = "immediate" | "scheduled" | "repeat";

/** global_history 항목 (수령·중복 방지 + UI용 비정규화) */
export type GlobalHistoryEntry = {
  globalMailId: string;
  title: string;
  rewards: MailRewardStored[];
  /** 유저 UI용 — global_mails.sender 와 동일하게 두면 재조회 없이 표시 가능 */
  sender?: string;
  /** 선택 — 클라이언트가 넣으면 수령 현황에 표시 */
  claimedAt?: Timestamp;
  /** 반복 우편: 어느 회차에 수령했는지 ("YYYY-MM-DD") — 회차별 중복 수령 방지 */
  repeatKey?: string;
};

/** personal_list 항목 */
export type PersonalListEntry = {
  mailId: string;
  title: string;
  content: string;
  rewards: MailRewardStored[];
  expiresAt: Timestamp;
  /** 유저에게 보이는 발송인 */
  sender: string;
  /** 다국어 제목/내용 목록 (없으면 단일 언어) */
  localeContents?: MailLocaleEntry[];
  claimedAt?: Timestamp;
  /** 클라이언트가 수령 시 true (claimedAt 없을 때) */
  isClaimed?: boolean;
  dismissedAt?: Timestamp;
  /** 예약/반복 우편: 이 시각 이후부터 클라이언트에 표시 */
  visibleFrom?: Timestamp;
  /** 반복 우편: 반복 요일 */
  repeatDays?: RepeatDay[];
  /** 반복 우편: 발송 시각 ("HH:mm", UTC) */
  repeatTime?: string;
  /** 반복 우편: 각 회차 유효 시간(ms) */
  repeatWindowMs?: number;
  /** 반복 우편: 관리자가 선택한 회차별 만료 일수 (1 | 7 | 14 | 30) */
  expiresAfterDays?: number;
};
