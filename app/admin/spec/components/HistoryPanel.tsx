"use client";

import { useEffect, useRef, useState } from "react";

import { ADMIN_TOP_BAR_PX } from "../../components/admin-console-constants";
import { storageAuthFetch } from "@/lib/storage-auth-fetch";
import type { HistoryRecord } from "@/lib/storage/spec-history-types";

const ACTION_LABEL: Record<HistoryRecord["action"], string> = {
  upload: "업로드",
  delete: "삭제",
  move: "이동",
  merge: "병합",
  "set-live": "Live 변경",
};

const ACTION_COLOR: Record<HistoryRecord["action"], string> = {
  upload: "#2563eb",
  delete: "#dc2626",
  move: "#7c3aed",
  merge: "#059669",
  "set-live": "#d97706",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderDetail(detail: string, hasFiles: boolean, onBadgeClick: () => void) {
  // Tokenize: "외 N개" (count badge) and "X 앱버전" (version badge)
  const re = /(외 \d+개|\S+ 앱버전)/g;
  const parts: { text: string; type: "count" | "version" | "text" }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(detail)) !== null) {
    if (m.index > last) parts.push({ text: detail.slice(last, m.index), type: "text" });
    if (/^외 \d+개$/.test(m[0])) parts.push({ text: m[0], type: "count" });
    else parts.push({ text: m[0], type: "version" });
    last = m.index + m[0].length;
  }
  if (last < detail.length) parts.push({ text: detail.slice(last), type: "text" });

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === "count") {
          return hasFiles ? (
            <span
              key={i}
              onClick={onBadgeClick}
              style={{ cursor: "pointer", background: "#f3f4f6", color: "#6b7280", borderRadius: 3, padding: "0 4px", fontSize: 11, fontWeight: 500 }}
            >
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          );
        }
        if (p.type === "version") {
          return (
            <span
              key={i}
              style={{ background: "#eff6ff", color: "#2563eb", borderRadius: 4, padding: "1px 5px", fontSize: 11, fontWeight: 600 }}
            >
              {p.text}
            </span>
          );
        }
        return <span key={i}>{p.text}</span>;
      })}
    </>
  );
}

function FileListPopup({ files, onClose }: { files: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 300,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        minWidth: 200,
        maxWidth: 260,
        maxHeight: 260,
        overflowY: "auto",
        padding: "6px 0",
      }}
    >
      {files.map((f, i) => {
        const [name, version] = f.split("\t");
        return (
          <div
            key={i}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              color: "#374151",
              borderBottom: i < files.length - 1 ? "1px solid #f3f4f6" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span>{name}</span>
            {version && (
              <span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>{version}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PANEL_W = 380;

export function HistoryPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [openPopupId, setOpenPopupId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setLoaded(false);
      return;
    }
    if (!loaded) {
      setLoading(true);
      void (async () => {
        try {
          const res = await storageAuthFetch("/api/storage/history", { cache: "no-store" });
          const data = (await res.json()) as { ok?: boolean; records?: HistoryRecord[] };
          if (data.ok && Array.isArray(data.records)) setRecords(data.records);
        } catch {
          setRecords([]);
        } finally {
          setLoading(false);
          setLoaded(true);
        }
      })();
    }
  }, [isOpen, loaded]);

  return (
    <div
      style={{
        position: "fixed",
        top: ADMIN_TOP_BAR_PX,
        right: 0,
        width: isOpen ? PANEL_W : 0,
        height: `calc(100vh - ${ADMIN_TOP_BAR_PX}px)`,
        overflow: "hidden",
        transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
        background: "#fff",
        borderLeft: "1px solid #e5e7eb",
        boxShadow: isOpen ? "-4px 0 16px rgba(0,0,0,0.07)" : "none",
        display: "flex",
        flexDirection: "column",
        zIndex: 100,
      }}
    >
      {/* 패널 헤더 */}
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          minWidth: PANEL_W,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>히스토리</span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 4px",
          }}
        >
          ✕
        </button>
      </div>

      {/* 기록 목록 */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minWidth: PANEL_W }}>
        {loading ? (
          <div style={{ padding: "32px 16px", color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
            불러오는 중...
          </div>
        ) : records.length === 0 ? (
          <div style={{ padding: "32px 16px", color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
            기록이 없습니다
          </div>
        ) : (
          records.map((r) => (
            <div
              key={r.id}
              style={{ padding: "10px 14px", borderBottom: "1px solid #f3f4f6" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: ACTION_COLOR[r.action],
                    background: `${ACTION_COLOR[r.action]}18`,
                    borderRadius: 4,
                    padding: "2px 5px",
                    flexShrink: 0,
                  }}
                >
                  {ACTION_LABEL[r.action]}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "#6b7280",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.user}
                </span>
              </div>
              <div style={{ position: "relative" }}>
                <div style={{ fontSize: 12, color: "#111827", lineHeight: 1.6 }}>
                  {renderDetail(
                    r.detail,
                    !!(r.files && r.files.length > 0),
                    () => setOpenPopupId(openPopupId === r.id ? null : r.id)
                  )}
                </div>
                {openPopupId === r.id && r.files && r.files.length > 0 && (
                  <FileListPopup files={r.files} onClose={() => setOpenPopupId(null)} />
                )}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                {formatTimestamp(r.timestamp)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
