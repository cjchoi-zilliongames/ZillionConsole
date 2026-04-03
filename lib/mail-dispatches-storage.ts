/**
 * 개인 우편 발송 메타·수신자 — Storage 단일 파일 (Firestore dispatch 없음)
 * 경로: mail-dispatches/personal-mails.json
 */

import { getSpecBucket } from "@/lib/firebase-admin";
import type { MailRewardStored } from "@/lib/firestore-mail-schema";

export const PERSONAL_MAILS_JSON_PATH = "mail-dispatches/personal-mails.json";

export type PersonalDispatchRecipient = { uid: string; displayName: string };

export type PersonalDispatchItem = {
  postId: string;
  title: string;
  content: string;
  sender: string;
  rewards: MailRewardStored[];
  expiresAt: string;
  createdAt: string;
  isActive: boolean;
  recipientCount: number;
  recipients: PersonalDispatchRecipient[];
};

type Envelope = { schemaVersion: 1; items: PersonalDispatchItem[] };

function isPreconditionFailed(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = "code" in e ? (e as { code: number }).code : 0;
  return code === 412;
}

function parseEnvelope(x: unknown): Envelope {
  if (!x || typeof x !== "object") return { schemaVersion: 1, items: [] };
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.items)) return { schemaVersion: 1, items: [] };
  const items: PersonalDispatchItem[] = [];
  for (const it of o.items) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const postId = typeof r.postId === "string" ? r.postId : "";
    if (!postId.startsWith("pm_")) continue;
    const recRaw = Array.isArray(r.recipients) ? r.recipients : [];
    const recipients: PersonalDispatchRecipient[] = [];
    for (const x of recRaw) {
      if (!x || typeof x !== "object") continue;
      const u = (x as { uid?: string }).uid;
      if (typeof u !== "string" || !u.trim()) continue;
      recipients.push({
        uid: u.trim(),
        displayName: String((x as { displayName?: string }).displayName ?? ""),
      });
    }
    items.push({
      postId,
      title: String(r.title ?? ""),
      content: String(r.content ?? ""),
      sender: String(r.sender ?? ""),
      rewards: Array.isArray(r.rewards) ? (r.rewards as MailRewardStored[]) : [],
      expiresAt: typeof r.expiresAt === "string" ? r.expiresAt : "",
      createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
      isActive: r.isActive !== false,
      recipientCount: typeof r.recipientCount === "number" ? r.recipientCount : recipients.length,
      recipients,
    });
  }
  return { schemaVersion: 1, items };
}

async function readRaw(): Promise<{ env: Envelope; generation: string | undefined }> {
  const file = getSpecBucket().file(PERSONAL_MAILS_JSON_PATH);
  const [exists] = await file.exists();
  if (!exists) {
    return { env: { schemaVersion: 1, items: [] }, generation: undefined };
  }
  const [metadata] = await file.getMetadata();
  const [buf] = await file.download();
  const env = parseEnvelope(JSON.parse(buf.toString("utf-8")) as unknown);
  const gen = metadata.generation != null ? String(metadata.generation) : undefined;
  return { env, generation: gen };
}

async function writeRaw(env: Envelope, ifGenerationMatch: string | undefined): Promise<void> {
  const file = getSpecBucket().file(PERSONAL_MAILS_JSON_PATH);
  const body = JSON.stringify(env, null, 2);
  const opts: {
    contentType: string;
    resumable: boolean;
    preconditionOpts?: { ifGenerationMatch: string };
  } = {
    contentType: "application/json; charset=utf-8",
    resumable: false,
  };
  if (ifGenerationMatch !== undefined) {
    opts.preconditionOpts = { ifGenerationMatch };
  }
  await file.save(body, opts);
}

const RETRY = 16;

export async function appendPersonalDispatchItem(item: PersonalDispatchItem): Promise<void> {
  for (let a = 0; a < RETRY; a++) {
    const { env, generation } = await readRaw();
    if (env.items.some((i) => i.postId === item.postId)) {
      throw new Error("DUPLICATE_POST_ID");
    }
    env.items.push(item);
    try {
      await writeRaw(env, generation);
      return;
    } catch (e) {
      if (isPreconditionFailed(e) && a < RETRY - 1) continue;
      throw e;
    }
  }
}

/** 제거된 항목(수신자 목록 포함). 없으면 null */
export async function removePersonalDispatchItem(postId: string): Promise<PersonalDispatchItem | null> {
  for (let a = 0; a < RETRY; a++) {
    const { env, generation } = await readRaw();
    const idx = env.items.findIndex((i) => i.postId === postId);
    if (idx < 0) return null;
    const [removed] = env.items.splice(idx, 1);
    if (!removed) return null;
    try {
      await writeRaw(env, generation);
      return removed;
    } catch (e) {
      if (isPreconditionFailed(e) && a < RETRY - 1) continue;
      throw e;
    }
  }
  return null;
}

export async function listPersonalDispatchItems(): Promise<PersonalDispatchItem[]> {
  const { env } = await readRaw();
  return env.items;
}

export async function getPersonalDispatchItem(postId: string): Promise<PersonalDispatchItem | null> {
  const { env } = await readRaw();
  return env.items.find((i) => i.postId === postId) ?? null;
}
