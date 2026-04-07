"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { NoticeDoc, NoticeLocaleEntry } from "@/app/api/admin/notices/route";
import { noticeLocaleTabLabel } from "@/lib/notice-lang-display";
import { storageAuthFetch as authFetch } from "@/lib/storage-auth-fetch";
import { useAdminSession } from "@/app/admin/hooks/useAdminSession";
import { signalNoticeChange } from "@/lib/firestore-notice-signal";
import { NoticeCreateModal } from "./components/NoticeCreateModal";
import { useNoticeChangeSignal } from "./hooks/useNoticeChangeSignal";
import { AdminGlobalLoadingOverlay } from "@/app/admin/components/AdminGlobalLoadingOverlay";
import {
  ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX,
  ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX,
  ADMIN_NOTICE_LIST_COL_DEFAULTS,
  ADMIN_NOTICE_LIST_COL_MINS,
  ADMIN_NOTICE_LIST_COL_STORAGE_KEY,
  ADMIN_LIST_SELECT_COL_SYNC_STORAGE_KEY,
  adminListColBox,
  adminListPanelFooterBarStyle,
  adminListPanelPageSizeSelectStyle,
  adminListPanelToolbarZeroWidthRhythmSpacerStyle,
  ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME,
  ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX,
  adminListTableCheckboxInputStyle,
  adminListTableTheadRowStyle,
  noticeListTableLayout as noticeTbl,
} from "@/lib/admin-list-table-layout";
import { AdminTableResizeHandle } from "@/lib/admin-table-resize-handle";
import { useResizableAdminTableColumns } from "@/lib/use-resizable-admin-table-columns";

const NOTICE_COL_RESIZE_LABELS = [
  "선택 열과 이름 열 사이 너비 조절",
  "이름 열과 게시일 열 사이 너비 조절",
  "게시일 열과 UUID 열 사이 너비 조절",
  "UUID 열과 작성자 열 사이 너비 조절",
  "작성자 열과 등록일 열 사이 너비 조절",
  "등록일 열과 공개 여부 열 사이 너비 조절",
] as const;

function noticeMatchesSearch(notice: NoticeDoc, q: string): boolean {
  if (
    notice.noticeTitle.toLowerCase().includes(q) ||
    notice.author.toLowerCase().includes(q) ||
    notice.uuid.toLowerCase().includes(q)
  ) {
    return true;
  }
  return (notice.contents ?? []).some(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.content.toLowerCase().includes(q) ||
      c.language.toLowerCase().includes(q),
  );
}

function formatPostingAtDisplay(notice: NoticeDoc): string {
  const d = new Date(notice.postingAt);
  if (!Number.isFinite(d.getTime())) {
    return notice.postingDate || "—";
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatInDateDisplay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50];

function PageBtn({ onClick, disabled, active, label }: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 32,
        height: 32,
        padding: "0 6px",
        borderRadius: 6,
        border: active ? "1px solid #0f172a" : "1px solid transparent",
        background: active ? "#0f172a" : "transparent",
        color: active ? "#fff" : disabled ? "#cbd5e1" : "#334155",
        fontWeight: active ? 700 : 500,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function PublicBadge({ isPublic }: { isPublic: NoticeDoc["isPublic"] }) {
  const pub = isPublic === "y";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: pub ? "rgba(5,150,105,0.10)" : "rgba(100,116,139,0.10)",
        color: pub ? "#059669" : "#64748b",
      }}
    >
      {pub ? "공개" : "비공개"}
    </span>
  );
}

export function NoticeClient() {
  const { bootstrapped } = useAdminSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<NoticeDoc | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editNoticeTarget, setEditNoticeTarget] = useState<NoticeDoc | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [notices, setNotices] = useState<NoticeDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const {
    widths: noticeColW,
    totalWidth: noticeTableMinW,
    startResize: startNoticeColResize,
  } = useResizableAdminTableColumns({
    storageKey: ADMIN_NOTICE_LIST_COL_STORAGE_KEY,
    defaults: ADMIN_NOTICE_LIST_COL_DEFAULTS,
    mins: ADMIN_NOTICE_LIST_COL_MINS,
    syncSelectColumnStorageKey: ADMIN_LIST_SELECT_COL_SYNC_STORAGE_KEY,
  });

  const fetchNotices = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    if (!soft) {
      setLoading(true);
      setFetchError(null);
    }
    try {
      const res = await authFetch("/api/admin/notices");
      const data = await res.json() as { ok: boolean; notices?: NoticeDoc[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "목록 로드 실패");
      const sorted = (data.notices ?? []).sort(
        (a, b) => new Date(b.inDate).getTime() - new Date(a.inDate).getTime(),
      );
      setNotices(sorted);
      if (soft) setFetchError(null);
    } catch (e) {
      if (!soft) {
        setFetchError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      }
    } finally {
      if (!soft) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;
    void fetchNotices();
  }, [fetchNotices, bootstrapped]);

  const onNoticeRemoteChange = useCallback(() => {
    void fetchNotices({ soft: true });
  }, [fetchNotices]);
  useNoticeChangeSignal(onNoticeRemoteChange, bootstrapped);

  /** 목록 갱신 시: 삭제됐으면 미리보기 닫기, 같은 uuid면 목록 기준 최신 내용으로 미리보기 동기화 */
  useEffect(() => {
    if (!detail) return;
    const fresh = notices.find((n) => n.uuid === detail.uuid);
    if (!fresh) {
      setDetail(null);
      return;
    }
    setDetail(fresh);
  }, [notices, detail?.uuid]);

  useEffect(() => {
    if (!showCreateModal || !editNoticeTarget) return;
    if (!notices.some((n) => n.uuid === editNoticeTarget.uuid)) {
      setShowCreateModal(false);
      setEditNoticeTarget(null);
    }
  }, [notices, showCreateModal, editNoticeTarget]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notices;
    return notices.filter((n) => noticeMatchesSearch(n, q));
  }, [notices, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const pageWindow = useMemo(() => {
    const maxBtn = 7;
    const half = Math.floor(maxBtn / 2);
    let start = Math.max(1, page - half);
    const end = Math.min(totalPages, start + maxBtn - 1);
    if (end - start + 1 < maxBtn) start = Math.max(1, end - maxBtn + 1);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [page, totalPages]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (pageItems.every((item) => selected.has(item.uuid))) {
      setSelected((prev) => {
        const next = new Set(prev);
        pageItems.forEach((item) => next.delete(item.uuid));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        pageItems.forEach((item) => next.add(item.uuid));
        return next;
      });
    }
  }

  async function handleDelete() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 공지 ${selected.size}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await authFetch("/api/admin/notices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuids: [...selected] }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "삭제 실패");
      setSelected(new Set());
      await fetchNotices({ soft: true });
      void signalNoticeChange();
    } catch (e) {
      alert(e instanceof Error ? e.message : "오류가 발생했습니다.");
    }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((item) => selected.has(item.uuid));
  const somePageSelected = pageItems.some((item) => selected.has(item.uuid));

  return (
    <>
      <AdminGlobalLoadingOverlay
        message={loading && !fetchError ? "데이터 불러오는 중…" : null}
      />
      <div style={{ padding: "19px 0 40px", width: "100%" }}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>공지</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#94a3b8" }}>운영 공지 관리</p>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            height: "calc(100vh - 240px)",
            maxHeight: "calc(100vh - 240px)",
          }}
        >
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", padding: "0 16px 0 20px", gap: 8, flexShrink: 0, minHeight: ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX }}>
            <div aria-hidden style={adminListPanelToolbarZeroWidthRhythmSpacerStyle} />
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => { setEditNoticeTarget(null); setShowCreateModal(true); }}
              style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              공지 등록
            </button>
            <button
              type="button"
              onClick={() => { void handleDelete(); }}
              disabled={selected.size === 0}
              style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: selected.size === 0 ? "#f8fafc" : "#fff", color: selected.size === 0 ? "#94a3b8" : "#ef4444", fontWeight: 600, fontSize: 13, cursor: selected.size === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              삭제
            </button>
            <div style={{ position: "relative" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="이름, 작성자, UUID, 본문 검색"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: 29, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, color: "#1e293b", width: ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX, outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <button
              type="button"
              onClick={() => { void fetchNotices(); }}
              disabled={loading}
              title="새로고침"
              style={{ width: 32, height: 32, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: loading ? "#cbd5e1" : "#64748b", cursor: loading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 9A8 8 0 0 0 6.93 5.41M4 15a8 8 0 0 0 13.07 3.59" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {!loading && fetchError && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#ef4444", fontSize: 14 }}>
              {fetchError}
            </div>
          )}
          {!fetchError && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: noticeTableMinW,
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <colgroup>
                  {noticeColW.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={adminListTableTheadRowStyle}>
                    <th
                      style={{
                        ...thStyle,
                        ...adminListColBox(noticeColW[0]!),
                        padding: noticeTbl.checkboxThPadding,
                        textAlign: "center",
                        verticalAlign: "middle",
                        lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`,
                        fontSize: 12,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageSelected && !allPageSelected;
                        }}
                        onChange={toggleAll}
                        className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME}
                        style={adminListTableCheckboxInputStyle}
                      />
                      <AdminTableResizeHandle
                        ariaLabel={NOTICE_COL_RESIZE_LABELS[0]!}
                        onMouseDown={(e) => startNoticeColResize(0, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...noticeThPad(noticeTbl.columnPadding.name.th),
                        ...adminListColBox(noticeColW[1]!),
                        textAlign: "left",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      이름
                      <AdminTableResizeHandle
                        ariaLabel={NOTICE_COL_RESIZE_LABELS[1]!}
                        onMouseDown={(e) => startNoticeColResize(1, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...noticeThPad(noticeTbl.columnPadding.postingDate.th),
                        ...adminListColBox(noticeColW[2]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      게시일
                      <AdminTableResizeHandle
                        ariaLabel={NOTICE_COL_RESIZE_LABELS[2]!}
                        onMouseDown={(e) => startNoticeColResize(2, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...noticeThPad(noticeTbl.columnPadding.uuid.th),
                        ...adminListColBox(noticeColW[3]!),
                        textAlign: "left",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      UUID
                      <AdminTableResizeHandle
                        ariaLabel={NOTICE_COL_RESIZE_LABELS[3]!}
                        onMouseDown={(e) => startNoticeColResize(3, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...noticeThPad(noticeTbl.columnPadding.author.th),
                        ...adminListColBox(noticeColW[4]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      작성자
                      <AdminTableResizeHandle
                        ariaLabel={NOTICE_COL_RESIZE_LABELS[4]!}
                        onMouseDown={(e) => startNoticeColResize(4, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...noticeThPad(noticeTbl.columnPadding.registeredAt.th),
                        ...adminListColBox(noticeColW[5]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      등록일
                      <AdminTableResizeHandle
                        ariaLabel={NOTICE_COL_RESIZE_LABELS[5]!}
                        onMouseDown={(e) => startNoticeColResize(5, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...noticeThPad(noticeTbl.columnPadding.isPublic.th),
                        ...adminListColBox(noticeColW[6]!),
                        textAlign: "center",
                        overflow: "hidden",
                      }}
                    >
                      공개 여부
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loading && pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                        불러오는 중...
                      </td>
                    </tr>
                  ) : pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                        {search ? "검색 결과가 없습니다." : "등록된 공지가 없습니다."}
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((item, rowIdx) => {
                      const isSel = selected.has(item.uuid);
                      return (
                        <tr
                          key={item.uuid}
                          onClick={() => setDetail(item)}
                          onMouseEnter={() => setHoveredId(item.uuid)}
                          onMouseLeave={() => setHoveredId(null)}
                          style={{
                            background: isSel
                              ? "rgba(15,23,42,0.05)"
                              : hoveredId === item.uuid
                                ? "#eff6ff"
                                : rowIdx % 2 === 0
                                  ? "#fff"
                                  : "#fafafa",
                            borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                        >
                          <td
                            style={{
                              ...tdStyle,
                              ...adminListColBox(noticeColW[0]!),
                              padding: noticeTbl.checkboxTdPadding,
                              textAlign: "center",
                              verticalAlign: "middle",
                              lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`,
                              fontSize: 12,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={() => toggleRow(item.uuid)}
                              className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME}
                              style={adminListTableCheckboxInputStyle}
                            />
                          </td>
                          <td
                            style={{
                              ...noticeTdPad(noticeTbl.columnPadding.name.td),
                              ...adminListColBox(noticeColW[1]!),
                              fontWeight: 600,
                              color: "#1e293b",
                              maxWidth: noticeTbl.nameMaxWidth,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.noticeTitle}
                          </td>
                          <td
                            style={{
                              ...noticeTdPad(noticeTbl.columnPadding.postingDate.td),
                              ...adminListColBox(noticeColW[2]!),
                              textAlign: "center",
                              color: "#475569",
                              fontVariantNumeric: "tabular-nums",
                              fontSize: 12,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatPostingAtDisplay(item)}
                          </td>
                          <td
                            style={{
                              ...noticeTdPad(noticeTbl.columnPadding.uuid.td),
                              ...adminListColBox(noticeColW[3]!),
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 11,
                              color: "#64748b",
                              maxWidth: noticeTbl.uuidMaxWidth,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={item.uuid}
                          >
                            {item.uuid}
                          </td>
                          <td
                            style={{
                              ...noticeTdPad(noticeTbl.columnPadding.author.td),
                              ...adminListColBox(noticeColW[4]!),
                              textAlign: "center",
                              color: "#475569",
                            }}
                          >
                            {item.author || "—"}
                          </td>
                          <td
                            style={{
                              ...noticeTdPad(noticeTbl.columnPadding.registeredAt.td),
                              ...adminListColBox(noticeColW[5]!),
                              textAlign: "center",
                              color: "#475569",
                              fontVariantNumeric: "tabular-nums",
                              fontSize: 12,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatInDateDisplay(item.inDate)}
                          </td>
                          <td
                            style={{
                              ...noticeTdPad(noticeTbl.columnPadding.isPublic.td),
                              ...adminListColBox(noticeColW[6]!),
                              textAlign: "center",
                            }}
                          >
                            <PublicBadge isPublic={item.isPublic} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!fetchError && (
            <div style={adminListPanelFooterBarStyle}>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>
                총 {filtered.length.toLocaleString()}건
                {selected.size > 0 && (
                  <span style={{ marginLeft: 8, color: "#0f172a", fontWeight: 600 }}>
                    ({selected.size}개 선택)
                  </span>
                )}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <PageBtn onClick={() => setPage(1)} disabled={page === 1} label="«" />
                <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} label="‹" />
                {pageWindow.map((p) => (
                  <PageBtn key={p} onClick={() => setPage(p)} active={p === page} label={String(p)} />
                ))}
                <PageBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} label="›" />
                <PageBtn onClick={() => setPage(totalPages)} disabled={page === totalPages} label="»" />
              </div>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                style={adminListPanelPageSizeSelectStyle}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}개씩 보기
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <NoticeCreateModal
          key={editNoticeTarget?.uuid ?? "create"}
          editNotice={editNoticeTarget}
          listNotice={
            editNoticeTarget
              ? notices.find((n) => n.uuid === editNoticeTarget.uuid) ?? null
              : null
          }
          onClose={() => {
            setShowCreateModal(false);
            setEditNoticeTarget(null);
          }}
          onCreated={async () => {
            await fetchNotices({ soft: true });
          }}
        />
      )}

      {detail && (
        <NoticeDetailModal
          key={detail.uuid}
          notice={detail}
          onClose={() => setDetail(null)}
          onEdit={(n) => {
            setEditNoticeTarget(n);
            setDetail(null);
            setShowCreateModal(true);
          }}
        />
      )}
    </>
  );
}

function PreviewFieldRow({
  label,
  children,
  valueStyle,
}: {
  label: string;
  children: ReactNode;
  valueStyle?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px minmax(0, 1fr)",
        columnGap: 24,
        padding: "12px 0",
        alignItems: "start",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", lineHeight: 1.5 }}>{label}</div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#0f172a",
          lineHeight: 1.55,
          minWidth: 0,
          ...valueStyle,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function orderedLocaleTabs(contents: NoticeLocaleEntry[]): NoticeLocaleEntry[] {
  const list = contents ?? [];
  const fb = list.filter((c) => c.fallback);
  const rest = list.filter((c) => !c.fallback).sort((a, b) => a.language.localeCompare(b.language));
  return [...fb, ...rest];
}

function NoticeDetailModal({
  notice,
  onClose,
  onEdit,
}: {
  notice: NoticeDoc;
  onClose: () => void;
  onEdit: (n: NoticeDoc) => void;
}) {
  const tabs = useMemo(() => orderedLocaleTabs(notice.contents ?? []), [notice.contents]);
  const [tabIdx, setTabIdx] = useState(0);

  const current = tabs[tabIdx] ?? tabs[0] ?? null;
  const imageSrc =
    current?.imageKey?.trim() !== ""
      ? `/api/admin/storage/preview-file?path=${encodeURIComponent(current.imageKey.trim())}`
      : null;

  const publicText = notice.isPublic === "y" ? "공개" : "비공개";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-preview-title"
        style={{
          background: "#fff",
          borderRadius: 14,
          width: 720,
          height: 880,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 20px 14px",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
          }}
        >
          <h2
            id="notice-preview-title"
            style={{
              margin: 0,
              fontWeight: 800,
              fontSize: 18,
              color: "#0f172a",
              lineHeight: 1.35,
              letterSpacing: "-0.02em",
              flex: 1,
              minWidth: 0,
              wordBreak: "break-word",
            }}
          >
            {notice.noticeTitle || "—"}
          </h2>
          <button
            type="button"
            onClick={() => onEdit(notice)}
            style={{
              flexShrink: 0,
              marginTop: 2,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 600,
              color: "#1e293b",
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            수정
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              flexShrink: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "#64748b",
              fontSize: 24,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 20px 20px" }}>
          <div style={{ paddingTop: 8, borderBottom: "1px solid #e5e7eb", marginBottom: 4 }}>
            <PreviewFieldRow label="작성자">{notice.author || "—"}</PreviewFieldRow>
            <PreviewFieldRow label="게시 일시" valueStyle={{ fontVariantNumeric: "tabular-nums" }}>
              {formatPostingAtDisplay(notice)}
            </PreviewFieldRow>
          </div>

          {tabs.length === 0 ? (
            <>
              <PreviewFieldRow label="공개 여부">{publicText}</PreviewFieldRow>
              <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>언어별 내용이 없습니다.</div>
            </>
          ) : (
            <>
              <div
                role="tablist"
                aria-label="언어"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "stretch",
                  gap: 0,
                  paddingTop: 4,
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                {tabs.map((c, i) => {
                  const active = i === tabIdx;
                  return (
                    <button
                      key={`${c.language}-${i}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTabIdx(i)}
                      style={{
                        padding: "12px 16px",
                        border: "none",
                        borderBottom: active ? "2px solid #0f172a" : "2px solid transparent",
                        marginBottom: -1,
                        background: "transparent",
                        color: active ? "#0f172a" : "#64748b",
                        fontWeight: active ? 700 : 500,
                        fontSize: 14,
                        cursor: "pointer",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {noticeLocaleTabLabel(c.language)}
                    </button>
                  );
                })}
              </div>

              {current && (
                <div style={{ paddingTop: 8 }}>
                  <PreviewFieldRow label="제목">{current.title || "—"}</PreviewFieldRow>
                  <PreviewFieldRow
                    label="내용"
                    valueStyle={{ fontWeight: 500, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {current.content || "—"}
                  </PreviewFieldRow>

                  <div style={{ marginTop: 8, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
                    <PreviewFieldRow label="이미지 첨부">
                      {imageSrc ? (
                        <div>
                          {/* eslint-disable-next-line @next/next/no-img-element -- 인증 쿠키로 같은 출처 API 이미지 */}
                          <img
                            src={imageSrc}
                            alt=""
                            style={{
                              maxWidth: "100%",
                              maxHeight: 280,
                              borderRadius: 8,
                              objectFit: "contain",
                              border: "1px solid #e5e7eb",
                              background: "#f8fafc",
                            }}
                          />
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 11,
                              fontWeight: 500,
                              color: "#94a3b8",
                              fontFamily: "ui-monospace, monospace",
                              wordBreak: "break-all",
                            }}
                          >
                            {current.imageKey}
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontWeight: 500, color: "#94a3b8" }}>—</span>
                      )}
                    </PreviewFieldRow>

                    <PreviewFieldRow label="공개 여부">{publicText}</PreviewFieldRow>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            padding: "14px 20px 18px",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            background: "#fafbfc",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "10px 28px",
              borderRadius: 8,
              border: "none",
              background: "#0f172a",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

const thStyle: CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  letterSpacing: "0.03em",
  textAlign: "center",
  whiteSpace: "nowrap",
  verticalAlign: "middle",
  lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`,
};

const tdStyle: CSSProperties = {
  padding: "11px 14px",
  color: "#334155",
  verticalAlign: "middle",
};

function noticeThPad(pad?: string): CSSProperties {
  return pad ? { ...thStyle, padding: pad } : thStyle;
}

function noticeTdPad(pad?: string): CSSProperties {
  return pad ? { ...tdStyle, padding: pad } : tdStyle;
}

