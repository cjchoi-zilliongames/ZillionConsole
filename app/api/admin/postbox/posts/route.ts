import { NextResponse } from "next/server";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { bumpPostboxSignalServer } from "@/lib/firestore-postbox-signal-server";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import {
  COLLECTION_GLOBAL_MAILS,
  COLLECTION_PERSONAL_MAILS,
  COLLECTION_PERSONAL_MAIL_DISPATCHES,
  type MailRewardStored,
  type PersonalListEntry,
} from "@/lib/firestore-mail-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PostType = "Admin" | "Repeat" | "User" | "Leaderboard";

export type PostTargetAudience = "all" | "specific";

export type PostRecipientUidMap = Record<string, string>;

export type RewardEntry = {
  table: string;
  row: string;
  count: number;
  rowValues?: Record<string, string>;
};

/** 관리자 API용 — 실제 저장소 구분 */
export type MailStorageKind = "global_mails" | "personal_mail_dispatches";

export type PostDoc = {
  postId: string;
  postType: PostType;
  title: string;
  content: string;
  sender: string;
  isActive: boolean;
  createdAt: string;
  expiresAt: string;
  rewards: RewardEntry[];
  targetAudience: PostTargetAudience;
  recipientUids: PostRecipientUidMap;
  mailStorage: MailStorageKind;
};

const MAX_ROW_VALUE_KEY_LEN = 256;
const MAX_ROW_VALUE_CELL_LEN = 8192;

function normalizeRowValues(raw: unknown): Record<string, string> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    if (!key || key.length > MAX_ROW_VALUE_KEY_LEN) continue;
    const s = v == null ? "" : String(v);
    if (s.length > MAX_ROW_VALUE_CELL_LEN) continue;
    out[key] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

function rewardEntryFromInput(r: unknown): RewardEntry | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (typeof o.table !== "string" || typeof o.row !== "string") return null;
  const table = o.table.trim();
  if (!table) return null;
  let count = 1;
  if (typeof o.count === "number" && Number.isFinite(o.count)) {
    count = Math.max(1, Math.min(999_999, Math.floor(o.count)));
  }
  const rowValues = normalizeRowValues(o.rowValues);
  const base: RewardEntry = { table, row: o.row, count };
  return rowValues ? { ...base, rowValues } : base;
}

function rewardsToStored(arr: RewardEntry[]): MailRewardStored[] {
  return arr.map((r) => {
    const x: MailRewardStored = { table: r.table, row: r.row, count: r.count };
    if (r.rowValues) x.rowValues = r.rowValues;
    return x;
  });
}

function storedToRewards(raw: unknown): RewardEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RewardEntry[] = [];
  for (const x of raw) {
    const r = rewardEntryFromInput({
      table: (x as { table?: string }).table,
      row: (x as { row?: string }).row,
      count: (x as { count?: number }).count,
      rowValues: (x as { rowValues?: unknown }).rowValues,
    });
    if (r) out.push(r);
  }
  return out;
}

function normalizeRecipientMapFromDoc(raw: unknown): PostRecipientUidMap {
  if (raw == null) return {};
  if (Array.isArray(raw)) {
    const m: PostRecipientUidMap = {};
    for (const u of raw) {
      if (typeof u === "string" && u.trim()) m[u.trim()] = "";
    }
    return m;
  }
  if (typeof raw !== "object") return {};
  const m: PostRecipientUidMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const uid = String(k).trim();
    if (!uid) continue;
    m[uid] = typeof v === "string" ? v : String(v ?? "");
  }
  return m;
}

function makeGlobalMailId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `gm_${date}_${time}`;
}

function makePersonalMailId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `pm_${date}_${time}`;
}

function tsToIso(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "string") return v;
  return new Date(0).toISOString();
}

function docToPostDocGlobal(id: string, d: DocumentData): PostDoc {
  return {
    postId: id,
    postType: "Admin",
    title: String(d.title ?? ""),
    content: String(d.content ?? ""),
    sender: String(d.sender ?? ""),
    isActive: d.isActive !== false,
    createdAt: tsToIso(d.createdAt),
    expiresAt: tsToIso(d.expiresAt),
    rewards: storedToRewards(d.rewards),
    targetAudience: "all",
    recipientUids: {},
    mailStorage: "global_mails",
  };
}

function docToPostDocDispatch(id: string, d: DocumentData): PostDoc {
  const recipientMap = normalizeRecipientMapFromDoc(d.recipientUids);
  return {
    postId: id,
    postType: "Admin",
    title: String(d.title ?? ""),
    content: String(d.content ?? ""),
    sender: String(d.sender ?? ""),
    isActive: d.isActive !== false,
    createdAt: tsToIso(d.createdAt),
    expiresAt: tsToIso(d.expiresAt),
    rewards: storedToRewards(d.rewards),
    targetAudience: "specific",
    recipientUids: recipientMap,
    mailStorage: "personal_mail_dispatches",
  };
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const url = new URL(req.url);
    const postType = (url.searchParams.get("postType") ?? "Admin") as PostType;

    if (postType !== "Admin") {
      return NextResponse.json({ ok: true, posts: [] as PostDoc[] });
    }

    const [globalSnap, dispatchSnap] = await Promise.all([
      db.collection(COLLECTION_GLOBAL_MAILS).limit(500).get(),
      db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).limit(500).get(),
    ]);

    const posts: PostDoc[] = [
      ...globalSnap.docs.map((doc) => docToPostDocGlobal(doc.id, doc.data())),
      ...dispatchSnap.docs.map((doc) => docToPostDocDispatch(doc.id, doc.data())),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ ok: true, posts });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

const MAX_RECIPIENTS = 100;

async function appendPersonalListForUser(
  db: Firestore,
  uid: string,
  entry: PersonalListEntry
): Promise<void> {
  const ref = db.collection(COLLECTION_PERSONAL_MAILS).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const personalList = Array.isArray(data.personal_list) ? [...data.personal_list] : [];
    const globalHistory = Array.isArray(data.global_history) ? data.global_history : [];
    const globalDismissed = Array.isArray(data.global_dismissed) ? data.global_dismissed : [];
    personalList.push(entry);
    tx.set(
      ref,
      {
        personal_list: personalList,
        global_history: globalHistory,
        global_dismissed: globalDismissed,
      },
      { merge: true }
    );
  });
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as {
      postType: PostType;
      title: string;
      content: string;
      sender: string;
      expiresAt: string;
      rewards?: RewardEntry[];
      targetAudience?: "all" | "specific";
      recipientUids?: PostRecipientUidMap | string[];
    };

    const { postType, title, content, sender, expiresAt } = body;
    if (!postType || !title || !content || !expiresAt) {
      return NextResponse.json({ ok: false, error: "필수 항목 누락" }, { status: 400 });
    }

    if (postType !== "Admin") {
      return NextResponse.json(
        { ok: false, error: "현재는 관리자 우편(Admin)만 등록할 수 있습니다." },
        { status: 400 }
      );
    }

    const targetAudience: "all" | "specific" =
      body.targetAudience === "specific" ? "specific" : "all";

    const now = new Date();
    const expiresDate = new Date(expiresAt);
    const rewards: RewardEntry[] = Array.isArray(body.rewards)
      ? body.rewards.map((r) => rewardEntryFromInput(r)).filter((r): r is RewardEntry => r != null)
      : [];
    const storedRewards = rewardsToStored(rewards);
    const senderStr = sender || "운영팀";

    if (targetAudience === "all") {
      const mailId = makeGlobalMailId();
      await db.collection(COLLECTION_GLOBAL_MAILS).doc(mailId).set({
        title,
        content,
        sender: senderStr,
        isActive: true,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresDate),
        rewards: storedRewards,
      });
      await bumpPostboxSignalServer(db);
      return NextResponse.json({ ok: true, postId: mailId });
    }

    const rawMap = normalizeRecipientMapFromDoc(body.recipientUids as unknown);
    const uids = Object.keys(rawMap);
    if (uids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "직접 발송일 때 recipientUids 맵에 수신 UID를 1명 이상 넣어 주세요." },
        { status: 400 }
      );
    }
    if (uids.length > MAX_RECIPIENTS) {
      return NextResponse.json(
        { ok: false, error: `수신자는 최대 ${MAX_RECIPIENTS}명까지 지정할 수 있습니다.` },
        { status: 400 }
      );
    }
    const refs = uids.map((uid) => db.collection("users").doc(uid));
    const snaps = await db.getAll(...refs);
    const missing = uids.filter((uid, i) => !snaps[i]?.exists);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `users 컬렉션에 없는 UID가 있습니다: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}`,
        },
        { status: 400 }
      );
    }

    const mailId = makePersonalMailId();
    await db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).doc(mailId).set({
      title,
      content,
      sender: senderStr,
      isActive: true,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresDate),
      rewards: storedRewards,
      recipientUids: rawMap,
    });

    const listEntry: PersonalListEntry = {
      mailId,
      title,
      content,
      rewards: storedRewards,
      expiresAt: Timestamp.fromDate(expiresDate),
      sender: senderStr,
    };

    for (const uid of uids) {
      await appendPersonalListForUser(db, uid, listEntry);
    }

    await bumpPostboxSignalServer(db);
    return NextResponse.json({ ok: true, postId: mailId });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

function mailStorageFromPostId(postId: string): MailStorageKind | null {
  if (postId.startsWith("gm_")) return "global_mails";
  if (postId.startsWith("pm_")) return "personal_mail_dispatches";
  return null;
}

async function removePersonalListEntry(
  db: Firestore,
  uid: string,
  mailId: string
): Promise<void> {
  const ref = db.collection(COLLECTION_PERSONAL_MAILS).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data()!;
    const personalList = Array.isArray(data.personal_list) ? data.personal_list : [];
    const next = personalList.filter(
      (e: { mailId?: string }) => String(e?.mailId) !== mailId
    );
    tx.set(ref, { personal_list: next }, { merge: true });
  });
}

export async function DELETE(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as { postIds: string[] };
    const { postIds } = body;
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return NextResponse.json({ ok: false, error: "postIds 필요" }, { status: 400 });
    }

    for (const postId of postIds) {
      const kind = mailStorageFromPostId(postId);
      if (!kind) {
        return NextResponse.json(
          { ok: false, error: `알 수 없는 우편 ID 형식입니다: ${postId}` },
          { status: 400 }
        );
      }
      if (kind === "global_mails") {
        await db.collection(COLLECTION_GLOBAL_MAILS).doc(postId).delete();
        continue;
      }
      const dRef = db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).doc(postId);
      const dSnap = await dRef.get();
      if (dSnap.exists) {
        const recipientMap = normalizeRecipientMapFromDoc(dSnap.data()?.recipientUids);
        for (const uid of Object.keys(recipientMap)) {
          await removePersonalListEntry(db, uid, postId);
        }
      }
      await dRef.delete();
    }

    await bumpPostboxSignalServer(db);
    return NextResponse.json({ ok: true, deleted: postIds.length });
  } catch (e) {
    return jsonStorageError(e);
  }
}
