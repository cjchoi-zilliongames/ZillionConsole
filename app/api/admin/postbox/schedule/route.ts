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
import type { RepeatDay } from "@/lib/postbox-compute-next-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { RepeatDay };
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

function tsToIso(v: unknown): string {
  if (v instanceof Timestamp) return v.toDate().toISOString();
  if (typeof v === "string") return v;
  return new Date(0).toISOString();
}

// ── GET: 레거시 스케줄 작업 목록 조회 (gsj_*/psj_* 구 데이터용) ─────────────────

export async function GET(req: Request) {
  try {
    await requireAnyAuth(req);
    const db = getFirestoreDb();

    const [gSnap, pSnap] = await Promise.all([
      db.collection(COLLECTION_GLOBAL_MAILS)
        .where("scheduleType", "in", ["scheduled", "repeat"])
        .limit(100)
        .get(),
      db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES)
        .where("scheduleType", "in", ["scheduled", "repeat"])
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
