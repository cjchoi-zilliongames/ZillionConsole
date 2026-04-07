import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import {
  COLLECTION_GLOBAL_MAILS,
  COLLECTION_PERSONAL_MAIL_DISPATCHES,
  type MailLocaleEntry,
} from "@/lib/firestore-mail-schema";
import type { RewardEntry, PostTargetAudience, PostRecipientUidMap } from "@/app/api/admin/postbox/posts/route";
import { uploadRecipientList } from "@/lib/mail-dispatches-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type RepeatDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type MailScheduleJobType = "scheduled" | "repeat";
export type MailScheduleJobStatus = "pending" | "processing" | "done" | "cancelled" | "failed";

export type MailScheduleJob = {
  jobId: string;
  type: MailScheduleJobType;
  status: MailScheduleJobStatus;
  scheduledAt?: string;
  repeatDays?: RepeatDay[];
  repeatTime?: string;
  nextRunAt: string;
  postType: string;
  title: string;
  content: string;
  localeContents: MailLocaleEntry[];
  sender: string;
  expiresAfterMs: number;
  rewards: RewardEntry[];
  targetAudience: PostTargetAudience;
  recipientUids?: PostRecipientUidMap;
  createdAt: string;
  lastRunAt?: string;
  runCount: number;
  /** 어느 컬렉션에 저장됐는지 */
  mailStorage: "global_mails" | "personal_mail_dispatches";
};

export function computeNextRunAt(repeatDays: RepeatDay[], repeatTime: string): Date {
  const parts = repeatTime.split(":");
  const hours = parseInt(parts[0] ?? "0", 10);
  const minutes = parseInt(parts[1] ?? "0", 10);
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setUTCDate(now.getUTCDate() + offset);
    candidate.setUTCHours(hours, minutes, 0, 0);
    if (candidate <= now) continue;
    const dayName = dayNames[candidate.getUTCDay()];
    if (repeatDays.includes(dayName as RepeatDay)) {
      return candidate;
    }
  }

  // Fallback: 다음 주 첫 번째 요일
  const firstDay = repeatDays[0]!;
  const targetDayIdx = dayNames.indexOf(firstDay);
  const nowDay = now.getUTCDay();
  const daysUntil = ((targetDayIdx - nowDay + 7) % 7) || 7;
  const candidate = new Date(now);
  candidate.setUTCDate(now.getUTCDate() + daysUntil);
  candidate.setUTCHours(hours, minutes, 0, 0);
  return candidate;
}

function makeScheduleJobId(prefix: "gsj" | "psj"): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}_${date}_${time}_${Math.random().toString(36).slice(2, 6)}`;
}

function tsToIso(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "string") return v;
  return new Date(0).toISOString();
}

// ── POST: 스케줄 작업 생성 ────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as {
      dispatchType: "scheduled" | "repeat";
      scheduledAt?: string;
      repeatDays?: RepeatDay[];
      repeatTime?: string;
      postType?: string;
      title: string;
      content: string;
      localeContents?: MailLocaleEntry[];
      sender?: string;
      expiresAfterMs: number;
      rewards?: RewardEntry[];
      targetAudience?: "all" | "specific";
      recipientUids?: PostRecipientUidMap;
    };

    const { dispatchType, title, content, expiresAfterMs } = body;

    if (!dispatchType || !["scheduled", "repeat"].includes(dispatchType)) {
      return NextResponse.json({ ok: false, error: "dispatchType 오류" }, { status: 400 });
    }
    if (!title?.trim() || !content?.trim()) {
      return NextResponse.json({ ok: false, error: "제목/내용 필수" }, { status: 400 });
    }

    const now = new Date();
    let nextRunAt: Date;

    if (dispatchType === "scheduled") {
      if (!body.scheduledAt) {
        return NextResponse.json({ ok: false, error: "scheduledAt 필수" }, { status: 400 });
      }
      nextRunAt = new Date(body.scheduledAt);
      if (isNaN(nextRunAt.getTime()) || nextRunAt <= now) {
        return NextResponse.json({ ok: false, error: "예약 시각은 현재 이후여야 합니다." }, { status: 400 });
      }
    } else {
      if (!body.repeatDays?.length || !body.repeatTime) {
        return NextResponse.json({ ok: false, error: "repeatDays/repeatTime 필수" }, { status: 400 });
      }
      nextRunAt = computeNextRunAt(body.repeatDays, body.repeatTime);
    }

    const targetAudience = body.targetAudience === "specific" ? "specific" : "all";
    const localeContents = Array.isArray(body.localeContents) ? body.localeContents : [];
    const rewards = Array.isArray(body.rewards) ? body.rewards : [];
    const sender = body.sender || "운영팀";

    // 공통 스케줄 필드
    const scheduleFields: Record<string, unknown> = {
      scheduleType: dispatchType,
      scheduleStatus: "pending",
      nextRunAt: Timestamp.fromDate(nextRunAt),
      expiresAfterMs: typeof expiresAfterMs === "number" && isFinite(expiresAfterMs)
        ? expiresAfterMs
        : 7 * 24 * 60 * 60 * 1000,
      runCount: 0,
    };
    if (dispatchType === "scheduled" && body.scheduledAt) {
      scheduleFields.scheduledAt = Timestamp.fromDate(new Date(body.scheduledAt));
    }
    if (dispatchType === "repeat") {
      scheduleFields.repeatDays = body.repeatDays;
      scheduleFields.repeatTime = body.repeatTime;
    }

    if (targetAudience === "all") {
      const jobId = makeScheduleJobId("gsj");
      const doc: Record<string, unknown> = {
        title: title.trim(),
        content,
        sender,
        isActive: false,
        createdAt: Timestamp.fromDate(now),
        // expiresAt은 발송 시점에 계산 — 임시값으로 nextRunAt 사용
        expiresAt: Timestamp.fromDate(nextRunAt),
        rewards,
        ...(localeContents.length > 0 ? { localeContents } : {}),
        ...scheduleFields,
      };
      await db.collection(COLLECTION_GLOBAL_MAILS).doc(jobId).set(doc);
      return NextResponse.json({ ok: true, jobId });
    }

    // specific
    const rawMap = body.recipientUids ?? {};
    const uids = Object.keys(rawMap);
    if (uids.length === 0) {
      return NextResponse.json({ ok: false, error: "recipientUids 필요" }, { status: 400 });
    }

    const jobId = makeScheduleJobId("psj");
    const recipients = uids.map((uid) => ({ uid, displayName: (rawMap as Record<string, string>)[uid] ?? "" }));
    const recipientListPath = await uploadRecipientList(jobId, recipients);

    const doc: Record<string, unknown> = {
      title: title.trim(),
      content,
      sender,
      isActive: false,
      createdAt: Timestamp.fromDate(now),
      expiresAt: Timestamp.fromDate(nextRunAt),
      rewards,
      recipientListPath,
      recipientCount: uids.length,
      ...(localeContents.length > 0 ? { localeContents } : {}),
      ...scheduleFields,
    };
    await db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).doc(jobId).set(doc);
    return NextResponse.json({ ok: true, jobId });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── GET: 스케줄 작업 목록 조회 ────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();

    const [gSnap, pSnap] = await Promise.all([
      db.collection(COLLECTION_GLOBAL_MAILS)
        .where("scheduleType", "in", ["scheduled", "repeat"])
        .orderBy("createdAt", "desc")
        .limit(100)
        .get(),
      db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES)
        .where("scheduleType", "in", ["scheduled", "repeat"])
        .orderBy("createdAt", "desc")
        .limit(100)
        .get(),
    ]);

    const toJob = (doc: FirebaseFirestore.QueryDocumentSnapshot, storage: "global_mails" | "personal_mail_dispatches"): MailScheduleJob => {
      const d = doc.data();
      return {
        jobId: doc.id,
        type: d.scheduleType as MailScheduleJobType,
        status: d.scheduleStatus as MailScheduleJobStatus,
        scheduledAt: d.scheduledAt ? tsToIso(d.scheduledAt) : undefined,
        repeatDays: d.repeatDays,
        repeatTime: d.repeatTime,
        nextRunAt: tsToIso(d.nextRunAt),
        postType: "Admin",
        title: String(d.title ?? ""),
        content: String(d.content ?? ""),
        localeContents: Array.isArray(d.localeContents) ? d.localeContents : [],
        sender: String(d.sender ?? ""),
        expiresAfterMs: typeof d.expiresAfterMs === "number" ? d.expiresAfterMs : 7 * 24 * 60 * 60 * 1000,
        rewards: Array.isArray(d.rewards) ? d.rewards : [],
        targetAudience: storage === "global_mails" ? "all" : "specific",
        createdAt: tsToIso(d.createdAt),
        lastRunAt: d.lastRunAt ? tsToIso(d.lastRunAt) : undefined,
        runCount: d.runCount ?? 0,
        mailStorage: storage,
      };
    };

    const jobs: MailScheduleJob[] = [
      ...gSnap.docs.map((d) => toJob(d, "global_mails")),
      ...pSnap.docs.map((d) => toJob(d, "personal_mail_dispatches")),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return NextResponse.json({ ok: true, jobs });
  } catch (e) {
    return jsonStorageError(e);
  }
}

// ── DELETE: 스케줄 작업 취소 ──────────────────────────────────────────────────

export async function DELETE(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();
    const body = await req.json() as { jobId: string };

    if (!body.jobId) {
      return NextResponse.json({ ok: false, error: "jobId 필수" }, { status: 400 });
    }

    const jobId = body.jobId;
    const collection = jobId.startsWith("gsj_")
      ? COLLECTION_GLOBAL_MAILS
      : jobId.startsWith("psj_")
        ? COLLECTION_PERSONAL_MAIL_DISPATCHES
        : null;

    if (!collection) {
      return NextResponse.json({ ok: false, error: "알 수 없는 jobId 형식" }, { status: 400 });
    }

    const ref = db.collection(collection).doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "작업을 찾을 수 없습니다." }, { status: 404 });
    }

    await ref.update({ scheduleStatus: "cancelled" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonStorageError(e);
  }
}
