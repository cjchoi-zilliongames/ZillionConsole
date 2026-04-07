import type { DocumentData } from "firebase-admin/firestore";

/**
 * 수령 조회 시 global_history.globalMailId 와 맞출 ID.
 * 반복 전체 우편(gsj_*)은 크론이 만든 gm_* 에 기록되므로 작업 문서의 lastDispatchedMailId 로 맞춤.
 */
export function resolveGlobalReceiptMailId(postId: string, jobData: DocumentData): string {
  if (!postId.startsWith("gsj_")) return postId;
  if (jobData.scheduleType !== "repeat") return postId;
  const last = jobData.lastDispatchedMailId;
  return typeof last === "string" && last.startsWith("gm_") ? last : postId;
}

export type PersonalReceiptDispatchTarget = {
  /** personal_list 항목의 mailId */
  receiptMailId: string;
  /** 수신자 목록·recipientListPath 가 있는 dispatch 문서 ID */
  dispatchDocId: string;
};

/**
 * 지정 예약·반복(psj_*)은 실제 우편이 pm_* 로 쌓이므로 personal_list.mailId·수신자 목록은 pm 문서 기준.
 * (레거시: 예약 1회만 psj ID로 넣던 경우 lastDispatchedMailId 없으면 psj 그대로 조회)
 */
export function resolvePersonalReceiptDispatch(
  postId: string,
  jobData: DocumentData
): PersonalReceiptDispatchTarget {
  if (!postId.startsWith("psj_")) {
    return { receiptMailId: postId, dispatchDocId: postId };
  }
  const last = jobData.lastDispatchedMailId;
  if (typeof last === "string" && last.startsWith("pm_")) {
    return { receiptMailId: last, dispatchDocId: last };
  }
  return { receiptMailId: postId, dispatchDocId: postId };
}
