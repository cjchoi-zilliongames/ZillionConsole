import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { bumpPostboxSignalServer } from "@/lib/firestore-postbox-signal-server";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type PostType = "Admin" | "Repeat" | "User" | "Leaderboard";

export type PostTargetAudience = "all" | "specific";

/** 직접 발송 시 수신자 — UID → 표시명(또는 빈 문자열) */
export type PostRecipientUidMap = Record<string, string>;

/** 보상 아이템 1개 */
export type RewardEntry = {
  table: string;  // 차트명 (예: "Item")
  row: string;    // 아이템 키 — CSV 첫 열 (기존 클라 호환)
  count: number;
  /** CSV 헤더 → 셀 값 (Unity 등에서 스펙 조회 없이 사용). 중복 헤더는 `이름__2`, `이름__3` … */
  rowValues?: Record<string, string>;
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

export type PostDoc = {
  postId: string;
  postType: PostType;
  title: string;
  content: string;
  sender: string;
  isActive: boolean;
  createdAt: string; // ISO
  expiresAt: string; // ISO
  rewards: RewardEntry[];
  targetAudience: PostTargetAudience;
  recipientUids: PostRecipientUidMap;
};

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

// ── GET: list posts by postType ───────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const url = new URL(req.url);
    const postType = (url.searchParams.get("postType") ?? "Admin") as PostType;

    const snapshot = await db
      .collection("posts")
      .where("postType", "==", postType)
      .limit(500)
      .get();

    const posts: PostDoc[] = snapshot.docs.map((doc) => {
      const d = doc.data();
      const audience = d.targetAudience === "specific" ? "specific" : "all";
      const recipientMap = normalizeRecipientMapFromDoc(d.recipientUids);

      // rewards: 신형(배열) 우선, 구형(단일 필드) 폴백
      let rewards: RewardEntry[] = [];
      if (Array.isArray(d.rewards)) {
        rewards = (d.rewards as unknown[])
          .map((x) => rewardEntryFromInput(x))
          .filter((r): r is RewardEntry => r != null);
      } else if (d.rewardTable) {
        rewards = [{ table: d.rewardTable as string, row: typeof d.rewardRow === "string" ? d.rewardRow : "", count: (d.rewardCount as number) ?? 1 }];
      }

      return {
        postId: doc.id,
        postType: d.postType,
        title: d.title,
        content: d.content,
        sender: d.sender ?? "",
        isActive: d.isActive ?? false,
        createdAt: (d.createdAt as Timestamp).toDate().toISOString(),
        expiresAt: (d.expiresAt as Timestamp).toDate().toISOString(),
        rewards,
        targetAudience: audience,
        recipientUids: audience === "specific" ? recipientMap : {},
      };
    });

    return NextResponse.json({ ok: true, posts });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── POST: create a post ───────────────────────────────────────────────────────

function makePostId(postType: PostType): string {
  const prefix = postType.toLowerCase();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time =
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}_${date}_${time}`;
}

const MAX_RECIPIENTS = 100;

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as {
      postType: PostType;
      title: string;
      content: string;
      sender: string;
      expiresAt: string; // ISO string
      rewards?: RewardEntry[];
      targetAudience?: "all" | "specific";
      /** UID → 표시명 (구형 클라이언트는 string[] 도 허용) */
      recipientUids?: PostRecipientUidMap | string[];
    };

    const { postType, title, content, sender, expiresAt } = body;
    if (!postType || !title || !content || !expiresAt) {
      return NextResponse.json({ ok: false, error: "필수 항목 누락" }, { status: 400 });
    }

    const targetAudience: "all" | "specific" =
      body.targetAudience === "specific" ? "specific" : "all";

    let recipientUids: PostRecipientUidMap = {};
    if (targetAudience === "specific") {
      const rawMap = normalizeRecipientMapFromDoc(body.recipientUids as unknown);
      const uids = Object.keys(rawMap);
      if (uids.length === 0) {
        return NextResponse.json(
          { ok: false, error: "직접 발송일 때 recipientUids 맵에 수신 UID를 1명 이상 넣어 주세요." },
          { status: 400 },
        );
      }
      if (uids.length > MAX_RECIPIENTS) {
        return NextResponse.json(
          { ok: false, error: `수신자는 최대 ${MAX_RECIPIENTS}명까지 지정할 수 있습니다.` },
          { status: 400 },
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
          { status: 400 },
        );
      }
      recipientUids = rawMap;
    }

    const now = new Date();
    const postId = makePostId(postType);

    const rewards: RewardEntry[] = Array.isArray(body.rewards)
      ? body.rewards.map((r) => rewardEntryFromInput(r)).filter((r): r is RewardEntry => r != null)
      : [];

    await db.collection("posts").doc(postId).set({
      postType,
      title,
      content,
      sender: sender || "운영팀",
      isActive: true,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(new Date(expiresAt)),
      rewards,
      targetAudience,
      recipientUids,
    });

    await bumpPostboxSignalServer(db);

    return NextResponse.json({ ok: true, postId });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── DELETE: set isActive=false for given postIds ──────────────────────────────

export async function DELETE(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as { postIds: string[] };
    const { postIds } = body;
    if (!Array.isArray(postIds) || postIds.length === 0) {
      return NextResponse.json({ ok: false, error: "postIds 필요" }, { status: 400 });
    }

    const batch = db.batch();
    for (const id of postIds) {
      batch.delete(db.collection("posts").doc(id));
    }
    await batch.commit();
    await bumpPostboxSignalServer(db);

    return NextResponse.json({ ok: true, deleted: postIds.length });
  } catch (e) {
    return jsonStorageError(e);
  }
}
