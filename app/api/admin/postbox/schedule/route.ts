import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";
import type { MailLocaleEntry } from "@/lib/firestore-mail-schema";
import type { RewardEntry, PostTargetAudience, PostRecipientUidMap } from "@/app/api/admin/postbox/posts/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const COLLECTION_MAIL_SCHEDULE_JOBS = "mail_schedule_jobs";

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

  // Fallback: find next occurrence of first repeat day next week
  const firstDay = repeatDays[0]!;
  const targetDayIdx = dayNames.indexOf(firstDay);
  const nowDay = now.getUTCDay();
  const daysUntil = ((targetDayIdx - nowDay + 7) % 7) || 7;
  const candidate = new Date(now);
  candidate.setUTCDate(now.getUTCDate() + daysUntil);
  candidate.setUTCHours(hours, minutes, 0, 0);
  return candidate;
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

    const jobId = `msj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const jobDoc: Record<string, unknown> = {
      type: dispatchType,
      status: "pending",
      postType: body.postType ?? "Admin",
      title: title.trim(),
      content,
      localeContents: Array.isArray(body.localeContents) ? body.localeContents : [],
      sender: body.sender || "운영팀",
      expiresAfterMs: typeof expiresAfterMs === "number" && isFinite(expiresAfterMs)
        ? expiresAfterMs
        : 7 * 24 * 60 * 60 * 1000,
      rewards: Array.isArray(body.rewards) ? body.rewards : [],
      targetAudience: body.targetAudience === "specific" ? "specific" : "all",
      createdAt: Timestamp.fromDate(now),
      nextRunAt: Timestamp.fromDate(nextRunAt),
      runCount: 0,
    };

    if (dispatchType === "scheduled" && body.scheduledAt) {
      jobDoc.scheduledAt = Timestamp.fromDate(new Date(body.scheduledAt));
    }
    if (dispatchType === "repeat") {
      jobDoc.repeatDays = body.repeatDays;
      jobDoc.repeatTime = body.repeatTime;
    }
    if (body.targetAudience === "specific" && body.recipientUids) {
      jobDoc.recipientUids = body.recipientUids;
    }

    await db.collection(COLLECTION_MAIL_SCHEDULE_JOBS).doc(jobId).set(jobDoc);

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

    const snap = await db
      .collection(COLLECTION_MAIL_SCHEDULE_JOBS)
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const tsToIso = (v: unknown): string => {
      if (v instanceof Timestamp) return v.toDate().toISOString();
      if (typeof v === "string") return v;
      return new Date(0).toISOString();
    };

    const jobs = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        jobId: doc.id,
        type: d.type,
        status: d.status,
        scheduledAt: d.scheduledAt ? tsToIso(d.scheduledAt) : undefined,
        repeatDays: d.repeatDays,
        repeatTime: d.repeatTime,
        nextRunAt: d.nextRunAt ? tsToIso(d.nextRunAt) : undefined,
        title: d.title,
        sender: d.sender,
        targetAudience: d.targetAudience,
        recipientUids: d.recipientUids,
        expiresAfterMs: typeof d.expiresAfterMs === "number" ? d.expiresAfterMs : 7 * 24 * 60 * 60 * 1000,
        runCount: d.runCount ?? 0,
        createdAt: tsToIso(d.createdAt),
        lastRunAt: d.lastRunAt ? tsToIso(d.lastRunAt) : undefined,
      } satisfies Partial<MailScheduleJob> & { jobId: string };
    });

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

    const ref = db.collection(COLLECTION_MAIL_SCHEDULE_JOBS).doc(body.jobId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "작업을 찾을 수 없습니다." }, { status: 404 });
    }

    await ref.update({ status: "cancelled" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonStorageError(e);
  }
}
