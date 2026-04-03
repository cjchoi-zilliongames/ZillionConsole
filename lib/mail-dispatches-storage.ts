/**
 * 개인 우편 수신자 목록 — 발송 1건당 Storage 객체 1개 (Firestore 문서 1MiB 회피)
 * 경로: mail-dispatches/{mailId}/recipients.json
 */

import { getSpecBucket } from "@/lib/firebase-admin";

export type MailRecipientRecord = { uid: string; displayName: string };

const PREFIX = "mail-dispatches";

export function recipientListPathForMailId(mailId: string): string {
  return `${PREFIX}/${mailId}/recipients.json`;
}

export async function uploadRecipientList(
  mailId: string,
  recipients: MailRecipientRecord[]
): Promise<string> {
  const path = recipientListPathForMailId(mailId);
  const file = getSpecBucket().file(path);
  await file.save(JSON.stringify(recipients), {
    contentType: "application/json; charset=utf-8",
    resumable: false,
  });
  return path;
}

export async function downloadRecipientList(path: string): Promise<MailRecipientRecord[]> {
  const [content] = await getSpecBucket().file(path).download();
  return JSON.parse(content.toString("utf-8")) as MailRecipientRecord[];
}

export async function deleteRecipientList(path: string): Promise<void> {
  await getSpecBucket().file(path).delete({ ignoreNotFound: true });
}
