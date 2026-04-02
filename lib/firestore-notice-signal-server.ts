import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * 공지 API 등 서버에서 notices 변경 후 호출. Admin SDK라 보안 규칙을 우회한다.
 * 클라이언트는 `signals/notice` onSnapshot으로 목록을 다시 불러온다.
 */
export async function bumpNoticeSignalServer(db: Firestore): Promise<void> {
  try {
    await db.collection("signals").doc("notice").set(
      { updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch {
    // 시그널 실패는 무시 — notices 작업은 이미 반영됨
  }
}
