export interface HistoryRecord {
  id: string;
  timestamp: string;
  user: string;
  action: "upload" | "delete" | "move" | "merge" | "set-live";
  detail: string;
  files?: string[];
}
