import { NextResponse } from "next/server";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase-firestore";
import { bumpPostboxSignalServer } from "@/lib/firestore-postbox-signal-server";
import {
  COLLECTION_GLOBAL_MAILS,
  COLLECTION_PERSONAL_MAILS,
  COLLECTION_PERSONAL_MAIL_DISPATCHES,
  type PersonalListEntry,
  type MailRewardStored,
} from "@/lib/firestore-mail-schema";
import { uploadRecipientList } from "@/lib/mail-dispatches-storage";
import {
  COLLECTION_MAIL_SCHEDULE_JOBS,
  computeNextRunAt,
  type RepeatDay,
} from "@/app/api/admin/postbox/schedule/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function GET(req: Request) {
  // Vercel Cron 인증: CRON_SECRET 환경변수 또는 x-vercel-cron 헤더
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    const vercelCronHeader = req.headers.get("x-vercel-cron");
    if (authHeader !== `Bearer ${cronSecret}` && !vercelCronHeader) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const db = getFirestoreDb();
    const now = new Date();

    // nextRunAt <= now 인 작업 조회 (status는 코드에서 필터)
    const snap = await db
      .collection(COLLECTION_MAIL_SCHEDULE_JOBS)
      .where("nextRunAt", "<=", Timestamp.fromDate(now))
      .limit(50)
      .get();

    if (snap.empty) {
      return NextResponse.json({ ok: true, dispatched: 0 });
    }

    let dispatched = 0;
    let anySignal = false;

    for (const jobDoc of snap.docs) {
      const jobRef = jobDoc.ref;

      // 트랜잭션으로 pending 상태만 클레임 (중복 실행 방지)
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(jobRef);
        if (!fresh.exists || fresh.data()?.status !== "pending") return false;
        tx.update(jobRef, { status: "processing" });
        return true;
      });

      if (!claimed) continue;

      const job = jobDoc.data();

      try {
        const sendTime = now;
        const expiresAfterMs =
          typeof job.expiresAfterMs === "number" && isFinite(job.expiresAfterMs)
            ? job.expiresAfterMs
            : 7 * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(sendTime.getTime() + expiresAfterMs);

        const title = String(job.title ?? "");
        const content = String(job.content ?? "");
        const sender = String(job.sender ?? "운영팀");
        const rewards = (Array.isArray(job.rewards) ? job.rewards : []) as MailRewardStored[];
        const localeContents = Array.isArray(job.localeContents) ? job.localeContents : [];
        const targetAudience = job.targetAudience === "specific" ? "specific" : "all";

        if (targetAudience === "all") {
          const mailId = makeGlobalMailId();
          const globalDoc: Record<string, unknown> = {
            title,
            content,
            sender,
            isActive: true,
            createdAt: Timestamp.fromDate(sendTime),
            expiresAt: Timestamp.fromDate(expiresAt),
            rewards,
          };
          if (localeContents.length > 0) globalDoc.localeContents = localeContents;
          await db.collection(COLLECTION_GLOBAL_MAILS).doc(mailId).set(globalDoc);
        } else {
          const rawMap = (job.recipientUids ?? {}) as Record<string, string>;
          const uids = Object.keys(rawMap);

          if (uids.length > 0) {
            const mailId = makePersonalMailId();
            const recipients = uids.map((uid) => ({ uid, displayName: rawMap[uid] ?? "" }));
            const recipientListPath = await uploadRecipientList(mailId, recipients);

            const dispatchDoc: Record<string, unknown> = {
              title,
              content,
              sender,
              isActive: true,
              createdAt: Timestamp.fromDate(sendTime),
              expiresAt: Timestamp.fromDate(expiresAt),
              rewards,
              recipientListPath,
              recipientCount: uids.length,
            };
            if (localeContents.length > 0) dispatchDoc.localeContents = localeContents;
            await db.collection(COLLECTION_PERSONAL_MAIL_DISPATCHES).doc(mailId).set(dispatchDoc);

            const listEntry: PersonalListEntry = {
              mailId,
              title,
              content,
              rewards,
              expiresAt: Timestamp.fromDate(expiresAt),
              sender,
              ...(localeContents.length > 0 ? { localeContents } : {}),
            };
            await writePersonalListBatch(db, uids, listEntry);
          }
        }

        // 작업 상태 업데이트
        if (job.type === "scheduled") {
          await jobRef.update({
            status: "done",
            lastRunAt: Timestamp.fromDate(sendTime),
            runCount: FieldValue.increment(1),
          });
        } else if (job.type === "repeat") {
          const nextRun = computeNextRunAt(
            job.repeatDays as RepeatDay[],
            job.repeatTime as string
          );
          await jobRef.update({
            status: "pending",
            lastRunAt: Timestamp.fromDate(sendTime),
            nextRunAt: Timestamp.fromDate(nextRun),
            runCount: FieldValue.increment(1),
          });
        }

        dispatched++;
        anySignal = true;
      } catch (jobErr) {
        console.error(`[postbox-dispatch] job ${jobDoc.id} failed:`, jobErr);
        await jobRef.update({ status: "failed" });
      }
    }

    if (anySignal) {
      await bumpPostboxSignalServer(db);
    }

    return NextResponse.json({ ok: true, dispatched });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
