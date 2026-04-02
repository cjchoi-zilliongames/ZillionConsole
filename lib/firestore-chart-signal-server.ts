import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * 차트 관련 API(우편 플래그 등)에서 서버가 `signals/chart`를 갱신할 때 사용.
 * 클라이언트는 `signals/chart` onSnapshot으로 인벤토리·플래그 등을 다시 불러온다.
 */
export async function bumpChartSignalServer(db: Firestore): Promise<void> {
  try {
    await db.collection("signals").doc("chart").set(
      { updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch {
    // 시그널 실패는 무시
  }
}
