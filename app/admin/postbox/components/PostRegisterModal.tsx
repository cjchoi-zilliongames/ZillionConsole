"use client";

import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type FormEvent,
  type MouseEvent,
} from "react";
import type { PostType, RewardEntry } from "@/app/api/admin/postbox/posts/route";
import type { PostboxChartInfo } from "@/app/api/storage/chart-postbox-flags/route";
import { parseCsv } from "@/lib/spec/csv-parser";
import { storageAuthFetch as authFetch } from "@/lib/storage-auth-fetch";
import { signalPostboxChange } from "@/lib/firestore-postbox-signal";
import { useChartChangeSignal } from "@/app/admin/spec/hooks/useChartChangeSignal";
import { useAdminSession } from "@/app/admin/hooks/useAdminSession";
import { AdminGlobalLoadingOverlay } from "@/app/admin/components/AdminGlobalLoadingOverlay";
import { isPostboxItemChartPayload } from "@/lib/spec/postbox-item-chart";


/** 우편 목록·차트 관리와 동일 (AdminGlobalLoadingOverlay 문구) */
const ADMIN_DATA_LOADING_MESSAGE = "데이터 불러오는 중…";

// ── Types ────────────────────────────────────────────────────────────────────

type ExpiryPreset = "1" | "7" | "15" | "30" | "custom";

type Props = {
  defaultPostType: PostType;
  onClose: () => void;
  onCreated: () => void;
};

type PickedUser = { uid: string; label: string };

type PostboxChart = PostboxChartInfo;

type RewardItem = {
  id: string;
  fullPath: string;
  chartLabel: string;
  appVersion: string;
  chartName: string;
  tableName: string;
  rowKey: string;
  rowValues: Record<string, string>;
  count: number;
};

/** 구 API 응답에 appVersion/chartName 없을 때 chartLabel에서 보강 */
function normalizePostboxChart(c: {
  fullPath: string;
  chartLabel: string;
  tableName: string;
  appVersion?: string;
  chartName?: string;
}): PostboxChartInfo {
  if (c.appVersion?.trim() && c.chartName?.trim()) {
    return {
      fullPath: c.fullPath,
      chartLabel: c.chartLabel,
      appVersion: c.appVersion,
      chartName: c.chartName,
      tableName: c.tableName,
    };
  }
  const i = c.chartLabel.indexOf(" / ");
  if (i === -1) {
    return {
      fullPath: c.fullPath,
      chartLabel: c.chartLabel,
      appVersion: "—",
      chartName: c.tableName,
      tableName: c.tableName,
    };
  }
  return {
    fullPath: c.fullPath,
    chartLabel: c.chartLabel,
    appVersion: c.chartLabel.slice(0, i).trim(),
    chartName: c.chartLabel.slice(i + 3).trim(),
    tableName: c.tableName,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 16);
}

function addHours(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString().slice(0, 16);
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** CSV 헤더·행 → 컬럼명 맵. 중복 헤더는 두 번째부터 `이름__2`, `이름__3` … */
function headersRowToMap(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Map<string, number>();
  const len = Math.max(headers.length, row.length);
  for (let i = 0; i < len; i++) {
    const raw = (headers[i] ?? "").trim();
    const base = raw || `col_${i}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}__${n}`;
    out[key] = row[i] ?? "";
  }
  return out;
}


const POST_TYPE_LABELS: Record<PostType, string> = {
  Admin: "관리자 우편",
  Repeat: "반복 우편",
  User: "유저 우편",
  Leaderboard: "리더보드 보상",
};

const COMING_SOON_POST_TYPES = new Set<PostType>(["Repeat", "User", "Leaderboard"]);

function normalizeDefaultPostType(t: PostType): PostType {
  return COMING_SOON_POST_TYPES.has(t) ? "Admin" : t;
}

// ── User Picker Modal ─────────────────────────────────────────────────────────

type UserSearchResponse = { ok: boolean; users?: PickedUser[]; nextCursor?: string | null };

function UserPickerModal({
  pickedUsers,
  onAdd,
  onRemove,
  onClose,
}: {
  pickedUsers: PickedUser[];
  onAdd: (u: PickedUser) => void;
  onRemove: (uid: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");

  // 페이지네이션 (검색 없을 때)
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIdx, setPageIdx] = useState(0);
  const currentCursor = cursors[pageIdx] ?? null;

  // 목록/검색 결과
  const [users, setUsers] = useState<PickedUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSearchMode = dq.trim().length > 0;

  // 디바운스
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // 검색어 바뀌면 페이지 리셋
  useEffect(() => {
    setCursors([null]);
    setPageIdx(0);
  }, [dq]);

  // 데이터 페치 (페이지네이션 or 검색)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (dq.trim()) {
      params.set("q", dq.trim());
    } else if (currentCursor) {
      params.set("cursor", currentCursor);
    }
    authFetch(`/api/admin/postbox/user-search?${params.toString()}`)
      .then((r) => r.json() as Promise<UserSearchResponse>)
      .then((data) => {
        if (cancelled) return;
        setUsers(data.ok ? (data.users ?? []) : []);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => { if (!cancelled) setUsers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dq, currentCursor]);

  function goNext() {
    if (!nextCursor) return;
    const nc = nextCursor;
    setCursors((prev) => {
      const next = [...prev];
      if (pageIdx + 1 >= next.length) next.push(nc);
      return next;
    });
    setPageIdx((p) => p + 1);
  }

  function goPrev() {
    if (pageIdx === 0) return;
    setPageIdx((p) => p - 1);
  }

  const hasPrev = pageIdx > 0;
  const hasNext = !!nextCursor;
  const pageLabel = `${pageIdx + 1}페이지`;

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 130,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 12,
        border: "1px solid #e2e8f0",
        width: 480, height: 620,
        display: "flex", flexDirection: "column",
        boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
        overflow: "hidden",
      }}>
        {/* 헤더 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px 12px", borderBottom: "1px solid #e5e7eb", flexShrink: 0,
        }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>유저 선택</span>
          <button type="button" onClick={onClose}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b7280", fontSize: 20, lineHeight: 1, padding: 0 }}>
            ×
          </button>
        </div>

        {/* 검색 입력 */}
        <div style={{ padding: "10px 16px 8px", flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="닉네임 또는 UID 접두사로 검색"
              autoFocus
              style={{
                width: "100%", paddingLeft: 30, paddingRight: q ? 28 : 12,
                paddingTop: 7, paddingBottom: 7,
                borderRadius: 8, border: "1px solid #e5e7eb",
                background: "#f9fafb", fontSize: 13, color: "#111827",
                outline: "none", boxSizing: "border-box",
              }}
              autoComplete="off"
            />
            {q && (
              <button type="button" onClick={() => setQ("")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 15, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            )}
          </div>
        </div>

        {/* 선택된 유저 칩 */}
        {pickedUsers.length > 0 && (
          <div style={{
            padding: "4px 16px 8px", flexShrink: 0,
            borderBottom: "1px solid #f3f4f6",
            display: "flex", flexWrap: "wrap", gap: 4,
          }}>
            {pickedUsers.map((u) => (
              <span key={u.uid} style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "3px 8px 3px 10px", borderRadius: 20,
                background: "#f3f4f6", fontSize: 12, color: "#374151",
              }}>
                {u.label}
                <button type="button" onClick={() => onRemove(u.uid)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", display: "flex", alignItems: "center" }}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 목록 */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>
              불러오는 중…
            </div>
          )}
          {!loading && users.length === 0 && (
            <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#d1d5db" }}>
              {isSearchMode ? "검색 결과가 없습니다." : "유저가 없습니다."}
            </div>
          )}
          {!loading && users.map((u) => {
            const isAdded = pickedUsers.some((p) => p.uid === u.uid);
            const maxReached = false;
            return (
              <button
                key={u.uid}
                type="button"
                disabled={maxReached}
                onClick={() => isAdded ? onRemove(u.uid) : onAdd(u)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  width: "100%", textAlign: "left",
                  padding: "8px 16px",
                  border: "none", borderBottom: "1px solid #f9fafb",
                  background: isAdded ? "#f0fdf4" : "transparent",
                  cursor: maxReached ? "default" : "pointer",
                  fontSize: 13, color: maxReached ? "#d1d5db" : "#111827",
                }}
              >
                <span>
                  <span style={{ fontWeight: 500 }}>{u.label}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#9ca3af", fontFamily: "ui-monospace, monospace" }}>
                    {u.uid}
                  </span>
                </span>
                {isAdded && (
                  <span style={{ fontSize: 11, color: "#059669", fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>
                    선택됨
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 하단 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 16px", borderTop: "1px solid #e5e7eb", flexShrink: 0,
          background: "#f9fafb",
        }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            선택됨 <strong style={{ color: "#111827" }}>{pickedUsers.length}</strong>명
          </span>

          {/* 페이지네이션 (검색 모드가 아닐 때만) */}
          {!isSearchMode && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" onClick={goPrev} disabled={!hasPrev || loading}
                style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: hasPrev && !loading ? "#374151" : "#d1d5db", fontSize: 12, cursor: hasPrev && !loading ? "pointer" : "not-allowed" }}>
                이전
              </button>
              <span style={{ fontSize: 12, color: "#374151", fontWeight: 600, minWidth: 44, textAlign: "center" }}>
                {loading ? "…" : pageLabel}
              </span>
              <button type="button" onClick={goNext} disabled={!hasNext || loading}
                style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#fff", color: hasNext && !loading ? "#374151" : "#d1d5db", fontSize: 12, cursor: hasNext && !loading ? "pointer" : "not-allowed" }}>
                다음
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 20px", borderRadius: 7, border: "none",
              background: "#111827", color: "#fff",
              fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Chart Picker Modal ────────────────────────────────────────────────────────

function ChartPickerModal({
  charts,
  onSelect,
  onClose,
}: {
  charts: PostboxChart[];
  onSelect: (chart: PostboxChart) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return charts;
    return charts.filter((c) => c.chartLabel.toLowerCase().includes(needle));
  }, [charts, q]);

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 130,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: 440,
          height: 500,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* 헤더 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>차트 선택</span>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* 검색 */}
        <div style={{ padding: "12px 20px 8px", flexShrink: 0 }}>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="앱버전 / 차트명으로 검색"
            autoFocus
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, color: "#1e293b", outline: "none", boxSizing: "border-box" }}
            autoComplete="off"
          />
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>
            파일명이 item.csv 또는 item{"{n}"}.csv 인 것만 표시 ({charts.length}개)
          </div>
        </div>

        {/* 차트 목록 */}
        <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid #f1f5f9" }}>
          {charts.length === 0 && (
            <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
              조건에 맞는 item CSV가 없습니다.<br />
              <span style={{ fontSize: 11 }}>
                스펙에 올릴 때 파일명을 반드시 item.csv 또는 item{"{n}"}.csv 로 두세요. (item_1.csv 등 구형 이름은 우편 목록에 안 나옵니다)
              </span>
            </div>
          )}
          {charts.length > 0 && filtered.length === 0 && (
            <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>검색 결과가 없습니다.</div>
          )}
          {filtered.map((c) => (
            <button
              key={c.fullPath}
              type="button"
              onClick={() => onSelect(c)}
              style={{
                display: "flex",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
                padding: "11px 20px",
                border: "none",
                borderBottom: "1px solid #f8fafc",
                background: "transparent",
                cursor: "pointer",
                fontSize: 13,
                color: "#1e293b",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f0f7ff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <span style={{ fontWeight: 700, color: "#1d4ed8" }}>{c.chartLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Highlight Cell (for search match highlighting) ────────────────────────────

function HighlightCell({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "#fef08a", borderRadius: 2, padding: "0 1px" }}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Item Key Picker Modal ─────────────────────────────────────────────────────

function ItemKeyPickerModal({
  chart,
  onSelect,
  onClose,
}: {
  chart: PostboxChart;
  onSelect: (pick: { rowKey: string; rowValues: Record<string, string> }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<{
    displayIndex: number;
    rowKey: string;
    colCount: number;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      setLockedHeight(null);
      try {
        const res = await authFetch(`/api/storage/read-file?path=${encodeURIComponent(chart.fullPath)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!cancelled) setRows(parseCsv(text));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [chart.fullPath]);

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // 데이터 로드 완료 후 높이 고정
  useLayoutEffect(() => {
    if (!loading && rows.length > 0 && dialogRef.current && !lockedHeight) {
      setLockedHeight(dialogRef.current.offsetHeight);
    }
  }, [loading, rows, lockedHeight]);

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return dataRows;
    return dataRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(needle)));
  }, [dataRows, q]);

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.6)",
        zIndex: 140,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        style={{
          background: "#fff",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          width: "min(1440px, calc(92vw * 1.2), calc(100vw - 48px))",
          maxHeight: "min(calc(85vh * 1.2), calc(100vh - 48px))",
          minHeight: "min(calc(68vh * 1.2), 936px)",
          height: lockedHeight ?? undefined,
          boxShadow: "0 32px 80px rgba(0,0,0,0.32)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, background: "#fafafa" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>📋</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>아이템 키 선택</div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#0f172a", fontFamily: "ui-monospace, monospace" }}>{chart.chartLabel}</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#374151" }}
            >
              ✕ 닫기
            </button>
          </div>

          {/* 검색바 */}
          {!loading && dataRows.length > 0 && (
            <div style={{ position: "relative" }}>
              <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="검색..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
                style={{ width: "100%", padding: "8px 12px 8px 32px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box", background: "#fff", color: "#111827" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#2563eb"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
                autoComplete="off"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, lineHeight: 1, padding: 2 }}
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* 테이블 */}
        <div style={{ overflow: "auto", flex: 1, minHeight: "min(calc(48vh * 1.2), 624px)" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 336, height: "100%", gap: 12, color: "#6b7280", fontSize: 14 }}>
              {ADMIN_DATA_LOADING_MESSAGE}
            </div>
          )}
          {!loading && loadError && (
            <div style={{ padding: 40, textAlign: "center", fontSize: 13, color: "#ef4444" }}>오류: {loadError}</div>
          )}
          {!loading && !loadError && rows.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#9ca3af" }}>데이터 없음</div>
          )}
          {!loading && !loadError && filteredRows.length === 0 && rows.length > 0 && (
            <div style={{ padding: 40, color: "#9ca3af", fontSize: 14, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span><strong style={{ color: "#374151" }}>&quot;{q}&quot;</strong>에 대한 결과 없음</span>
            </div>
          )}
          {!loading && !loadError && rows.length > 0 && filteredRows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", position: "sticky", top: 0, zIndex: 2 }}>
                  <th style={{ padding: "10px 10px", textAlign: "center", fontWeight: 600, color: "#94a3b8", borderBottom: "2px solid #e2e8f0", borderRight: "1px solid #e2e8f0", whiteSpace: "nowrap", fontSize: 11, background: "#f1f5f9", userSelect: "none" }}>
                    #
                  </th>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontWeight: 700,
                        color: "#374151",
                        borderBottom: "2px solid #e2e8f0",
                        borderRight: i === headers.length - 1 ? "none" : "1px solid #e2e8f0",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        letterSpacing: "0.03em",
                        background: "#f1f5f9",
                        userSelect: "none",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, ri) => {
                  const rowKey = row[0] ?? "";
                  const rowValues = headersRowToMap(headers, row);
                  const canPick = Object.keys(rowValues).length > 0;
                  return (
                    <tr
                      key={ri}
                      style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc", cursor: canPick ? "pointer" : "default" }}
                      onClick={() => {
                        if (!canPick) return;
                        onSelect({ rowKey, rowValues });
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = "#eff6ff";
                        setHoveredRow({
                          displayIndex: ri + 1,
                          rowKey,
                          colCount: Object.keys(rowValues).length,
                        });
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = ri % 2 === 0 ? "#fff" : "#f8fafc";
                        setHoveredRow(null);
                      }}
                    >
                      <td style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", borderRight: "1px solid #f1f5f9", color: "#cbd5e1", fontSize: 11, textAlign: "center", userSelect: "none" }}>
                        {ri + 1}
                      </td>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          title={cell}
                          style={{
                            padding: "7px 14px",
                            borderBottom: "1px solid #f1f5f9",
                            borderRight: ci === headers.length - 1 ? "none" : "1px solid #f1f5f9",
                            color: ci === 0 ? "#1d4ed8" : "#1f2937",
                            fontWeight: ci === 0 ? 700 : 400,
                            whiteSpace: "nowrap",
                            fontFamily: ci === 0 ? "ui-monospace, monospace" : undefined,
                          }}
                        >
                          {q.trim() ? <HighlightCell text={cell} query={q} /> : cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        {!loading && !loadError && rows.length > 0 && (
          <div style={{ padding: "9px 20px", borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#94a3b8", flexShrink: 0, display: "flex", gap: 16, background: "#fafafa", alignItems: "center", minHeight: 38 }}>
            {hoveredRow ? (
              <>
                <span style={{ color: "#64748b" }}><strong style={{ color: "#374151" }}>{hoveredRow.displayIndex}</strong>행</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ color: "#64748b" }}>row(1열):</span>
                  <code style={{
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    fontWeight: 700,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 13,
                    padding: "1px 8px",
                    borderRadius: 5,
                    border: "1px solid #bfdbfe",
                  }}>{hoveredRow.rowKey || "(빈칸)"}</code>
                  <span style={{ color: "#64748b" }}>· 컬럼 맵 <strong style={{ color: "#374151" }}>{hoveredRow.colCount}</strong>개 필드</span>
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>클릭 시 Firestore에 컬럼명→값 맵(`rowValues`)까지 저장됩니다</span>
              </>
            ) : (
              <>
                <span>전체 <strong style={{ color: "#374151" }}>{dataRows.length}</strong>행</span>
                <span>표시 <strong style={{ color: "#2563eb" }}>{filteredRows.length}</strong>행</span>
                <span><strong style={{ color: "#374151" }}>{headers.length}</strong>열</span>
                {q && <span style={{ color: "#f59e0b" }}>🔍 &quot;{q}&quot; 검색 중</span>}
                <span style={{ marginLeft: "auto", color: "#cbd5e1", fontSize: 11 }}>행에 마우스를 올리면 전달될 값을 미리 볼 수 있습니다</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function chartPartsForDetail(r: RewardItem): { appVersion: string; chartName: string } {
  const hasBoth = r.appVersion.trim() !== "" && r.chartName.trim() !== "";
  if (hasBoth) return { appVersion: r.appVersion, chartName: r.chartName };
  const i = r.chartLabel.indexOf(" / ");
  if (i === -1) return { appVersion: "—", chartName: r.chartLabel };
  return {
    appVersion: r.chartLabel.slice(0, i).trim(),
    chartName: r.chartLabel.slice(i + 3).trim(),
  };
}

function RewardDetailModal({ reward, onClose }: { reward: RewardItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entries = Object.entries(reward.rowValues);
  const { appVersion, chartName } = chartPartsForDetail(reward);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        zIndex: 150,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-detail-title"
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "min(600px, 100%)",
          maxHeight: "min(72vh, 640px)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.28)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
          }}
        >
          <h2 id="reward-detail-title" style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
            보상 상세 내역
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            title="닫기"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 6,
              margin: -6,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#64748b",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#0f172a"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#64748b"; }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div style={{ padding: "14px 18px", overflow: "auto", flex: 1, fontSize: 13, color: "#334155", lineHeight: 1.55 }}>
          <div style={{ paddingLeft: 10 }}>
            <div style={{ display: "flex", gap: 20, marginBottom: 14, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>앱버전</div>
                <div style={{ fontWeight: 700, color: "#0f172a", wordBreak: "break-word" }}>{appVersion}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>차트명</div>
                <div style={{ fontWeight: 700, color: "#1d4ed8", wordBreak: "break-word" }}>{chartName}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>Table</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, wordBreak: "break-all", color: "#0f172a" }}>
                  {reward.tableName}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>Storage 물리 경로</div>
                <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#64748b", wordBreak: "break-all" }}>
                  {reward.fullPath}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>row (1열)</div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#0f172a",
                    fontFamily: "ui-monospace, monospace",
                    wordBreak: "break-all",
                  }}
                >
                  {reward.rowKey || "(빈칸)"}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>수량</div>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                  {reward.count}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginBottom: 6 }}>rowValues ({entries.length}열)</div>
          </div>
          <div
            style={{
              background: "#0f172a",
              color: "#e2e8f0",
              borderRadius: 10,
              padding: 12,
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            {JSON.stringify(reward.rowValues, null, 2)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function PostRegisterModal({ defaultPostType, onClose, onCreated }: Props) {
  const [postType, setPostType] = useState<PostType>(() => normalizeDefaultPostType(defaultPostType));
  const [comingSoonPtr, setComingSoonPtr] = useState<{ x: number; y: number } | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sender, setSender] = useState("운영팀");

  /** 전체 | 직접 입력( users/{uid} 기준 ) */
  const [audienceMode, setAudienceMode] = useState<"all" | "specific">("all");
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [pickedUsers, setPickedUsers] = useState<PickedUser[]>([]);

  // 만료기간
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>("7");
  const [customExpiry, setCustomExpiry] = useState(addDays(7));

  // 보상 아이템
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [postboxCharts, setPostboxCharts] = useState<PostboxChart[]>([]);
  /** 차트 후보 API 조회 중 — 스펙 화면과 동일 `AdminGlobalLoadingOverlay` */
  const [postboxChartsLoading, setPostboxChartsLoading] = useState(true);
  const [showChartPicker, setShowChartPicker] = useState(false);
  const [itemKeyPickerTarget, setItemKeyPickerTarget] = useState<PostboxChart | null>(null);
  /** 보상 행 클릭 시 상세 내역 모달 */
  const [rewardDetail, setRewardDetail] = useState<RewardItem | null>(null);

  const { bootstrapped } = useAdminSession();

  const loadPostboxCharts = useCallback(async () => {
    setPostboxChartsLoading(true);
    try {
      const res = await authFetch("/api/storage/chart-postbox-flags");
      const data = await res.json() as { ok: boolean; charts?: PostboxChart[] };
      if (data.ok && Array.isArray(data.charts)) {
        const onlyItem = data.charts.filter(isPostboxItemChartPayload);
        setPostboxCharts(onlyItem.map((c) => normalizePostboxChart(c)));
      } else {
        setPostboxCharts([]);
      }
    } catch {
      setPostboxCharts([]);
    } finally {
      setPostboxChartsLoading(false);
    }
  }, []);

  // 차트 목록 — 서버에서 인벤토리와 크로스체크된 목록. `signals/chart`로 원격 변경 동기화
  useEffect(() => {
    void loadPostboxCharts();
  }, [loadPostboxCharts]);
  useChartChangeSignal(() => {
    void loadPostboxCharts();
  }, bootstrapped);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addPickedUser(u: PickedUser) {
    setPickedUsers((prev) => {
      if (prev.some((p) => p.uid === u.uid)) return prev;
      return [...prev, u];
    });
  }

  function removePickedUser(uid: string) {
    setPickedUsers((prev) => prev.filter((p) => p.uid !== uid));
  }

  function handleChartSelected(chart: PostboxChart) {
    setShowChartPicker(false);
    setItemKeyPickerTarget(chart);
  }

  function handleItemKeySelected(pick: { rowKey: string; rowValues: Record<string, string> }) {
    if (!itemKeyPickerTarget) return;
    setRewards((prev) => [
      ...prev,
      {
        id: makeId(),
        fullPath: itemKeyPickerTarget.fullPath,
        chartLabel: itemKeyPickerTarget.chartLabel,
        appVersion: itemKeyPickerTarget.appVersion,
        chartName: itemKeyPickerTarget.chartName,
        tableName: itemKeyPickerTarget.tableName,
        rowKey: pick.rowKey,
        rowValues: pick.rowValues,
        count: 1,
      },
    ]);
    setItemKeyPickerTarget(null);
  }

  function removeReward(id: string) {
    setRewards((prev) => prev.filter((r) => r.id !== id));
  }

  function updateRewardCount(id: string, count: number) {
    setRewards((prev) => prev.map((r) => r.id === id ? { ...r, count: Math.max(1, count) } : r));
  }

  // expiresAt 계산
  function computeExpiresAt(): string {
    switch (expiryPreset) {
      case "1":    return addHours(24);
      case "7":    return addDays(7);
      case "15":   return addDays(15);
      case "30":   return addDays(30);
      case "custom": return customExpiry;
    }
  }

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (COMING_SOON_POST_TYPES.has(postType)) {
      setError("해당 우편 유형은 아직 등록할 수 없습니다.");
      return;
    }

    if (!title.trim()) { setError("제목을 입력해 주세요."); return; }
    if (!content.trim()) { setError("내용을 입력해 주세요."); return; }
    if (audienceMode === "specific" && pickedUsers.length === 0) {
      setError("직접 발송일 때 수신 유저를 목록에서 선택해 추가하세요.");
      return;
    }

    const rewardEntries: RewardEntry[] = rewards.map((r) => ({
      table: r.tableName,
      row: r.rowKey,
      count: r.count,
      ...(Object.keys(r.rowValues).length ? { rowValues: r.rowValues } : {}),
    }));

    setSubmitting(true);
    try {
      const res = await authFetch("/api/admin/postbox/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postType,
          title: title.trim(),
          content: content.trim(),
          sender: sender.trim() || "운영팀",
          expiresAt: new Date(computeExpiresAt()).toISOString(),
          rewards: rewardEntries,
          targetAudience: audienceMode === "specific" ? "specific" : "all",
          recipientUids:
            audienceMode === "specific"
              ? Object.fromEntries(pickedUsers.map((p) => [p.uid, p.label]))
              : undefined,
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "등록 실패");
      void signalPostboxChange();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }, [
    postType, title, content, sender, expiryPreset, customExpiry,
    rewards, audienceMode, pickedUsers, onCreated,
  ]);

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 110,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
      }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <AdminGlobalLoadingOverlay
        message={postboxChartsLoading ? ADMIN_DATA_LOADING_MESSAGE : null}
      />
      {comingSoonPtr ? (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: comingSoonPtr.x,
            top: comingSoonPtr.y,
            zIndex: 20000,
            pointerEvents: "none",
            fontSize: 11,
            lineHeight: 1.3,
            padding: "5px 8px",
            borderRadius: 6,
            background: "#1e293b",
            color: "#f8fafc",
            boxShadow: "0 4px 14px rgba(15,23,42,0.25)",
            whiteSpace: "nowrap",
            fontWeight: 500,
          }}
        >
          추후 개발 예정
        </div>
      ) : null}

      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px 16px",
            borderBottom: "1px solid #f1f5f9",
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>우편 등록</span>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "#64748b", fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "20px 24px 24px" }}>
          {/* 우편 유형 */}
          <FormRow label="우편 유형">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["Admin", "Repeat", "User", "Leaderboard"] as PostType[]).map((t) => {
                const soon = COMING_SOON_POST_TYPES.has(t);
                return (
                  <ToggleBtn
                    key={t}
                    active={postType === t}
                    disabled={soon}
                    onClick={() => setPostType(t)}
                    onMouseMove={
                      soon
                        ? (e: MouseEvent<HTMLButtonElement>) => {
                            setComingSoonPtr({ x: e.clientX + 12, y: e.clientY + 14 });
                          }
                        : undefined
                    }
                    onMouseLeave={soon ? () => setComingSoonPtr(null) : undefined}
                  >
                    {POST_TYPE_LABELS[t]}
                  </ToggleBtn>
                );
              })}
            </div>
          </FormRow>

          <Divider />

          {/* 만료기간 */}
          <FormRow label="만료기간" required>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: expiryPreset === "custom" ? 8 : 0 }}>
              {([["1", "하루 이내"], ["7", "7일"], ["15", "15일"], ["30", "30일"], ["custom", "직접 입력"]] as [ExpiryPreset, string][]).map(([val, label]) => (
                <ToggleBtn key={val} active={expiryPreset === val} onClick={() => setExpiryPreset(val)}>
                  {label}
                </ToggleBtn>
              ))}
            </div>
            {expiryPreset === "custom" && (
              <input
                type="datetime-local"
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.target.value)}
                style={inputStyle}
              />
            )}
          </FormRow>

          <Divider />

          {/* 제목 */}
          <FormRow label="제목" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="우편 제목을 입력하세요"
              maxLength={100}
              style={inputStyle}
            />
          </FormRow>

          {/* 내용 */}
          <FormRow label="내용" required>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="우편 내용을 입력하세요"
              rows={4}
              maxLength={500}
              style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
            />
          </FormRow>

          {/* 발송인 */}
          <FormRow label="발송인">
            <input
              type="text"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="운영팀"
              maxLength={50}
              style={inputStyle}
            />
          </FormRow>

          <Divider />

          {/* 보상 아이템 */}
          <FormRow label="보상 아이템">
            {/* 아이템 목록 (4개 초과 시 내부 스크롤) */}
            {rewards.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  maxHeight: rewards.length > 4 ? 320 : undefined,
                  overflowY: rewards.length > 4 ? "auto" : undefined,
                  marginBottom: 8,
                  padding: 2,
                }}
              >
                {rewards.map((r, idx) => (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-reward-actions]")) return;
                      setRewardDetail(r);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setRewardDetail(r);
                      }
                    }}
                    style={{
                      display: "flex",
                      gap: 14,
                      alignItems: "stretch",
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "center",
                        paddingTop: 2,
                        fontSize: 11,
                        fontWeight: 800,
                        color: "#94a3b8",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", lineHeight: 1.35, marginBottom: 8 }}>
                        {r.chartLabel}
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", letterSpacing: "-0.02em" }}>조회 키</span>
                        <code
                          style={{
                            fontSize: 12,
                            fontFamily: "ui-monospace, monospace",
                            background: "#f1f5f9",
                            color: "#0f172a",
                            padding: "3px 10px",
                            borderRadius: 6,
                            border: "1px solid #e2e8f0",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={r.rowKey || ""}
                        >
                          {r.rowKey || "—"}
                        </code>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#475569",
                            background: "#e2e8f0",
                            padding: "3px 10px",
                            borderRadius: 999,
                          }}
                        >
                          컬럼 {Object.keys(r.rowValues).length}개
                        </span>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
                        카드 영역을 클릭하면 전체 컬럼 맵을 볼 수 있습니다
                      </div>
                    </div>
                    <div
                      data-reward-actions
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                        gap: 8,
                        flexShrink: 0,
                        minWidth: 88,
                        borderLeft: "1px solid #f1f5f9",
                        paddingLeft: 14,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div>
                        <label
                          htmlFor={`reward-count-${r.id}`}
                          style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}
                        >
                          개수
                        </label>
                        <input
                          id={`reward-count-${r.id}`}
                          type="number"
                          min={1}
                          value={r.count}
                          onChange={(e) => updateRewardCount(r.id, Number(e.target.value))}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: "1px solid #e2e8f0",
                            fontSize: 13,
                            textAlign: "center",
                            fontVariantNumeric: "tabular-nums",
                            outline: "none",
                            background: "#fafafa",
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeReward(r.id)}
                        title="이 보상 제거"
                        style={{
                          marginTop: 2,
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid #fecaca",
                          background: "#fff",
                          color: "#b91c1c",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* + 추가 버튼 */}
            <button
              type="button"
              onClick={() => setShowChartPicker(true)}
              disabled={postboxChartsLoading || postboxCharts.length === 0}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 8,
                border: "1.5px dashed #cbd5e1",
                background: postboxChartsLoading || postboxCharts.length === 0 ? "#f8fafc" : "#fff",
                color: postboxChartsLoading || postboxCharts.length === 0 ? "#94a3b8" : "#374151",
                fontWeight: 600,
                fontSize: 13,
                cursor: postboxChartsLoading || postboxCharts.length === 0 ? "wait" : "pointer",
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              {postboxChartsLoading
                ? ADMIN_DATA_LOADING_MESSAGE
                : postboxCharts.length === 0
                  ? "item.csv / item{n}.csv 없음"
                  : "아이템 추가"}
            </button>
          </FormRow>

          <Divider />

          {/* 발송 대상 */}
          <FormRow label="발송 대상">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <ToggleBtn active={audienceMode === "all"} onClick={() => { setAudienceMode("all"); setPickedUsers([]); }}>
                전체
              </ToggleBtn>
              <ToggleBtn active={audienceMode === "specific"} onClick={() => { setAudienceMode("specific"); setShowUserPicker(true); }}>
                직접 입력
              </ToggleBtn>
            </div>
            {audienceMode === "all" && (
              <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
                모든 유저를 대상으로 발송
              </p>
            )}
            {audienceMode === "specific" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {pickedUsers.length > 0 ? (
                  <span
                    title={pickedUsers.map((u) => `${u.label} (${u.uid})`).join("\n")}
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#0f172a",
                      background: "#f1f5f9",
                      padding: "5px 12px",
                      borderRadius: 20,
                      cursor: "default",
                      userSelect: "none",
                    }}
                  >
                    👥 {pickedUsers.length}명 선택됨
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>아직 선택된 유저가 없습니다.</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowUserPicker(true)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: 8,
                    border: "1.5px solid #0f172a",
                    background: "#fff",
                    color: "#0f172a",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {pickedUsers.length > 0 ? "수정" : "+ 유저 선택"}
                </button>
              </div>
            )}
          </FormRow>

          {/* Error */}
          {error && (
            <div
              style={{
                margin: "12px 0 0",
                padding: "10px 14px",
                borderRadius: 8,
                background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#dc2626",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: "9px 20px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                color: "#334155",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "9px 24px",
                borderRadius: 8,
                border: "none",
                background: submitting ? "#94a3b8" : "#0f172a",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "등록 중…" : "확인"}
            </button>
          </div>
        </form>
      </div>

      {/* Modals */}
      {showUserPicker && (
        <UserPickerModal
          pickedUsers={pickedUsers}
          onAdd={addPickedUser}
          onRemove={removePickedUser}
          onClose={() => setShowUserPicker(false)}
        />
      )}
      {showChartPicker && (
        <ChartPickerModal
          charts={postboxCharts}
          onSelect={handleChartSelected}
          onClose={() => setShowChartPicker(false)}
        />
      )}
      {itemKeyPickerTarget && (
        <ItemKeyPickerModal
          chart={itemKeyPickerTarget}
          onSelect={handleItemKeySelected}
          onClose={() => setItemKeyPickerTarget(null)}
        />
      )}

      {rewardDetail && (
        <RewardDetailModal reward={rewardDetail} onClose={() => setRewardDetail(null)} />
      )}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function FormRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Divider() {
  return <hr style={{ border: "none", borderTop: "1px solid #f1f5f9", margin: "4px 0 16px" }} />;
}

function ToggleBtn({
  active,
  onClick,
  children,
  disabled,
  onMouseMove,
  onMouseLeave,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  onMouseMove?: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: () => void;
}) {
  const isActive = active && !disabled;
  return (
    <button
      type="button"
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{
        padding: "6px 14px",
        borderRadius: 8,
        border: disabled
          ? "1.5px solid #e2e8f0"
          : isActive
            ? "1.5px solid #0f172a"
            : "1.5px solid #e2e8f0",
        background: disabled ? "#f8fafc" : isActive ? "#0f172a" : "#fff",
        color: disabled ? "#cbd5e1" : isActive ? "#fff" : "#475569",
        fontWeight: isActive ? 700 : 500,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.1s",
        opacity: disabled ? 0.72 : 1,
      }}
    >
      {children}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 13,
  color: "#1e293b",
  outline: "none",
  boxSizing: "border-box",
};
