import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { type DocumentData, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { bumpNoticeSignalServer } from "@/lib/firestore-notice-signal-server";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import { assignGlobalFirstFallback } from "@/lib/admin-region-order";
import { REGION_GLOBAL, normalizeRegionCode, isValidRegionCode } from "@/lib/region-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type NoticeIsPublic = "y" | "n";

export type NoticePostSchedule = "immediate" | "scheduled";

/** 국가·지역별 블록 (버튼·URL 필드 없음) */
export type NoticeRegionEntry = {
  regionCode: string;
  title: string;
  content: string;
  imageKey: string;
  /** 지역별 작성자. 없으면 전역 author 폴백 */
  author?: string;
  fallback: boolean;
};

export type NoticeDoc = {
  uuid: string;
  inDate: string;
  postingDate: string;
  /** 게시 시각 (ISO) */
  postingAt: string;
  postSchedule: NoticePostSchedule;
  isPublic: NoticeIsPublic;
  noticeTitle: string;
  author: string;
  regionContents: NoticeRegionEntry[];
};

const MAX_NOTICE_TITLE = 200;
const MAX_AUTHOR = 80;
const MAX_CONTENT_TITLE = 200;
const MAX_CONTENT_BODY = 4000;
const MAX_IMAGE_KEY = 500;
const MAX_REGIONS = 10;

function normalizeIsPublic(v: unknown): NoticeIsPublic {
  return v === "n" ? "n" : "y";
}

function regionFromUnknown(raw: unknown): NoticeRegionEntry | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const regionCode =
    typeof o.regionCode === "string" && o.regionCode.trim()
      ? normalizeRegionCode(o.regionCode)
      : typeof o.language === "string" && o.language.trim()
        ? normalizeRegionCode(o.language).slice(0, 16)
        : "";
  if (!regionCode) return null;
  return {
    regionCode,
    title: typeof o.title === "string" ? o.title : "",
    content: typeof o.content === "string" ? o.content : "",
    imageKey: typeof o.imageKey === "string" ? o.imageKey.slice(0, MAX_IMAGE_KEY) : "",
    author: typeof o.author === "string" ? o.author : "",
    fallback: o.fallback === true,
  };
}

function normalizeRegionContentsFromDoc(d: DocumentData): NoticeRegionEntry[] {
  const arr = Array.isArray(d.regionContents)
    ? d.regionContents
    : Array.isArray(d.contents)
      ? d.contents
      : null;
  if (arr) {
    return (arr as unknown[])
      .map((x) => regionFromUnknown(x))
      .filter((x): x is NoticeRegionEntry => x != null);
  }
  const c = d.content;
  if (c != null && typeof c === "object" && !Array.isArray(c)) {
    const o = c as Record<string, unknown>;
    const one = regionFromUnknown({
      regionCode: o.regionCode ?? o.language ?? REGION_GLOBAL,
      title: o.title,
      content: o.content,
      imageKey: o.imageKey ?? "",
      author: o.author,
      fallback: true,
    });
    return one ? [one] : [];
  }
  return [];
}

function ymdFromDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** postingDate: YYYY-MM-DD */
function isValidPostingDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00.000Z`);
  return Number.isFinite(t);
}

function docToNotice(docId: string, d: DocumentData): NoticeDoc {
  const inDateTs = d.inDate as Timestamp | undefined;
  const inDate =
    inDateTs && typeof inDateTs.toDate === "function"
      ? inDateTs.toDate().toISOString()
      : new Date().toISOString();

  const postingAtTs = d.postingAt as Timestamp | undefined;
  let postingAt: string;
  if (postingAtTs && typeof postingAtTs.toDate === "function") {
    postingAt = postingAtTs.toDate().toISOString();
  } else if (typeof d.postingDate === "string" && isValidPostingDate(d.postingDate)) {
    postingAt = new Date(`${d.postingDate}T12:00:00`).toISOString();
  } else {
    postingAt = inDate;
  }

  const postingDate =
    typeof d.postingDate === "string" && isValidPostingDate(d.postingDate)
      ? d.postingDate
      : ymdFromDate(new Date(postingAt));

  const postSchedule: NoticePostSchedule =
    d.postSchedule === "scheduled" ? "scheduled" : "immediate";

  const rawContents = normalizeRegionContentsFromDoc(d);
  return {
    uuid: docId,
    inDate,
    postingDate,
    postingAt,
    postSchedule,
    isPublic: normalizeIsPublic(d.isPublic),
    noticeTitle: typeof d.noticeTitle === "string" ? d.noticeTitle : "",
    author: typeof d.author === "string" ? d.author : "",
    regionContents: rawContents.length ? assignGlobalFirstFallback(rawContents) : [],
  };
}

type ParsedNoticeWrite = {
  noticeTitle: string;
  author: string;
  postSchedule: NoticePostSchedule;
  postingDate: string;
  postingAtDate: Date;
  isPublic: NoticeIsPublic;
  regionContentsForStore: Array<{
    regionCode: string;
    title: string;
    content: string;
    imageKey: string;
    author: string;
    fallback: boolean;
  }>;
};

/** POST / PATCH 공통 본문 검증 */
function parseNoticeWritePayload(body: unknown): { ok: false; error: string } | { ok: true; data: ParsedNoticeWrite } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "잘못된 요청입니다." };
  }
  const b = body as Record<string, unknown>;

  const noticeTitle = typeof b.noticeTitle === "string" ? b.noticeTitle.trim() : "";
  if (!noticeTitle) {
    return { ok: false, error: "공지 이름을 입력해 주세요." };
  }
  if (noticeTitle.length > MAX_NOTICE_TITLE) {
    return { ok: false, error: "공지 이름이 너무 깁니다." };
  }

  const authorRaw = typeof b.author === "string" ? b.author.trim() : "";
  const author =
    authorRaw.length > MAX_AUTHOR ? authorRaw.slice(0, MAX_AUTHOR) : authorRaw || "운영자";
  // FB locale의 author가 있으면 전역 author 덮어쓰기 (하위 호환)
  // → contentsForStore 이후 fbAuthor로 재결정

  const postSchedule: NoticePostSchedule =
    b.postSchedule === "scheduled" ? "scheduled" : "immediate";

  const postingAtRaw = typeof b.postingAt === "string" ? b.postingAt.trim() : "";
  const postingAtDate = postingAtRaw ? new Date(postingAtRaw) : new Date();
  if (!Number.isFinite(postingAtDate.getTime())) {
    return { ok: false, error: "게시 일시가 올바르지 않습니다." };
  }

  const postingDate = ymdFromDate(postingAtDate);

  const rawArr = Array.isArray(b.regionContents)
    ? b.regionContents
    : Array.isArray(b.contents)
      ? b.contents
      : null;
  if (!rawArr || rawArr.length === 0) {
    return { ok: false, error: "최소 1개 지역 블록이 필요합니다." };
  }
  if (rawArr.length > MAX_REGIONS) {
    return { ok: false, error: `지역은 최대 ${MAX_REGIONS}개까지 추가할 수 있습니다.` };
  }

  const parsed: NoticeRegionEntry[] = rawArr
    .map((x) => regionFromUnknown(x))
    .filter((x): x is NoticeRegionEntry => x != null);

  if (parsed.length !== rawArr.length) {
    return { ok: false, error: "지역 블록 형식이 올바르지 않습니다." };
  }

  const codes = new Set<string>();
  for (const row of parsed) {
    const k = normalizeRegionCode(row.regionCode);
    if (codes.has(k)) {
      return { ok: false, error: `지역 코드가 중복되었습니다: ${k}` };
    }
    codes.add(k);
    if (!isValidRegionCode(row.regionCode)) {
      return { ok: false, error: `유효하지 않은 지역 코드: ${row.regionCode}` };
    }
  }

  if (!parsed.some((r) => normalizeRegionCode(r.regionCode) === REGION_GLOBAL)) {
    return { ok: false, error: "기본(GLOBAL) 지역 블록이 필요합니다." };
  }

  for (const row of parsed) {
    if (!row.title.trim() || !row.content.trim()) {
      return { ok: false, error: `지역 "${row.regionCode}"의 제목·내용을 모두 입력해 주세요.` };
    }
    if (row.title.length > MAX_CONTENT_TITLE) {
      return { ok: false, error: "본문 제목이 너무 깁니다." };
    }
    if (row.content.length > MAX_CONTENT_BODY) {
      return { ok: false, error: `본문 내용은 지역당 최대 ${MAX_CONTENT_BODY}자입니다.` };
    }
  }

  const regionContentsForStore = assignGlobalFirstFallback(
    parsed.map((r) => ({
      regionCode: normalizeRegionCode(r.regionCode),
      title: r.title.trim(),
      content: r.content,
      imageKey: r.imageKey.trim().slice(0, MAX_IMAGE_KEY),
      author: typeof r.author === "string" ? r.author.trim().slice(0, MAX_AUTHOR) : "",
    })),
  );

  if (normalizeRegionCode(regionContentsForStore[0]!.regionCode) !== REGION_GLOBAL) {
    return { ok: false, error: "첫 번째 지역은 기본(GLOBAL)이어야 합니다." };
  }

  const fbContent = regionContentsForStore[0];
  const finalAuthor = fbContent?.author || author;

  return {
    ok: true,
    data: {
      noticeTitle,
      author: finalAuthor,
      postSchedule,
      postingDate,
      postingAtDate,
      isPublic: normalizeIsPublic(b.isPublic),
      regionContentsForStore,
    },
  };
}

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const snapshot = await db.collection("notices").orderBy("inDate", "desc").limit(500).get();

    const notices: NoticeDoc[] = snapshot.docs.map((doc) => docToNotice(doc.id, doc.data()));

    return NextResponse.json({ ok: true, notices });
  } catch (e) {
    return jsonStorageError(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json();
    const parsed = parseNoticeWritePayload(body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const { noticeTitle, author, postSchedule, postingDate, postingAtDate, isPublic, regionContentsForStore } =
      parsed.data;

    const uuid = randomUUID();
    const now = Timestamp.now();

    await db.collection("notices").doc(uuid).set({
      inDate: now,
      postingDate,
      postingAt: Timestamp.fromDate(postingAtDate),
      postSchedule,
      isPublic,
      noticeTitle,
      author,
      regionContents: regionContentsForStore,
    });

    await bumpNoticeSignalServer(db);

    return NextResponse.json({ ok: true, uuid });
  } catch (e) {
    return jsonStorageError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as { uuid?: string } & Record<string, unknown>;
    const uuid = typeof body.uuid === "string" ? body.uuid.trim() : "";
    if (!uuid) {
      return NextResponse.json({ ok: false, error: "uuid가 필요합니다." }, { status: 400 });
    }

    const parsed = parseNoticeWritePayload(body);
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
    }

    const { noticeTitle, author, postSchedule, postingDate, postingAtDate, isPublic, regionContentsForStore } =
      parsed.data;

    const ref = db.collection("notices").doc(uuid);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "공지를 찾을 수 없습니다." }, { status: 404 });
    }

    await ref.update({
      postingDate,
      postingAt: Timestamp.fromDate(postingAtDate),
      postSchedule,
      isPublic,
      noticeTitle,
      author,
      regionContents: regionContentsForStore,
      contents: FieldValue.delete(),
    });

    await bumpNoticeSignalServer(db);

    return NextResponse.json({ ok: true, uuid });
  } catch (e) {
    return jsonStorageError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as { uuids?: string[] };
    const uuids = body.uuids;
    if (!Array.isArray(uuids) || uuids.length === 0) {
      return NextResponse.json({ ok: false, error: "uuids 필요" }, { status: 400 });
    }

    const ids = uuids
      .filter((id): id is string => typeof id === "string" && !!id.trim())
      .map((id) => id.trim());
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "유효한 uuid가 없습니다." }, { status: 400 });
    }

    const batch = db.batch();
    for (const id of ids) {
      batch.delete(db.collection("notices").doc(id));
    }
    await batch.commit();

    await bumpNoticeSignalServer(db);

    return NextResponse.json({ ok: true, deleted: ids.length });
  } catch (e) {
    return jsonStorageError(e);
  }
}
