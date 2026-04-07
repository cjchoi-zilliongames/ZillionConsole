import { NextResponse } from "next/server";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { Timestamp, FieldValue, FieldPath } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { bumpPostboxSignalServer } from "@/lib/firestore-postbox-signal-server";
import {
  deleteRecipientList,
  downloadRecipientList,
  uploadRecipientList,
} from "@/lib/mail-dispatches-storage";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import {
  COLLECTION_GLOBAL_MAILS,
  COLLECTION_PERSONAL_MAILS,
  COLLECTION_PERSONAL_MAIL_DISPATCHES,
  type MailLocaleEntry,
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
  /** Storage 수신자 파일(pm_*): 비움. 레거시 dispatch(문서 내 recipientUids): uid→표시명 */
  recipientUids: PostRecipientUidMap;
  recipientCount: number;
  /** mail-dispatches/{mailId}/recipients.json — 없으면 빈 문자열 */
  recipientListPath: string;
  mailStorage: MailStorageKind;
  /** 다국어 제목/내용 (없으면 단일 언어) */
  localeContents: MailLocaleEntry[];
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

function localeContentsFromDoc(raw: unknown): MailLocaleEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    if (typeof o.language !== "string") return [];
    return [{
      language: o.language,
      title: typeof o.title === "string" ? o.title : "",
      content: typeof o.content === "string" ? o.content : "",
      fallback: o.fallback === true,
    }];
  });
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
    recipientCount: 0,
    recipientListPath: "",
    mailStorage: "global_mails",
    localeContents: localeContentsFromDoc(d.localeContents),
  };
}

function docToPostDocDispatch(id: string, d: DocumentData): PostDoc {
  if (typeof d.recipientListPath === "string" && d.recipientListPath) {
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
      recipientUids: {},
      recipientCount: typeof d.recipientCount === "number" ? d.recipientCount : 0,
      recipientListPath: d.recipientListPath,
      mailStorage: "personal_mail_dispatches",
      localeContents: localeContentsFromDoc(d.localeContents),
    };
  }
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
    recipientCount: Object.keys(recipientMap).length,
    recipientListPath: "",
    mailStorage: "personal_mail_dispatches",
    localeContents: localeContentsFromDoc(d.localeContents),
  };
}

// ── GET: global_mails + personal_mail_dispatches 병합 페이지네이션 ────────────

type StreamCursor = { id: string; ms: number };

type PostsListCursorPayload = {
  v: 1;
  gQ: string[];
  pQ: string[];
  gTail: StreamCursor | null;
  pTail: StreamCursor | null;
  gDone: boolean;
  pDone: boolean;
};

function encodePostsCursor(p: PostsListCursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}

function decodePostsCursor(s: string): PostsListCursorPayload | null {
  try {
    const j = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    if (!j || typeof j !== "object") return null;
    const o = j as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (!Array.isArray(o.gQ) || !Array.isArray(o.pQ)) return null;
    const parseTail = (x: unknown): StreamCursor | null => {
      if (!x || typeof x !== "object") return null;
      const t = x as { id?: string; ms?: number };
      if (typeof t.id !== "string" || typeof t.ms !== "number") return null;
      return { id: t.id, ms: t.ms };
    };
    return {
      v: 1,
      gQ: o.gQ.filter((x): x is string => typeof x === "string"),
      pQ: o.pQ.filter((x): x is string => typeof x === "string"),
      gTail: parseTail(o.gTail),
      pTail: parseTail(o.pTail),
      gDone: o.gDone === true,
      pDone: o.pDone === true,
    };
  } catch {
    return null;
  }
}

function docCreatedMs(d: DocumentData): number {
  const c = d.createdAt;
  return c instanceof Timestamp ? c.toMillis() : 0;
}

async function hydrateDocMap(
  db: Firestore,
  collectionName: string,
  ids: string[]
): Promise<Map<string, DocumentData>> {
  const m = new Map<string, DocumentData>();
  const CH = 100;
  for (let i = 0; i < ids.length; i += CH) {
    const chunk = ids.slice(i, i + CH);
    const refs = chunk.map((id) => db.collection(collectionName).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (s.exists) m.set(s.id, s.data()!);
    }
  }
  return m;
}

const MERGE_CHUNK = 35;
const MERGE_MIN_QUEUE = 12;

type MergeWorkState = {
  gQ: string[];
  pQ: string[];
  gTail: StreamCursor | null;
  pTail: StreamCursor | null;
  gDone: boolean;
  pDone: boolean;
};

async function refillGlobalQueue(
  db: Firestore,
  st: MergeWorkState,
  gMap: Map<string, DocumentData>
): Promise<void> {
  let q = db
    .collection(COLLECTION_GLOBAL_MAILS)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(MERGE_CHUNK);
  if (st.gTail) {
    q = q.startAfter(Timestamp.fromMillis(st.gTail.ms), st.gTail.id) as typeof q;
  }
  const snap = await q.get();
  if (snap.empty) {
    st.gDone = true;
    return;
  }
  for (const doc of snap.docs) {
    if (!doc.id.startsWith("gsj_")) {
      st.gQ.push(doc.id);
      gMap.set(doc.id, doc.data());
    }
  }
  const last = snap.docs[snap.docs.length - 1]!;
  st.gTail = { id: last.id, ms: docCreatedMs(last.data()) };
}

async function refillPersonalQueue(
  db: Firestore,
  st: MergeWorkState,
  pMap: Map<string, DocumentData>
): Promise<void> {
  let q = db
    .collection(COLLECTION_PERSONAL_MAIL_DISPATCHES)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    .limit(MERGE_CHUNK);
  if (st.pTail) {
    q = q.startAfter(Timestamp.fromMillis(st.pTail.ms), st.pTail.id) as typeof q;
  }
  const snap = await q.get();
  if (snap.empty) {
    st.pDone = true;
    return;
  }
  for (const doc of snap.docs) {
    if (!doc.id.startsWith("psj_")) {
      st.pQ.push(doc.id);
      pMap.set(doc.id, doc.data());
    }
  }
  const last = snap.docs[snap.docs.length - 1]!;
  st.pTail = { id: last.id, ms: docCreatedMs(last.data()) };
}

function pickGlobalFirst(
  gid: string,
  pid: string,
  gMap: Map<string, DocumentData>,
  pMap: Map<string, DocumentData>
): boolean {
  const tg = docCreatedMs(gMap.get(gid)!);
  const tp = docCreatedMs(pMap.get(pid)!);
  if (tg !== tp) return tg > tp;
  return gid.localeCompare(pid) >= 0;
}

async function fetchMergedAdminPosts(
  db: Firestore,
  pageSize: number,
  cursorRaw: string | null
): Promise<{ posts: PostDoc[]; nextCursor: string | null; hasMore: boolean }> {
  let st: MergeWorkState;
  if (cursorRaw) {
    const decoded = decodePostsCursor(cursorRaw);
    if (!decoded) {
      st = {
        gQ: [],
        pQ: [],
        gTail: null,
        pTail: null,
        gDone: false,
        pDone: false,
      };
    } else {
      st = {
        gQ: [...decoded.gQ],
        pQ: [...decoded.pQ],
        gTail: decoded.gTail,
        pTail: decoded.pTail,
        gDone: decoded.gDone,
        pDone: decoded.pDone,
      };
    }
  } else {
    st = {
      gQ: [],
      pQ: [],
      gTail: null,
      pTail: null,
      gDone: false,
      pDone: false,
    };
  }

  const gMap = await hydrateDocMap(db, COLLECTION_GLOBAL_MAILS, st.gQ);
  const pMap = await hydrateDocMap(db, COLLECTION_PERSONAL_MAIL_DISPATCHES, st.pQ);

  const out: PostDoc[] = [];

  while (out.length < pageSize) {
    if (st.gQ.length < MERGE_MIN_QUEUE && !st.gDone) {
      await refillGlobalQueue(db, st, gMap);
    }
    if (st.pQ.length < MERGE_MIN_QUEUE && !st.pDone) {
      await refillPersonalQueue(db, st, pMap);
    }

    const gh = st.gQ[0];
    const ph = st.pQ[0];
    if (gh === undefined && ph === undefined) break;

    if (ph === undefined || (gh !== undefined && pickGlobalFirst(gh, ph, gMap, pMap))) {
      const id = st.gQ.shift()!;
      const data = gMap.get(id);
      if (!data) break;
      gMap.delete(id);
      out.push(docToPostDocGlobal(id, data));
    } else {
      const id = st.pQ.shift()!;
      const data = pMap.get(id);
      if (!data) break;
      pMap.delete(id);
      out.push(docToPostDocDispatch(id, data));
    }
  }

  const hasMore =
    out.length === pageSize && (!st.gDone || st.gQ.length > 0 || !st.pDone || st.pQ.length > 0);

  const payload: PostsListCursorPayload = {
    v: 1,
    gQ: st.gQ,
    pQ: st.pQ,
    gTail: st.gTail,
    pTail: st.pTail,
    gDone: st.gDone,
    pDone: st.pDone,
  };

  return {
    posts: out,
    nextCursor: hasMore ? encodePostsCursor(payload) : null,
    hasMore,
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
      return NextResponse.json({ ok: true, posts: [] as PostDoc[], nextCursor: null, hasMore: false });
    }

    const limitRaw = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const pageSize = Number.isFinite(limitRaw)
      ? Math.min(100, Math.max(10, limitRaw))
      : 50;
    const cursorParam = (url.searchParams.get("cursor") ?? "").trim() || null;

    const { posts, nextCursor, hasMore } = await fetchMergedAdminPosts(db, pageSize, cursorParam);

    return NextResponse.json({ ok: true, posts, nextCursor, hasMore });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

type RecipientEntry = { uid: string; displayName: string };

/** personal_list에 항목 추가 — FieldValue.arrayUnion으로 500건씩 batch */
async function writePersonalListBatch(
  db: Firestore,
  uids: string[],
  entry: PersonalListEntry
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < uids.length; i += BATCH_SIZE) {
    const chunk = uids.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const uid of chunk) {
      batch.set(
        db.collection(COLLECTION_PERSONAL_MAILS).doc(uid),
        { personal_list: FieldValue.arrayUnion(entry) },
        { merge: true }
      );
    }
    await batch.commit();
  }
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
      localeContents?: MailLocaleEntry[];
    };

    const { postType, title, content, sender, expiresAt } = body;
    if (!postType || !title || !content || !expiresAt) {
      return NextResponse.json({ ok: false, error: "필수 항목 누락" }, { status: 400 });
    }

    // localeContents 정규화: 유효한 항목만, fallback 정확히 1개
    const rawLocale = Array.isArray(body.localeContents) ? body.localeContents : [];
    const localeContents: MailLocaleEntry[] = rawLocale
      .filter((e) => e && typeof e.language === "string" && e.language.trim())
      .map((e) => ({
        language: e.language.trim(),
        title: String(e.title ?? "").trim(),
        content: String(e.content ?? ""),
        fallback: e.fallback === true,
      }));
    // fallback이 없으면 첫 번째를 fallback으로
    if (localeContents.length > 0 && !localeContents.some((e) => e.fallback)) {
      localeContents[0]!.fallback = true;
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
      const globalDoc: Record<string, unknown> = {
        title,
        content,
        sender: senderStr,
        isActive: true,
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresDate),
        rewards: storedRewards,
      };
      if (localeContents.length > 0) globalDoc.localeContents = localeContents;
      await db.collection(COLLECTION_GLOBAL_MAILS).doc(mailId).set(globalDoc);
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

    const mailId = makePersonalMailId();

    const recipients: RecipientEntry[] = uids.map((uid) => ({
      uid,
      displayName: rawMap[uid] ?? "",
    }));

    const recipientListPath = await uploadRecipientList(mailId, recipients);

    const dispatchDoc: Record<string, unknown> = {
      title,
      content,
      sender: senderStr,
      isActive: true,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(expiresDate),
      rewards: storedRewards,
      recipientListPath,
      recipientCount: uids.length,
    };
    if (localeContents.length > 0) dispatchDoc.localeContents = localeContents;
    await db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).doc(mailId).set(dispatchDoc);

    // 유저별 personal_list에 500건씩 batch 추가
    const listEntry: PersonalListEntry = {
      mailId,
      title,
      content,
      rewards: storedRewards,
      expiresAt: Timestamp.fromDate(expiresDate),
      sender: senderStr,
      ...(localeContents.length > 0 ? { localeContents } : {}),
    };
    await writePersonalListBatch(db, uids, listEntry);

    await bumpPostboxSignalServer(db);
    return NextResponse.json({ ok: true, postId: mailId });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

/**
 * 전체 우편(gm_*) 삭제 시 personal_mails의 global_history 정리.
 * global_history는 array<object>라 array-contains 쿼리 불가 → personal_mails 전체 스캔.
 */
async function removeGlobalMailFromPersonalData(
  db: Firestore,
  globalMailId: string
): Promise<void> {
  // ── global_history 정리 (전체 스캔) ──────────────────────────────────────
  let cursor: FirebaseFirestore.DocumentSnapshot | null = null;
  const PAGE = 500;

  for (;;) {
    let q = db.collection(COLLECTION_PERSONAL_MAILS).orderBy("__name__").limit(PAGE);
    if (cursor) q = q.startAfter(cursor) as typeof q;

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let dirty = false;

    for (const doc of snap.docs) {
      const data = doc.data();
      const history = Array.isArray(data.global_history) ? data.global_history : [];
      const next = history.filter(
        (e: { globalMailId?: string }) => String(e?.globalMailId) !== globalMailId
      );
      if (next.length !== history.length) {
        batch.update(doc.ref, { global_history: next });
        dirty = true;
      }
    }

    if (dirty) await batch.commit();
    if (snap.docs.length < PAGE) break;
    cursor = snap.docs[snap.docs.length - 1];
  }
}

function mailStorageFromPostId(postId: string): MailStorageKind | null {
  if (postId.startsWith("gm_") || postId.startsWith("gsj_")) return "global_mails";
  if (postId.startsWith("pm_") || postId.startsWith("psj_")) return "personal_mail_dispatches";
  return null;
}

/** personal_list에서 mailId 항목 제거 — 500건씩 batch 읽기+쓰기 */
async function removePersonalListBatch(
  db: Firestore,
  uids: string[],
  mailId: string
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < uids.length; i += BATCH_SIZE) {
    const chunk = uids.slice(i, i + BATCH_SIZE);
    const refs = chunk.map((uid) => db.collection(COLLECTION_PERSONAL_MAILS).doc(uid));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    let dirty = false;
    for (let j = 0; j < chunk.length; j++) {
      const snap = snaps[j];
      if (!snap?.exists) continue;
      const data = snap.data()!;
      const personalList = Array.isArray(data.personal_list) ? data.personal_list : [];
      const next = personalList.filter(
        (e: { mailId?: string }) => String(e?.mailId) !== mailId
      );
      if (next.length !== personalList.length) {
        batch.update(snap.ref, { personal_list: next });
        dirty = true;
      }
    }
    if (dirty) await batch.commit();
  }
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
        await removeGlobalMailFromPersonalData(db, postId);
        continue;
      }
      const dRef = db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).doc(postId);
      const dSnap = await dRef.get();
      if (dSnap.exists) {
        const data = dSnap.data()!;
        if (typeof data.recipientListPath === "string" && data.recipientListPath) {
          const recs = await downloadRecipientList(data.recipientListPath);
          await removePersonalListBatch(
            db,
            recs.map((r) => r.uid),
            postId
          );
          await deleteRecipientList(data.recipientListPath);
        } else {
          const recipientMap = normalizeRecipientMapFromDoc(data.recipientUids);
          await removePersonalListBatch(db, Object.keys(recipientMap), postId);
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
