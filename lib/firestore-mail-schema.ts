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
  fallback: boolean;
};

export type MailRewardStored = {
  table: string;
  row: string;
  count: number;
  rowValues?: Record<string, string>;
};

/** global_history 항목 (수령·중복 방지 + UI용 비정규화) */
export type GlobalHistoryEntry = {
  globalMailId: string;
  title: string;
  rewards: MailRewardStored[];
  /** 유저 UI용 — global_mails.sender 와 동일하게 두면 재조회 없이 표시 가능 */
  sender?: string;
  /** 선택 — 클라이언트가 넣으면 수령 현황에 표시 */
  claimedAt?: Timestamp;
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
  dismissedAt?: Timestamp;
};
