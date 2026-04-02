import { getSpecBucket } from "@/lib/firebase-admin";

import type { HistoryRecord } from "./spec-history-types";

const HISTORY_STORAGE_PATH = "__meta/history.json";
const MAX_RECORDS = 500;

export type { HistoryRecord } from "./spec-history-types";
export {
  buildUploadDetail,
  buildDeleteDetail,
  buildMoveDetail,
  buildMergeDetail,
  buildSetLiveDetail,
} from "./spec-history-builders";

function newRecordId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isValidRecord(r: unknown): r is HistoryRecord {
  return (
    r != null &&
    typeof r === "object" &&
    typeof (r as HistoryRecord).id === "string" &&
    typeof (r as HistoryRecord).timestamp === "string"
  );
}

async function readHistoryFromStorage(): Promise<HistoryRecord[]> {
  try {
    const bucket = getSpecBucket();
    const [buf] = await bucket.file(HISTORY_STORAGE_PATH).download();
    const parsed = JSON.parse(buf.toString("utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord);
  } catch {
    return [];
  }
}

export async function readHistory(): Promise<HistoryRecord[]> {
  const rows = await readHistoryFromStorage();
  rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return rows.slice(0, MAX_RECORDS);
}

export async function appendHistory(
  record: Omit<HistoryRecord, "id" | "timestamp">,
): Promise<void> {
  try {
    const bucket = getSpecBucket();
    const file = bucket.file(HISTORY_STORAGE_PATH);
    const prev = await readHistoryFromStorage();
    const next: HistoryRecord = {
      id: newRecordId(),
      timestamp: new Date().toISOString(),
      user: record.user,
      action: record.action,
      detail: record.detail,
      ...(record.files && record.files.length > 0 ? { files: record.files } : {}),
    };
    const merged = [next, ...prev];
    merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const trimmed = merged.slice(0, MAX_RECORDS);
    await file.save(JSON.stringify(trimmed, null, 2), {
      contentType: "application/json; charset=utf-8",
      resumable: false,
      metadata: { cacheControl: "no-store" },
    });
  } catch (e) {
    console.error("[spec history] append failed:", e);
  }
}
