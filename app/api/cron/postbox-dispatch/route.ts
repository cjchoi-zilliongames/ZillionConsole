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
import { downloadRecipientList, uploadRecipientList } from "@/lib/mail-dispatches-storage";
import { computeNextRunAt, type RepeatDay } from "@/app/api/admin/postbox/schedule/route";

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

async function dispatchJobs(
  db: Firestore,
  collection: typeof COLLECTION_GLOBAL_MAILS | typeof COLLECTION_PERSONAL_MAIL_DISPATCHES,
  now: Date
): Promise<{ dispatched: number; anySignal: boolean }> {
  const isGlobal = collection === COLLECTION_GLOBAL_MAILS;

  const snap = await db
    .collection(collection)
    .where("scheduleStatus", "==", "pending")
    .limit(200)
    .get();

  const dueDocs = snap.docs.filter((doc) => {
    const d = doc.data();
    if (!d.scheduleType || !d.nextRunAt) return false;
    const runAt = d.nextRunAt instanceof Timestamp ? d.nextRunAt.toDate() : new Date(d.nextRunAt);
    return runAt <= now;
  });

  if (dueDocs.length === 0) return { dispatched: 0, anySignal: false };

  let dispatched = 0;
  let anySignal = false;

  for (const jobDoc of dueDocs) {
    const jobRef = jobDoc.ref;

    // 트랜잭션으로 중복 실행 방지
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(jobRef);
      if (!fresh.exists || fresh.data()?.scheduleStatus !== "pending") return false;
      tx.update(jobRef, { scheduleStatus: "processing" });
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

      if (isGlobal) {
        // scheduled: isActive true로 전환 / repeat: 새 gm_* 생성
        if (job.scheduleType === "scheduled") {
          await jobRef.update({
            isActive: true,
            expiresAt: Timestamp.fromDate(expiresAt),
            scheduleStatus: "done",
            lastRunAt: Timestamp.fromDate(sendTime),
            runCount: FieldValue.increment(1),
          });
        } else {
          // repeat — 새 전체 우편 생성
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

          const nextRun = computeNextRunAt(job.repeatDays as RepeatDay[], job.repeatTime as string);
          await jobRef.update({
            scheduleStatus: "pending",
            lastRunAt: Timestamp.fromDate(sendTime),
            nextRunAt: Timestamp.fromDate(nextRun),
            runCount: FieldValue.increment(1),
          });
        }
      } else {
        // personal — recipientListPath에서 수신자 읽어서 발송
        const recipientListPath = typeof job.recipientListPath === "string" ? job.recipientListPath : "";
        const recipients = recipientListPath ? await downloadRecipientList(recipientListPath) : [];
        const uids = recipients.map((r) => r.uid);

        if (uids.length > 0) {
          if (job.scheduleType === "scheduled") {
            // scheduled: isActive true + personal_list 배치 쓰기
            await jobRef.update({
              isActive: true,
              expiresAt: Timestamp.fromDate(expiresAt),
              scheduleStatus: "done",
              lastRunAt: Timestamp.fromDate(sendTime),
              runCount: FieldValue.increment(1),
            });
            const listEntry: PersonalListEntry = {
              mailId: jobDoc.id,
              title,
              content,
              rewards,
              expiresAt: Timestamp.fromDate(expiresAt),
              sender,
              ...(localeContents.length > 0 ? { localeContents } : {}),
            };
            await writePersonalListBatch(db, uids, listEntry);
          } else {
            // repeat — 새 pm_* 생성
            const mailId = makePersonalMailId();
            const newRecipientListPath = await uploadRecipientList(mailId, recipients);
            const dispatchDoc: Record<string, unknown> = {
              title,
              content,
              sender,
              isActive: true,
              createdAt: Timestamp.fromDate(sendTime),
              expiresAt: Timestamp.fromDate(expiresAt),
              rewards,
              recipientListPath: newRecipientListPath,
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

            const nextRun = computeNextRunAt(job.repeatDays as RepeatDay[], job.repeatTime as string);
            await jobRef.update({
              scheduleStatus: "pending",
              lastRunAt: Timestamp.fromDate(sendTime),
              nextRunAt: Timestamp.fromDate(nextRun),
              runCount: FieldValue.increment(1),
            });
          }
        }
      }

      dispatched++;
      anySignal = true;
    } catch (jobErr) {
      console.error(`[postbox-dispatch] job ${jobDoc.id} failed:`, jobErr);
      await jobRef.update({ scheduleStatus: "failed" });
    }
  }

  return { dispatched, anySignal };
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const db = getFirestoreDb();
    const now = new Date();

    const [globalResult, personalResult] = await Promise.all([
      dispatchJobs(db, COLLECTION_GLOBAL_MAILS, now),
      dispatchJobs(db, COLLECTION_PERSONAL_MAIL_DISPATCHES, now),
    ]);

    const dispatched = globalResult.dispatched + personalResult.dispatched;
    const anySignal = globalResult.anySignal || personalResult.anySignal;

    if (anySignal) {
      await bumpPostboxSignalServer(db);
    }

    return NextResponse.json({ ok: true, dispatched });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
