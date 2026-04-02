"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { PostDoc, PostType } from "@/app/api/admin/postbox/posts/route";
import type { ReceiptsResponse, ReceiptRow } from "@/app/api/admin/postbox/receipts/route";
import { storageAuthFetch as authFetch } from "@/lib/storage-auth-fetch";
import { useAdminSession } from "@/app/admin/hooks/useAdminSession";
import { PostRegisterModal } from "./components/PostRegisterModal";
import {
  ADMIN_POSTBOX_LIST_COL_DEFAULTS,
  ADMIN_POSTBOX_LIST_COL_MINS,
  ADMIN_POSTBOX_LIST_COL_STORAGE_KEY,
  adminListColBox,
  postboxListTableLayout as postTbl,
} from "@/lib/admin-list-table-layout";
import { AdminTableResizeHandle } from "@/lib/admin-table-resize-handle";
import { useResizableAdminTableColumns } from "@/lib/use-resizable-admin-table-columns";

const POSTBOX_COL_RESIZE_LABELS = [
  "선택 열과 번호 열 사이 너비 조절",
  "번호 열과 제목 열 사이 너비 조절",
  "제목 열과 대상 열 사이 너비 조절",
  "대상 열과 발송인 열 사이 너비 조절",
  "발송인 열과 보상 열 사이 너비 조절",
  "보상 열과 발송일 열 사이 너비 조절",
  "발송일 열과 만료일 열 사이 너비 조절",
  "만료일 열과 상태 열 사이 너비 조절",
] as const;
import { usePostboxChangeSignal } from "./hooks/usePostboxChangeSignal";
import { signalPostboxChange } from "@/lib/firestore-postbox-signal";

// ── Types ────────────────────────────────────────────────────────────────────

type PostboxTab = "admin" | "repeat" | "user" | "leaderboard";

const TAB_POST_TYPE: Record<PostboxTab, PostType> = {
  admin: "Admin",
  repeat: "Repeat",
  user: "User",
  leaderboard: "Leaderboard",
};

type PostboxStatus = "활성" | "만료" | "비활성";

function resolveStatus(post: PostDoc): PostboxStatus {
  if (!post.isActive) return "비활성";
  if (new Date(post.expiresAt) < new Date()) return "만료";
  return "활성";
}

function formatTarget(post: PostDoc): string {
  const n = Object.keys(post.recipientUids).length;
  if (post.targetAudience === "specific" && n > 0) {
    return `지정 ${n}명`;
  }
  return "전체";
}

// ── Constants ────────────────────────────────────────────────────────────────

const TAB_LABELS: { id: PostboxTab; label: string }[] = [
  { id: "admin", label: "관리자 우편" },
  { id: "repeat", label: "반복 우편" },
  { id: "user", label: "유저 우편" },
  { id: "leaderboard", label: "리더보드 보상" },
];

/** 미구현 탭 — 비활성 UI + 호버 시 안내 */
const COMING_SOON_TABS = new Set<PostboxTab>(["repeat", "user", "leaderboard"]);

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PostboxStatus }) {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  };
  if (status === "활성") return <span style={{ ...base, background: "rgba(5,150,105,0.10)", color: "#059669" }}>활성</span>;
  if (status === "만료") return <span style={{ ...base, background: "rgba(100,116,139,0.10)", color: "#64748b" }}>만료</span>;
  return <span style={{ ...base, background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>비활성</span>;
}

function PageBtn({ onClick, disabled, active, label }: {
  onClick: () => void; disabled?: boolean; active?: boolean; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minWidth: 32, height: 32, padding: "0 6px", borderRadius: 6,
        border: active ? "1px solid #0f172a" : "1px solid transparent",
        background: active ? "#0f172a" : "transparent",
        color: active ? "#fff" : disabled ? "#cbd5e1" : "#334155",
        fontWeight: active ? 700 : 500, fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function PostboxClient() {
  const [activeTab, setActiveTab] = useState<PostboxTab>("admin");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [receiptPost, setReceiptPost] = useState<PostDoc | null>(null);
  const [hoveredPostId, setHoveredPostId] = useState<string | null>(null);
  const [comingSoonPtr, setComingSoonPtr] = useState<{ x: number; y: number } | null>(null);

  const { bootstrapped } = useAdminSession();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const [posts, setPosts] = useState<PostDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const {
    widths: postColW,
    totalWidth: postTableMinW,
    startResize: startPostColResize,
  } = useResizableAdminTableColumns({
    storageKey: ADMIN_POSTBOX_LIST_COL_STORAGE_KEY,
    defaults: ADMIN_POSTBOX_LIST_COL_DEFAULTS,
    mins: ADMIN_POSTBOX_LIST_COL_MINS,
  });

  const fetchPosts = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    if (!soft) {
      setLoading(true);
      setFetchError(null);
    }
    try {
      const postType = TAB_POST_TYPE[activeTab];
      const res = await authFetch(`/api/admin/postbox/posts?postType=${postType}`);
      const data = await res.json() as { ok: boolean; posts?: PostDoc[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "목록 로드 실패");
      const sorted = (data.posts ?? []).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setPosts(sorted);
      if (soft) setFetchError(null);
    } catch (e) {
      if (!soft) {
        setFetchError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      }
    } finally {
      if (!soft) setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!bootstrapped) return;
    void fetchPosts();
  }, [fetchPosts, bootstrapped]);

  const onPostboxRemoteChange = useCallback(() => {
    void fetchPosts({ soft: true });
  }, [fetchPosts]);
  usePostboxChangeSignal(onPostboxRemoteChange, bootstrapped);

  // ── Filtering & pagination ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.sender.toLowerCase().includes(q) ||
        p.postId.toLowerCase().includes(q) ||
        Object.entries(p.recipientUids).some(
          ([uid, label]) =>
            uid.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q),
        ),
    );
  }, [posts, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const pageWindow = useMemo(() => {
    const maxBtn = 7;
    const half = Math.floor(maxBtn / 2);
    let start = Math.max(1, page - half);
    let end = Math.min(totalPages, start + maxBtn - 1);
    if (end - start + 1 < maxBtn) start = Math.max(1, end - maxBtn + 1);
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }, [page, totalPages]);

  // ── Actions ────────────────────────────────────────────────────────────────
  function switchTab(tab: PostboxTab) {
    if (COMING_SOON_TABS.has(tab)) return;
    setActiveTab(tab);
    setPage(1);
    setSelected(new Set());
    setSearch("");
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (pageItems.every((item) => selected.has(item.postId))) {
      setSelected((prev) => {
        const next = new Set(prev);
        pageItems.forEach((item) => next.delete(item.postId));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        pageItems.forEach((item) => next.add(item.postId));
        return next;
      });
    }
  }

  async function handleDelete() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 우편 ${selected.size}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await authFetch("/api/admin/postbox/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [...selected] }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "삭제 실패");
      setSelected(new Set());
      await fetchPosts({ soft: true });
      void signalPostboxChange();
    } catch (e) {
      alert(e instanceof Error ? e.message : "오류가 발생했습니다.");
    }
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((item) => selected.has(item.postId));
  const somePageSelected = pageItems.some((item) => selected.has(item.postId));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ padding: "19px 0 40px", width: "100%" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>우편</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#94a3b8" }}>운영 우편 관리</p>
          </div>
          <button
            type="button"
            onClick={() => setShowRegisterModal(true)}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: "#0f172a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            + 우편 등록
          </button>
          <button
            type="button"
            onClick={() => { void handleDelete(); }}
            disabled={selected.size === 0}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "1px solid #e2e8f0",
              background: selected.size === 0 ? "#f8fafc" : "#fff",
              color: selected.size === 0 ? "#94a3b8" : "#ef4444",
              fontWeight: 600, fontSize: 13,
              cursor: selected.size === 0 ? "not-allowed" : "pointer",
            }}
          >
            삭제{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="제목, 발송인 검색"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{
                paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc",
                fontSize: 13, color: "#1e293b", width: 200, outline: "none",
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => { void fetchPosts(); }}
            title="새로고침"
            style={{
              width: 34, height: 34, borderRadius: 8, border: "1px solid #e2e8f0",
              background: "#f8fafc", color: "#64748b", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 9A8 8 0 0 0 6.93 5.41M4 15a8 8 0 0 0 13.07 3.59" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Panel */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 280px)", maxHeight: "calc(100vh - 280px)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", padding: "0 20px" }}>
            {TAB_LABELS.map(({ id, label }) => {
              const soon = COMING_SOON_TABS.has(id);
              const active = activeTab === id && !soon;
              return (
                <button
                  key={id}
                  type="button"
                  aria-disabled={soon}
                  onClick={() => switchTab(id)}
                  onMouseMove={(e) => {
                    if (!soon) return;
                    setComingSoonPtr({ x: e.clientX + 12, y: e.clientY + 14 });
                  }}
                  onMouseLeave={() => setComingSoonPtr(null)}
                  style={{
                    padding: "14px 18px",
                    border: "none",
                    borderBottom: active ? "2px solid #0f172a" : "2px solid transparent",
                    background: "transparent",
                    color: soon ? "#cbd5e1" : active ? "#0f172a" : "#64748b",
                    fontWeight: active ? 700 : 500,
                    fontSize: 14,
                    cursor: soon ? "not-allowed" : "pointer",
                    marginBottom: -1,
                    transition: "color 0.12s",
                    opacity: soon ? 0.72 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Loading / error */}
          {loading && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
              불러오는 중…
            </div>
          )}
          {!loading && fetchError && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#ef4444", fontSize: 14 }}>
              {fetchError}
            </div>
          )}

          {/* Table */}
          {!loading && !fetchError && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: postTableMinW,
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <colgroup>
                  {postColW.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                    <th
                      style={{
                        ...thStyle,
                        ...adminListColBox(postColW[0]!),
                        padding: postTbl.checkboxThPadding,
                        textAlign: "center",
                        verticalAlign: "middle",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div style={checkboxCellInner}>
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                          onChange={toggleAll}
                          style={tableCheckboxInputStyle}
                        />
                      </div>
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[0]!}
                        onMouseDown={(e) => startPostColResize(0, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...thStyle,
                        ...adminListColBox(postColW[1]!),
                        textAlign: "center",
                        padding: postTbl.numberThPadding,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      번호
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[1]!}
                        onMouseDown={(e) => startPostColResize(1, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.title.th),
                        ...adminListColBox(postColW[2]!),
                        textAlign: "left",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      제목
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[2]!}
                        onMouseDown={(e) => startPostColResize(2, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.target.th),
                        ...adminListColBox(postColW[3]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      대상
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[3]!}
                        onMouseDown={(e) => startPostColResize(3, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.sender.th),
                        ...adminListColBox(postColW[4]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      발송인
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[4]!}
                        onMouseDown={(e) => startPostColResize(4, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.reward.th),
                        ...adminListColBox(postColW[5]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      보상
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[5]!}
                        onMouseDown={(e) => startPostColResize(5, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.sentAt.th),
                        ...adminListColBox(postColW[6]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      발송일
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[6]!}
                        onMouseDown={(e) => startPostColResize(6, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.expiresAt.th),
                        ...adminListColBox(postColW[7]!),
                        textAlign: "center",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      만료일
                      <AdminTableResizeHandle
                        ariaLabel={POSTBOX_COL_RESIZE_LABELS[7]!}
                        onMouseDown={(e) => startPostColResize(7, e.clientX)}
                      />
                    </th>
                    <th
                      style={{
                        ...postThPad(postTbl.columnPadding.status.th),
                        ...adminListColBox(postColW[8]!),
                        textAlign: "center",
                        overflow: "hidden",
                      }}
                    >
                      상태
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>
                        {search ? "검색 결과가 없습니다." : "등록된 우편이 없습니다."}
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((item, rowIdx) => {
                      const isSelected = selected.has(item.postId);
                      const status = resolveStatus(item);
                      const hasReward = item.rewards && item.rewards.length > 0;
                      const targetTitle =
                        item.targetAudience === "specific" &&
                        Object.keys(item.recipientUids).length > 0
                          ? Object.entries(item.recipientUids)
                              .map(([uid, label]) =>
                                label ? `${label} (${uid})` : uid,
                              )
                              .join("\n")
                          : undefined;
                      return (
                        <tr
                          key={item.postId}
                          onClick={() => setReceiptPost(item)}
                          onMouseEnter={() => setHoveredPostId(item.postId)}
                          onMouseLeave={() => setHoveredPostId(null)}
                          style={{
                            background: isSelected
                              ? "rgba(15,23,42,0.05)"
                              : hoveredPostId === item.postId
                              ? "#eff6ff"
                              : rowIdx % 2 === 0 ? "#fff" : "#fafafa",
                            borderBottom: "1px solid #f1f5f9",
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                        >
                          <td
                            style={{
                              ...tdStyle,
                              ...adminListColBox(postColW[0]!),
                              padding: postTbl.checkboxTdPadding,
                              textAlign: "center",
                              verticalAlign: "middle",
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div style={checkboxCellInner}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleRow(item.postId)}
                                style={tableCheckboxInputStyle}
                              />
                            </div>
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              ...adminListColBox(postColW[1]!),
                              textAlign: "center",
                              color: "#94a3b8",
                              fontSize: 11,
                              padding: postTbl.numberTdPadding,
                            }}
                          >
                            {(page - 1) * pageSize + rowIdx + 1}
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.title.td),
                              ...adminListColBox(postColW[2]!),
                              fontWeight: 600,
                              color: "#1e293b",
                              maxWidth: postTbl.titleMaxWidth,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {item.title}
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.target.td),
                              ...adminListColBox(postColW[3]!),
                              textAlign: "center",
                              color: "#475569",
                              fontSize: 12,
                            }}
                            title={targetTitle}
                          >
                            {formatTarget(item)}
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.sender.td),
                              ...adminListColBox(postColW[4]!),
                              textAlign: "center",
                              color: "#475569",
                            }}
                          >
                            {item.sender || "—"}
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.reward.td),
                              ...adminListColBox(postColW[5]!),
                              textAlign: "center",
                              color: "#475569",
                              fontSize: 12,
                            }}
                          >
                            {hasReward
                              ? <span
                                  title={item.rewards
                                    .map((r) => {
                                      const base = `${r.table} / ${r.row} ×${r.count}`;
                                      const n = r.rowValues ? Object.keys(r.rowValues).length : 0;
                                      return n ? `${base}\nrowValues: ${n} keys` : base;
                                    })
                                    .join("\n\n")}
                                  style={{ cursor: "help" }}
                                >
                                  {item.rewards.length === 1
                                    ? `${item.rewards[0]!.table} ×${item.rewards[0]!.count}`
                                    : `${item.rewards.length}종`}
                                </span>
                              : <span style={{ color: "#cbd5e1" }}>—</span>
                            }
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.sentAt.td),
                              ...adminListColBox(postColW[6]!),
                              textAlign: "center",
                              color: "#475569",
                              fontVariantNumeric: "tabular-nums",
                              fontSize: 12,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Date(item.createdAt).toLocaleDateString("ko-KR")}
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.expiresAt.td),
                              ...adminListColBox(postColW[7]!),
                              textAlign: "center",
                              color: "#475569",
                              fontVariantNumeric: "tabular-nums",
                              fontSize: 12,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Date(item.expiresAt).toLocaleDateString("ko-KR")}
                          </td>
                          <td
                            style={{
                              ...postTdPad(postTbl.columnPadding.status.td),
                              ...adminListColBox(postColW[8]!),
                              textAlign: "center",
                            }}
                          >
                            <StatusBadge status={status} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && !fetchError && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderTop: "1px solid #f1f5f9", gap: 12 }}>
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
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{
                  padding: "5px 8px", borderRadius: 6, border: "1px solid #e2e8f0",
                  background: "#f8fafc", fontSize: 13, color: "#334155", cursor: "pointer",
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}개씩 보기</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

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
          추후 구현 예정
        </div>
      ) : null}

      {/* Registration modal */}
      {showRegisterModal && (
        <PostRegisterModal
          defaultPostType={TAB_POST_TYPE[activeTab]}
          onClose={() => setShowRegisterModal(false)}
          onCreated={async () => {
            setShowRegisterModal(false);
            await fetchPosts({ soft: true });
          }}
        />
      )}

      {/* Receipt modal */}
      {receiptPost && (
        <PostReceiptModal
          post={receiptPost}
          onClose={() => setReceiptPost(null)}
        />
      )}
    </>
  );
}

// ── PostReceiptModal ─────────────────────────────────────────────────────────

function formatDatetime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

type ReceiptFilter = "all" | "claimed" | "dismissed" | "pending";

const FILTER_META: Record<ReceiptFilter, { label: string; dot: string }> = {
  all:       { label: "전체",   dot: "" },
  claimed:   { label: "수령",   dot: "#059669" },
  dismissed: { label: "삭제",   dot: "#94a3b8" },
  pending:   { label: "미수령", dot: "#f59e0b" },
};

function ReceiptStatusDot({ type }: { type: ReceiptRow["type"] }) {
  const cfg = {
    claimed:   { label: "수령",   dot: "#059669", color: "#374151" },
    dismissed: { label: "삭제",   dot: "#94a3b8", color: "#6b7280" },
    pending:   { label: "미수령", dot: "#f59e0b", color: "#374151" },
  }[type];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: cfg.color }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
      {cfg.label}
    </span>
  );
}

type PaginationState = {
  cursors: (string | null)[];
  pageIdx: number;
  appliedSearch: string;
};

function PostReceiptModal({ post, onClose }: { post: PostDoc; onClose: () => void }) {
  const [data, setData] = useState<ReceiptsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReceiptFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [pagination, setPagination] = useState<PaginationState>({
    cursors: [null],
    pageIdx: 0,
    appliedSearch: "",
  });

  const overlayRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const isAll = data?.targetAudience === "all";
  const currentCursor = pagination.cursors[pagination.pageIdx] ?? null;
  const hasPrev = pagination.pageIdx > 0;
  const hasNext = !!data?.nextCursor;
  const isSearchMode = !!pagination.appliedSearch;
  const pageLabel = `${pagination.pageIdx + 1}페이지`;

  // 검색 디바운스 (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  // 검색어 변경 시 페이지네이션 리셋
  useEffect(() => {
    setPagination({ cursors: [null], pageIdx: 0, appliedSearch: debouncedSearch });
  }, [debouncedSearch]);

  // 데이터 페치
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ postId: post.postId });
    if (currentCursor) params.set("cursor", currentCursor);
    if (pagination.appliedSearch) params.set("search", pagination.appliedSearch);

    authFetch(`/api/admin/postbox/receipts?${params.toString()}`)
      .then((res) => res.json() as Promise<ReceiptsResponse | { ok: false; error: string }>)
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setError((json as { ok: false; error: string }).error ?? "오류가 발생했습니다.");
        } else {
          setData(json as ReceiptsResponse);
          if (bodyRef.current) bodyRef.current.scrollTop = 0;
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [post.postId, currentCursor, pagination.appliedSearch]);

  function goNext() {
    if (!data?.nextCursor) return;
    const nc = data.nextCursor;
    setPagination((prev) => {
      const newCursors = [...prev.cursors];
      if (prev.pageIdx + 1 >= newCursors.length) newCursors.push(nc);
      return { ...prev, cursors: newCursors, pageIdx: prev.pageIdx + 1 };
    });
  }

  function goPrev() {
    if (pagination.pageIdx === 0) return;
    setPagination((prev) => ({ ...prev, pageIdx: prev.pageIdx - 1 }));
  }

  // specific: 클라이언트 필터링 / all: 서버가 이미 검색 처리
  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.receipts;
    if (filter !== "all") rows = rows.filter((r) => r.type === filter);
    if (data.targetAudience === "specific") {
      const q = search.trim().toLowerCase();
      if (q) rows = rows.filter((r) =>
        r.displayName.toLowerCase().includes(q) || r.uid.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [data, filter, search]);

  const counts: Record<ReceiptFilter, number> = useMemo(() => ({
    all: data?.receipts.length ?? 0,
    claimed: data?.claimed ?? 0,
    dismissed: data?.dismissed ?? 0,
    pending: data?.pending ?? 0,
  }), [data]);

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        background: "#fff",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
        boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
        width: "min(1320px, 94vw)",
        height: "min(900px, 92vh)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>

        {/* ── Header ── */}
        <div style={{ padding: "18px 24px 0", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: "0.04em" }}>
                  수령 현황
                </span>
                <span style={{ color: "#d1d5db", fontSize: 11 }}>·</span>
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  {data
                    ? (isAll ? `전체 발송 · ${data.total.toLocaleString()}명` : `지정 발송 · ${data.total.toLocaleString()}명`)
                    : (post.targetAudience === "specific" ? "지정 발송" : "전체 발송")}
                </span>
                {isAll && isSearchMode && (
                  <>
                    <span style={{ color: "#d1d5db", fontSize: 11 }}>·</span>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>검색 결과 {data?.total ?? 0}명</span>
                  </>
                )}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "calc(min(1320px, 94vw) - 140px)" }}>
                {post.title}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3, fontFamily: "monospace" }}>
                {post.postId}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                flexShrink: 0, width: 30, height: 30, borderRadius: 6,
                border: "1px solid #e5e7eb", background: "transparent",
                color: "#6b7280", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* ── 탭 + 검색 ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", gap: 1 }}>
              {(["all", "claimed", "dismissed", "pending"] as ReceiptFilter[]).map((f) => {
                const meta = FILTER_META[f];
                const active = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "7px 13px", borderRadius: "8px 8px 0 0",
                      border: "none", cursor: "pointer",
                      fontSize: 13, fontWeight: active ? 600 : 400,
                      background: active ? "#fff" : "transparent",
                      color: active ? "#111827" : "#9ca3af",
                      transition: "color 0.1s",
                      borderBottom: active ? "2px solid #111827" : "2px solid transparent",
                      marginBottom: -1,
                    }}
                  >
                    {f !== "all" && (
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: meta.dot, opacity: active ? 1 : 0.45,
                      }} />
                    )}
                    {meta.label}
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      background: active ? "#f3f4f6" : "transparent",
                      color: active ? "#374151" : "#9ca3af",
                      borderRadius: 10, padding: "0px 6px", minWidth: 18, textAlign: "center",
                    }}>
                      {counts[f]}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 검색 */}
            <div style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {isAll && (
                <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>
                  {isSearchMode ? "전체 검색" : "페이지 내 필터"}
                </span>
              )}
              <div style={{ position: "relative" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", pointerEvents: "none" }}>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  placeholder={isAll ? "UID / 닉네임 접두사 검색" : "이름 또는 UID"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    paddingLeft: 28, paddingRight: search ? 26 : 10,
                    paddingTop: 6, paddingBottom: 6,
                    borderRadius: 7, border: "1px solid #e5e7eb",
                    background: "#f9fafb", fontSize: 12, color: "#111827",
                    width: 220, outline: "none",
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#6b7280"; e.currentTarget.style.background = "#fff"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.background = "#f9fafb"; }}
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")}
                    style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, lineHeight: 1, padding: 0 }}>
                    ×
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          {/* 초기 로딩 (데이터 없음) */}
          {loading && !data && (
            <div style={{ padding: "60px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              불러오는 중…
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: "60px 0", textAlign: "center", color: "#ef4444", fontSize: 13 }}>
              {error}
            </div>
          )}
          {/* 데이터 있으면 로딩 중에도 테이블 유지, 투명도로 구분 */}
          {!error && data && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, opacity: loading ? 0.4 : 1, transition: "opacity 0.15s" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1 }}>
                  <th style={rThStyle}>#</th>
                  <th style={{ ...rThStyle, textAlign: "left", paddingLeft: 16 }}>표시명</th>
                  <th style={{ ...rThStyle, textAlign: "left" }}>UID</th>
                  <th style={{ ...rThStyle, textAlign: "center" }}>상태</th>
                  <th style={{ ...rThStyle, textAlign: "center" }}>수령 일시</th>
                  <th style={{ ...rThStyle, textAlign: "center" }}>삭제 일시</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "52px 0", textAlign: "center", color: "#d1d5db", fontSize: 13 }}>
                      조회 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => {
                    const rowNum = pagination.pageIdx * 100 + i + 1;
                    return (
                      <tr
                        key={r.uid}
                        style={{ borderBottom: "1px solid #f3f4f6" }}
                      >
                        <td style={{ ...rTdStyle, textAlign: "center", color: "#d1d5db", fontSize: 11, width: 44 }}>
                          {rowNum}
                        </td>
                        <td style={{ ...rTdStyle, paddingLeft: 16, fontWeight: 500, color: "#111827" }}>
                          {r.displayName || <span style={{ color: "#d1d5db" }}>—</span>}
                        </td>
                        <td style={{ ...rTdStyle }}>
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#4b5563" }}>
                            {r.uid}
                          </span>
                        </td>
                        <td style={{ ...rTdStyle, textAlign: "center" }}>
                          <ReceiptStatusDot type={r.type} />
                        </td>
                        <td style={{ ...rTdStyle, textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.claimedAt ? "#111827" : "#d1d5db", fontSize: 12 }}>
                          {formatDatetime(r.claimedAt)}
                        </td>
                        <td style={{ ...rTdStyle, textAlign: "center", fontVariantNumeric: "tabular-nums", color: r.dismissedAt ? "#111827" : "#d1d5db", fontSize: 12 }}>
                          {formatDatetime(r.dismissedAt)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid #e5e7eb",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#f9fafb", flexShrink: 0,
        }}>
          {/* 좌: 건수 */}
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            {data
              ? (isAll
                  ? (isSearchMode
                      ? `검색 결과 ${data.total.toLocaleString()}명`
                      : `전체 ${data.total.toLocaleString()}명 · ${pageLabel}`)
                  : `총 ${data.total.toLocaleString()}명`)
              : "—"}
          </span>

          {/* 중앙: 페이지 이동 (all 발송 + 비검색 모드) */}
          {isAll && !isSearchMode ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                onClick={goPrev}
                disabled={!hasPrev || loading}
                style={{
                  padding: "4px 12px", borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: hasPrev && !loading ? "#374151" : "#d1d5db",
                  fontSize: 12, fontWeight: 500, cursor: hasPrev && !loading ? "pointer" : "not-allowed",
                }}
              >
                이전
              </button>
              <span style={{ fontSize: 12, color: "#374151", fontWeight: 600, minWidth: 44, textAlign: "center" }}>
                {loading ? "…" : pageLabel}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={!hasNext || loading}
                style={{
                  padding: "4px 12px", borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: hasNext && !loading ? "#374151" : "#d1d5db",
                  fontSize: 12, fontWeight: 500, cursor: hasNext && !loading ? "pointer" : "not-allowed",
                }}
              >
                다음
              </button>
            </div>
          ) : <span />}

          {/* 우: 수령률 (specific만) */}
          {!isAll && data ? (
            <div style={{ display: "flex", gap: 18 }}>
              {[
                { label: "수령", value: data.total > 0 ? `${Math.round((data.claimed / data.total) * 100)}%` : "—" },
                { label: "삭제", value: data.total > 0 ? `${Math.round((data.dismissed / data.total) * 100)}%` : "—" },
                { label: "미수령", value: data.total > 0 ? `${Math.round((data.pending / data.total) * 100)}%` : "—" },
              ].map(({ label, value }) => (
                <span key={label} style={{ fontSize: 12, color: "#6b7280" }}>
                  {label} <span style={{ fontWeight: 600, color: "#374151" }}>{value}</span>
                </span>
              ))}
            </div>
          ) : <span />}
        </div>
      </div>
    </div>
  );
}

const rThStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 600,
  color: "#6b7280",
  letterSpacing: "0.04em",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const rTdStyle: React.CSSProperties = {
  padding: "7px 12px",
  verticalAlign: "middle",
};

// ── Style helpers ────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  letterSpacing: "0.03em",
  textAlign: "center",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "11px 14px",
  color: "#334155",
  verticalAlign: "middle",
};

function postThPad(pad?: string): React.CSSProperties {
  return pad ? { ...thStyle, padding: pad } : thStyle;
}

function postTdPad(pad?: string): React.CSSProperties {
  return pad ? { ...tdStyle, padding: pad } : tdStyle;
}

const checkboxCellInner: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  boxSizing: "border-box",
};

/** 18px 대비 약 5% 축소 */
const tableCheckboxInputStyle: React.CSSProperties = {
  width: 17,
  height: 17,
  margin: 0,
  flexShrink: 0,
  cursor: "pointer",
  accentColor: "#0f172a",
};
