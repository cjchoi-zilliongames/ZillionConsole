import { NextResponse } from "next/server";
import { Timestamp, FieldPath } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ReceiptRow = {
  uid: string;
  displayName: string;
  /** claimed: 수령 / dismissed: 삭제 / pending: 미수령 (PostUserData 문서 없음) */
  type: "claimed" | "dismissed" | "pending";
  claimedAt: string | null;   // ISO
  dismissedAt: string | null; // ISO
};

export type ReceiptsResponse = {
  ok: true;
  postId: string;
  targetAudience: "all" | "specific";
  /** all: 전체 유저 수(COUNT) or 검색 결과 수, specific: 수신자 수 */
  total: number;
  /** 현재 페이지/결과 기준 집계 */
  claimed: number;
  dismissed: number;
  pending: number;
  receipts: ReceiptRow[];
  /** 다음 페이지 커서 (null이면 마지막 페이지 or 검색 모드) */
  nextCursor: string | null;
};

const PAGE_SIZE = 100;

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === "string") return val;
  return null;
}

function docToRow(uid: string, displayName: string, data: FirebaseFirestore.DocumentData | undefined): ReceiptRow {
  if (!data) {
    return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
  }
  const rawType = data.type as string | undefined;
  const type: "claimed" | "dismissed" =
    rawType === "dismissed" ? "dismissed" : "claimed";
  return {
    uid,
    displayName,
    type,
    claimedAt: toIso(data.claimedAt),
    dismissedAt: toIso(data.dismissedAt),
  };
}

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const url = new URL(req.url);
    const postId = (url.searchParams.get("postId") ?? "").trim();
    if (!postId) {
      return NextResponse.json({ ok: false, error: "postId is required" }, { status: 400 });
    }

    const cursor = (url.searchParams.get("cursor") ?? "").trim() || null;
    const search = (url.searchParams.get("search") ?? "").trim();

    const postSnap = await db.collection("posts").doc(postId).get();
    if (!postSnap.exists) {
      return NextResponse.json({ ok: false, error: "우편을 찾을 수 없습니다." }, { status: 404 });
    }
    const postData = postSnap.data()!;
    const targetAudience: "all" | "specific" =
      postData.targetAudience === "specific" ? "specific" : "all";

    let receipts: ReceiptRow[] = [];
    let total = 0;
    let nextCursor: string | null = null;

    if (targetAudience === "specific") {
      // 수신자 목록 확정 — 페이지네이션 불필요 (MAX 100명), 검색은 클라이언트 처리
      const recipientMap = (postData.recipientUids ?? {}) as Record<string, string>;
      const uids = Object.keys(recipientMap);
      total = uids.length;

      if (uids.length > 0) {
        const refs = uids.map((uid) =>
          db.collection("users").doc(uid).collection("PostUserData").doc(postId),
        );
        const snaps = await db.getAll(...refs);
        receipts = uids.map((uid, i) =>
          docToRow(uid, recipientMap[uid] || uid, snaps[i]?.data()),
        );
      }
    } else if (search) {
      // 전체 발송 + 검색 모드: UID 접두사 + Nickname 접두사 쿼리
      const upperBound = search + "\uf8ff";
      const [uidSnap, nicknameSnap] = await Promise.all([
        db.collection("users")
          .where(FieldPath.documentId(), ">=", search)
          .where(FieldPath.documentId(), "<=", upperBound)
          .limit(50)
          .get(),
        db.collection("users")
          .where("UserInfo.Nickname", ">=", search)
          .where("UserInfo.Nickname", "<=", upperBound)
          .limit(50)
          .get(),
      ]);

      // 중복 제거 병합
      const seen = new Set<string>();
      const searchDocs: Array<{ id: string; getData: () => FirebaseFirestore.DocumentData }> = [];
      for (const doc of [...uidSnap.docs, ...nicknameSnap.docs]) {
        if (!seen.has(doc.id)) {
          seen.add(doc.id);
          searchDocs.push({ id: doc.id, getData: () => doc.data() });
        }
      }

      const searchUids = searchDocs.map((d) => d.id);
      const searchNames: Record<string, string> = {};
      for (const d of searchDocs) {
        const dData = d.getData();
        searchNames[d.id] = (dData?.UserInfo?.Nickname as string | undefined) ?? (dData?.UserInfo?.FS_UID as string | undefined) ?? "";
      }

      total = searchUids.length;
      if (searchUids.length > 0) {
        const refs = searchUids.map((uid) =>
          db.collection("users").doc(uid).collection("PostUserData").doc(postId),
        );
        const snaps = await db.getAll(...refs);
        receipts = searchUids.map((uid, i) =>
          docToRow(uid, searchNames[uid] || uid, snaps[i]?.data()),
        );
      }
      // nextCursor = null → 검색 모드에서 페이지네이션 없음
    } else {
      // 전체 발송 + 커서 기반 페이지네이션
      let query = db
        .collection("users")
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE + 1);
      if (cursor) {
        query = query.startAfter(cursor) as typeof query;
      }

      const [usersSnap, totalCountSnap] = await Promise.all([
        query.get(),
        db.collection("users").count().get(),
      ]);

      total = totalCountSnap.data().count;

      const hasMore = usersSnap.docs.length > PAGE_SIZE;
      const userDocs = usersSnap.docs.slice(0, PAGE_SIZE);
      nextCursor = hasMore ? (userDocs[userDocs.length - 1]?.id ?? null) : null;

      const uids = userDocs.map((d) => d.id);
      const displayNames: Record<string, string> = {};
      for (const d of userDocs) {
        const data = d.data();
        displayNames[d.id] =
          (data?.UserInfo?.Nickname as string | undefined) ?? (data?.UserInfo?.FS_UID as string | undefined) ?? "";
      }

      if (uids.length > 0) {
        const refs = uids.map((uid) =>
          db.collection("users").doc(uid).collection("PostUserData").doc(postId),
        );
        const snaps = await db.getAll(...refs);
        receipts = uids.map((uid, i) =>
          docToRow(uid, displayNames[uid] || uid, snaps[i]?.data()),
        );
      }
    }

    // 정렬: claimed → dismissed → pending, 같은 type 내에서 최신순
    receipts.sort((a, b) => {
      const order = { claimed: 0, dismissed: 1, pending: 2 };
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      const ta = a.claimedAt ?? a.dismissedAt ?? "";
      const tb = b.claimedAt ?? b.dismissedAt ?? "";
      return tb.localeCompare(ta);
    });

    const claimed = receipts.filter((r) => r.type === "claimed").length;
    const dismissed = receipts.filter((r) => r.type === "dismissed").length;
    const pending = receipts.filter((r) => r.type === "pending").length;

    return NextResponse.json({
      ok: true,
      postId,
      targetAudience,
      total,
      claimed,
      dismissed,
      pending,
      receipts,
      nextCursor,
    } satisfies ReceiptsResponse);
  } catch (e) {
    return jsonStorageError(e);
  }
}
