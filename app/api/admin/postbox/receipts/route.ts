import { NextResponse } from "next/server";
import { Timestamp, FieldPath } from "firebase-admin/firestore";
import type { DocumentData } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { COLLECTION_GLOBAL_MAILS, COLLECTION_PERSONAL_MAILS } from "@/lib/firestore-mail-schema";
import { getPersonalDispatchItem } from "@/lib/mail-dispatches-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ReceiptRow = {
  uid: string;
  displayName: string;
  type: "claimed" | "dismissed" | "pending";
  claimedAt: string | null;
  dismissedAt: string | null;
};

export type ReceiptsResponse = {
  ok: true;
  postId: string;
  targetAudience: "all" | "specific";
  total: number;
  claimed: number;
  dismissed: number;
  pending: number;
  receipts: ReceiptRow[];
  nextCursor: string | null;
};

const PAGE_SIZE = 100;

function toIso(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (typeof val === "string") return val;
  return null;
}

function receiptFromPersonalMailDoc(
  uid: string,
  displayName: string,
  data: DocumentData | undefined,
  globalMailId: string
): ReceiptRow {
  if (!data) {
    return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
  }
  const history = data.global_history as unknown;
  if (Array.isArray(history)) {
    for (const e of history) {
      if (e && typeof e === "object" && String((e as { globalMailId?: string }).globalMailId) === globalMailId) {
        return {
          uid,
          displayName,
          type: "claimed",
          claimedAt: toIso((e as { claimedAt?: unknown }).claimedAt),
          dismissedAt: null,
        };
      }
    }
  }
  return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
}

function receiptFromPersonalListEntry(
  uid: string,
  displayName: string,
  data: DocumentData | undefined,
  mailId: string
): ReceiptRow {
  if (!data) {
    return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
  }
  const list = data.personal_list as unknown;
  if (!Array.isArray(list)) {
    return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
  }
  const item = list.find(
    (e: unknown) => e && typeof e === "object" && String((e as { mailId?: string }).mailId) === mailId
  ) as { claimedAt?: unknown; dismissedAt?: unknown } | undefined;
  if (!item) {
    return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
  }
  const dismissedAt = toIso(item.dismissedAt);
  if (dismissedAt) {
    return { uid, displayName, type: "dismissed", claimedAt: null, dismissedAt };
  }
  const claimedAt = toIso(item.claimedAt);
  if (claimedAt) {
    return { uid, displayName, type: "claimed", claimedAt, dismissedAt: null };
  }
  return { uid, displayName, type: "pending", claimedAt: null, dismissedAt: null };
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

    let receipts: ReceiptRow[] = [];
    let total = 0;
    let nextCursor: string | null = null;
    let targetAudience: "all" | "specific" = "all";

    if (postId.startsWith("gm_")) {
      const postSnap = await db.collection(COLLECTION_GLOBAL_MAILS).doc(postId).get();
      if (!postSnap.exists) {
        return NextResponse.json({ ok: false, error: "우편을 찾을 수 없습니다." }, { status: 404 });
      }
      targetAudience = "all";

      if (search) {
        const upperBound = search + "\uf8ff";
        const [uidSnap, nicknameSnap] = await Promise.all([
          db
            .collection("users")
            .where(FieldPath.documentId(), ">=", search)
            .where(FieldPath.documentId(), "<=", upperBound)
            .limit(50)
            .get(),
          db
            .collection("users")
            .where("UserInfo.Nickname", ">=", search)
            .where("UserInfo.Nickname", "<=", upperBound)
            .limit(50)
            .get(),
        ]);

        const seen = new Set<string>();
        const searchDocs: Array<{ id: string; getData: () => DocumentData }> = [];
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
          searchNames[d.id] =
            (dData?.UserInfo?.Nickname as string | undefined) ??
            (dData?.UserInfo?.FS_UID as string | undefined) ??
            "";
        }

        total = searchUids.length;
        if (searchUids.length > 0) {
          const refs = searchUids.map((uid) => db.collection(COLLECTION_PERSONAL_MAILS).doc(uid));
          const snaps = await db.getAll(...refs);
          receipts = searchUids.map((uid, i) =>
            receiptFromPersonalMailDoc(uid, searchNames[uid] || uid, snaps[i]?.data(), postId)
          );
        }
      } else {
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
            (data?.UserInfo?.Nickname as string | undefined) ??
            (data?.UserInfo?.FS_UID as string | undefined) ??
            "";
        }

        if (uids.length > 0) {
          const refs = uids.map((uid) => db.collection(COLLECTION_PERSONAL_MAILS).doc(uid));
          const snaps = await db.getAll(...refs);
          receipts = uids.map((uid, i) =>
            receiptFromPersonalMailDoc(uid, displayNames[uid] || uid, snaps[i]?.data(), postId)
          );
        }
      }
    } else if (postId.startsWith("pm_")) {
      const dispatch = await getPersonalDispatchItem(postId);
      if (!dispatch) {
        return NextResponse.json({ ok: false, error: "우편을 찾을 수 없습니다." }, { status: 404 });
      }
      targetAudience = "specific";
      const recipientEntries = dispatch.recipients;

      const uids = recipientEntries.map((r) => r.uid);
      const displayNames: Record<string, string> = Object.fromEntries(
        recipientEntries.map((r) => [r.uid, r.displayName])
      );
      total = uids.length;

      if (uids.length > 0) {
        const BATCH_SIZE = 500;
        for (let i = 0; i < uids.length; i += BATCH_SIZE) {
          const chunk = uids.slice(i, i + BATCH_SIZE);
          const refs = chunk.map((uid) => db.collection(COLLECTION_PERSONAL_MAILS).doc(uid));
          const snaps = await db.getAll(...refs);
          receipts.push(
            ...chunk.map((uid, j) =>
              receiptFromPersonalListEntry(uid, displayNames[uid] || uid, snaps[j]?.data(), postId)
            )
          );
        }
      }
    } else {
      return NextResponse.json(
        { ok: false, error: "지원하지 않는 우편 ID 형식입니다. (gm_ 또는 pm_ 접두사)" },
        { status: 400 }
      );
    }

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
