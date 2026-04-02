import { NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PostboxUserSearchRow = { uid: string; label: string };

function labelFromUserData(uid: string, data: Record<string, unknown>): string {
  const info = data.UserInfo as Record<string, unknown> | undefined;
  if (info && typeof info === "object") {
    for (const key of ["NickName", "Nickname", "DisplayName", "Name", "Email", "email"] as const) {
      const v = info[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  for (const key of ["displayName", "name", "nickname", "email"] as const) {
    const v = data[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return uid;
}

const PAGE_SIZE = 50;

/**
 * GET (no q): 전체 유저 커서 기반 페이지네이션
 * GET ?q=: UID 접두사 + Nickname 접두사 검색, 최대 50건
 */
export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const cursor = (url.searchParams.get("cursor") ?? "").trim() || null;
    const db = getFirestoreDb();

    if (q) {
      // 검색 모드
      const upperBound = q + "\uf8ff";
      const [uidSnap, nicknameSnap] = await Promise.all([
        db.collection("users")
          .where(FieldPath.documentId(), ">=", q)
          .where(FieldPath.documentId(), "<=", upperBound)
          .limit(PAGE_SIZE)
          .get(),
        db.collection("users")
          .where("UserInfo.Nickname", ">=", q)
          .where("UserInfo.Nickname", "<=", upperBound)
          .limit(PAGE_SIZE)
          .get(),
      ]);

      const byId = new Map<string, string>();
      for (const doc of [...uidSnap.docs, ...nicknameSnap.docs]) {
        if (!byId.has(doc.id)) {
          byId.set(doc.id, labelFromUserData(doc.id, doc.data() as Record<string, unknown>));
        }
      }

      const users: PostboxUserSearchRow[] = [...byId.entries()].map(
        ([uid, label]) => ({ uid, label }),
      );
      return NextResponse.json({ ok: true, users, nextCursor: null });
    }

    // 페이지네이션 모드
    let query = db
      .collection("users")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE + 1);
    if (cursor) {
      query = query.startAfter(cursor) as typeof query;
    }

    const snap = await query.get();
    const hasMore = snap.docs.length > PAGE_SIZE;
    const docs = snap.docs.slice(0, PAGE_SIZE);
    const users: PostboxUserSearchRow[] = docs.map((doc) => ({
      uid: doc.id,
      label: labelFromUserData(doc.id, doc.data() as Record<string, unknown>),
    }));
    const nextCursor = hasMore ? (docs[docs.length - 1]?.id ?? null) : null;

    return NextResponse.json({ ok: true, users, nextCursor });
  } catch (e) {
    return jsonStorageError(e);
  }
}
