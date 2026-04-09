"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { PostDoc, PostType } from "@/app/api/admin/postbox/posts/route";
import type { MailScheduleJob } from "@/app/api/admin/postbox/schedule/route";
import { regionTabLabel } from "@/lib/region-catalog";
import type { ReceiptsResponse, ReceiptRow } from "@/app/api/admin/postbox/receipts/route";
import { storageAuthFetch as authFetch } from "@/lib/storage-auth-fetch";
import { useAdminSession } from "@/app/admin/hooks/useAdminSession";
import { PostRegisterModal } from "./components/PostRegisterModal";
import {
  ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX,
  ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX,
  ADMIN_POSTBOX_LIST_COL_DEFAULTS,
  ADMIN_POSTBOX_LIST_COL_MINS,
  ADMIN_POSTBOX_LIST_COL_STORAGE_KEY,
  ADMIN_LIST_SELECT_COL_SYNC_STORAGE_KEY,
  adminListColBox,
  adminListPanelFooterBarStyle,
  adminListPanelPageSizeSelectStyle,
  ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME,
  ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX,
  adminListTableCheckboxInputStyle,
  adminListTableTheadRowStyle,
  postboxListTableLayout as postTbl,
} from "@/lib/admin-list-table-layout";
import { AdminTableResizeHandle } from "@/lib/admin-table-resize-handle";
import { useResizableAdminTableColumns } from "@/lib/use-resizable-admin-table-columns";
import { usePostboxChangeSignal } from "./hooks/usePostboxChangeSignal";
import { signalPostboxChange } from "@/lib/firestore-postbox-signal";
import { AdminGlobalLoadingOverlay } from "@/app/admin/components/AdminGlobalLoadingOverlay";
import { repeatUtcToKst, type RepeatDay } from "@/lib/postbox-compute-next-run";
import { orderRegionsGlobalFirst } from "@/lib/admin-region-order";

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

/** 우편 목록·수령 현황·차트 관리와 동일 */
const ADMIN_DATA_LOADING_MESSAGE = "데이터 불러오는 중…";

// ── Types ────────────────────────────────────────────────────────────────────

type PostboxTab = "admin" | "repeat" | "user" | "leaderboard";

const TAB_POST_TYPE: Record<PostboxTab, PostType> = {
  admin: "Admin",
  repeat: "Admin",
  user: "User",
  leaderboard: "Leaderboard",
};

type PostboxStatus = "활성" | "만료" | "비활성";

function resolveStatus(post: PostDoc): PostboxStatus {
  if (!post.isActive) return "비활성";
  const now = new Date();
  if (post.dispatchMode === "repeat") {
    return "활성";
  }
  if (new Date(post.expiresAt) < now) return "만료";
  return "활성";
}

function formatTarget(post: PostDoc): string {
  if (post.targetAudience === "specific" && post.recipientCount > 0) {
    return `지정 ${post.recipientCount}명`;
  }
  return "전체";
}

// ── Constants ────────────────────────────────────────────────────────────────

const TAB_LABELS: { id: PostboxTab; label: string }[] = [
  { id: "admin", label: "즉시 발송" },
  { id: "repeat", label: "반복 우편" },
  { id: "user", label: "유저 우편" },
  { id: "leaderboard", label: "리더보드 보상" },
];

/** 미구현 탭 — 비활성 UI + 호버 시 안내 */
const COMING_SOON_TABS = new Set<PostboxTab>(["user", "leaderboard"]);

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const RECEIPT_COL_STORAGE_KEY = "admin-postbox-receipt-col-widths-v1";
const RECEIPT_COL_DEFAULTS = [220, 260, 220, 90, 120] as const;
const RECEIPT_COL_MINS = [140, 180, 140, 70, 90] as const;
const RECEIPT_COL_RESIZE_LABELS = [
  "닉네임 열과 UID 열 사이 너비 조절",
  "UID 열과 아이템 열 사이 너비 조절",
  "아이템 열과 개수 열 사이 너비 조절",
  "개수 열과 상태 열 사이 너비 조절",
] as const;

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
  const [selectedScheduleJobs, setSelectedScheduleJobs] = useState<Set<string>>(new Set());
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [receiptPost, setReceiptPost] = useState<PostDoc | null>(null);
  const [hoveredPostId, setHoveredPostId] = useState<string | null>(null);
  const [comingSoonPtr, setComingSoonPtr] = useState<{ x: number; y: number } | null>(null);

  const { bootstrapped } = useAdminSession();

  // ── Data fetching ──────────────────────────────────────────────────────────
  const [posts, setPosts] = useState<PostDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [postsNextCursor, setPostsNextCursor] = useState<string | null>(null);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Schedule jobs (반복/예약 우편) ────────────────────────────────────────────
  const [scheduleJobs, setScheduleJobs] = useState<MailScheduleJob[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const scheduleFetchedRef = useRef(false);

  const fetchScheduleJobs = useCallback(async (opts?: { soft?: boolean }) => {
    if (!opts?.soft) setScheduleLoading(true);
    setScheduleError(null);
    try {
      const res = await authFetch("/api/admin/postbox/schedule");
      const data = await res.json() as { ok: boolean; jobs?: MailScheduleJob[]; error?: string };
      if (!data.ok) throw new Error(data.error ?? "목록 로드 실패");
      setScheduleJobs(data.jobs ?? []);
      scheduleFetchedRef.current = true;
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bootstrapped || activeTab !== "repeat") return;
    void fetchScheduleJobs({ soft: scheduleFetchedRef.current });
  }, [bootstrapped, activeTab, fetchScheduleJobs]);

  const handleCancelJob = useCallback(async (jobId: string) => {
    if (!confirm("이 작업을 취소하시겠습니까?")) return;
    try {
      const res = await authFetch("/api/admin/postbox/schedule", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "취소 실패");
      await fetchScheduleJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "오류가 발생했습니다.");
    }
  }, [fetchScheduleJobs]);

  const {
    widths: postColW,
    totalWidth: postTableMinW,
    startResize: startPostColResize,
  } = useResizableAdminTableColumns({
    storageKey: ADMIN_POSTBOX_LIST_COL_STORAGE_KEY,
    defaults: ADMIN_POSTBOX_LIST_COL_DEFAULTS,
    mins: ADMIN_POSTBOX_LIST_COL_MINS,
    syncSelectColumnStorageKey: ADMIN_LIST_SELECT_COL_SYNC_STORAGE_KEY,
  });

  const fetchPosts = useCallback(async (opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    if (!soft) {
      setLoading(true);
      setFetchError(null);
    }
    try {
      const postType = TAB_POST_TYPE[activeTab];
      const params = new URLSearchParams({ postType });
      if (postType === "Admin") {
        params.set("limit", "60");
      }
      const res = await authFetch(`/api/admin/postbox/posts?${params}`);
      const data = await res.json() as {
        ok: boolean;
        posts?: PostDoc[];
        nextCursor?: string | null;
        hasMore?: boolean;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "목록 로드 실패");
      const sorted = (data.posts ?? []).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setPosts(sorted);
      if (postType === "Admin") {
        setPostsNextCursor(data.nextCursor ?? null);
        setPostsHasMore(data.hasMore === true);
      } else {
        setPostsNextCursor(null);
        setPostsHasMore(false);
      }
      if (soft) setFetchError(null);
    } catch (e) {
      if (!soft) {
        setFetchError(e instanceof Error ? e.message : "오류가 발생했습니다.");
      }
    } finally {
      if (!soft) setLoading(false);
    }
  }, [activeTab]);

  const loadMorePosts = useCallback(async () => {
    if (activeTab !== "admin" || !postsNextCursor) return;
    setLoadingMorePosts(true);
    try {
      const params = new URLSearchParams({
        postType: "Admin",
        limit: "60",
        cursor: postsNextCursor,
      });
      const res = await authFetch(`/api/admin/postbox/posts?${params}`);
      const data = await res.json() as {
        ok: boolean;
        posts?: PostDoc[];
        nextCursor?: string | null;
        hasMore?: boolean;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "목록 로드 실패");
      const batch = (data.posts ?? []).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.postId));
        const add = batch.filter((p) => !seen.has(p.postId));
        return [...prev, ...add].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
      setPostsNextCursor(data.nextCursor ?? null);
      setPostsHasMore(data.hasMore === true);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "추가 로드 실패");
    } finally {
      setLoadingMorePosts(false);
    }
  }, [activeTab, postsNextCursor]);

  useEffect(() => {
    if (!bootstrapped) return;
    void fetchPosts();
  }, [fetchPosts, bootstrapped]);

  const onPostboxRemoteChange = useCallback(() => {
    void fetchPosts({ soft: true });
  }, [fetchPosts]);
  usePostboxChangeSignal(onPostboxRemoteChange, bootstrapped);

  // ── Filtering & pagination ─────────────────────────────────────────────────

  const postsForActiveTab = useMemo(() => {
    if (activeTab === "repeat") return posts.filter((p) => p.dispatchMode === "repeat");
    return posts.filter((p) => p.dispatchMode !== "repeat");
  }, [activeTab, posts]);

  const filtered = useMemo(() => {
    const base = postsForActiveTab;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.sender.toLowerCase().includes(q) ||
        p.postId.toLowerCase().includes(q) ||
        Object.entries(p.recipientUids).some(
          ([uid, label]) =>
            uid.toLowerCase().includes(q) ||
            label.toLowerCase().includes(q)
        ),
    );
  }, [postsForActiveTab, search]);

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

  const scheduleJobsForActiveTab = useMemo(() => {
    if (activeTab !== "repeat") return [];
    return scheduleJobs.filter((j) => j.type === "repeat");
  }, [scheduleJobs, activeTab]);

  const filteredScheduleJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scheduleJobsForActiveTab;
    return scheduleJobsForActiveTab.filter((job) => {
      if (job.title.toLowerCase().includes(q)) return true;
      if (job.sender.toLowerCase().includes(q)) return true;
      if (job.jobId.toLowerCase().includes(q)) return true;
      if (job.content.toLowerCase().includes(q)) return true;
      const rec = job.recipientUids ?? {};
      return Object.entries(rec).some(
        ([uid, label]) => uid.toLowerCase().includes(q) || String(label).toLowerCase().includes(q),
      );
    });
  }, [scheduleJobsForActiveTab, search]);

  const hasLegacyScheduleJobs = scheduleJobsForActiveTab.length > 0;

  // ── Actions ────────────────────────────────────────────────────────────────
  function switchTab(tab: PostboxTab) {
    if (COMING_SOON_TABS.has(tab)) return;
    setActiveTab(tab);
    setPage(1);
    setSelected(new Set());
    setSelectedScheduleJobs(new Set());
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
    setDeleting(true);
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
    } finally {
      setDeleting(false);
    }
  }

  function toggleScheduleRow(jobId: string) {
    setSelectedScheduleJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  const toggleAllSchedule = useCallback(() => {
    const visible = filteredScheduleJobs;
    if (visible.length === 0) return;
    if (visible.every((job) => selectedScheduleJobs.has(job.jobId))) {
      setSelectedScheduleJobs(new Set());
      return;
    }
    setSelectedScheduleJobs(new Set(visible.map((job) => job.jobId)));
  }, [filteredScheduleJobs, selectedScheduleJobs]);

  async function handleDeleteSelectedScheduleJobs() {
    if (selectedScheduleJobs.size === 0) return;
    if (!confirm(`선택한 우편 ${selectedScheduleJobs.size}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await authFetch("/api/admin/postbox/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [...selectedScheduleJobs] }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "삭제 실패");
      setSelectedScheduleJobs(new Set());
      await fetchScheduleJobs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "오류가 발생했습니다.");
    }
  }

  function scheduleJobToPostDoc(job: MailScheduleJob): PostDoc {
    const sendAt = job.nextRunAt ? new Date(job.nextRunAt) : new Date();
    const expiresAt = new Date(sendAt.getTime() + job.expiresAfterMs);
    return {
      postId: job.jobId,
      postType: "Admin",
      title: job.title,
      content: job.content,
      sender: job.sender,
      isActive: false,
      createdAt: job.createdAt,
      expiresAt: expiresAt.toISOString(),
      rewards: job.rewards,
      targetAudience: job.targetAudience,
      recipientUids: job.recipientUids ?? {},
      recipientCount: job.recipientUids ? Object.keys(job.recipientUids).length : 0,
      recipientListPath: "",
      mailStorage: job.mailStorage,
      regionContents: job.regionContents,
      dispatchMode: job.type === "scheduled" ? "scheduled" : "repeat",
      visibleFrom: job.scheduledAt,
      repeatDays: job.repeatDays,
      repeatTime: job.repeatTime,
      repeatWindowMs: job.expiresAfterMs,
    };
  }

  const allPageSelected = pageItems.length > 0 && pageItems.every((item) => selected.has(item.postId));
  const somePageSelected = pageItems.some((item) => selected.has(item.postId));
  const allScheduleSelected = filteredScheduleJobs.length > 0 && filteredScheduleJobs.every((job) => selectedScheduleJobs.has(job.jobId));
  const someScheduleSelected = filteredScheduleJobs.some((job) => selectedScheduleJobs.has(job.jobId));

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <AdminGlobalLoadingOverlay
        message={deleting ? "처리 중…" : loading && !fetchError ? ADMIN_DATA_LOADING_MESSAGE : null}
      />
      <div style={{ padding: "19px 0 40px", width: "100%" }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>우편</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#94a3b8" }}>운영 우편 관리</p>
        </div>

        {/* Panel */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - 240px)", maxHeight: "calc(100vh - 240px)" }}>
          {/* Tabs + Actions */}
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e5e7eb", padding: "0 16px 0 20px", gap: 8, flexShrink: 0, minHeight: ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX }}>
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

            {/* Spacer + Action buttons */}
            {!COMING_SOON_TABS.has(activeTab) && (
              <>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(true)}
                  style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  우편 등록
                </button>
                <button
                  type="button"
                  onClick={() => { void handleDelete(); }}
                  disabled={selected.size === 0}
                  style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #e2e8f0", background: selected.size === 0 ? "#f8fafc" : "#fff", color: selected.size === 0 ? "#94a3b8" : "#ef4444", fontWeight: 600, fontSize: 13, cursor: selected.size === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
                >
                  삭제
                </button>
                {(activeTab === "admin" || activeTab === "repeat") && (
                  <div style={{ position: "relative" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }}>
                      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <input
                      type="text"
                      placeholder="제목, 발송인, UID 검색"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                      style={{ paddingLeft: 29, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", fontSize: 13, color: "#1e293b", width: ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void fetchPosts();
                    if (activeTab === "repeat" && hasLegacyScheduleJobs) void fetchScheduleJobs();
                  }}
                  disabled={loading}
                  title="새로고침"
                  style={{ width: 32, height: 32, borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc", color: loading ? "#cbd5e1" : "#64748b", cursor: loading ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M4 4v5h5M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M20 9A8 8 0 0 0 6.93 5.41M4 15a8 8 0 0 0 13.07 3.59" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Error */}
          {!loading && fetchError && (
            <div style={{ padding: "40px 0", textAlign: "center", color: "#ef4444", fontSize: 14 }}>
              {fetchError}
            </div>
          )}

          {/* Repeat 탭 — 새 posts + 레거시 schedule jobs */}
          {activeTab === "repeat" && !fetchError && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: postTableMinW, tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 }}>
                <colgroup>
                  <col style={{ width: postColW[0] }} />
                  <col style={{ width: postColW[1] }} />
                  <col style={{ width: postColW[2] }} />
                  <col style={{ width: postColW[3] }} />
                  <col style={{ width: postColW[4] }} />
                  <col style={{ width: postColW[5] }} />
                  <col style={{ width: postColW[6] }} />
                  <col style={{ width: postColW[7] }} />
                  <col style={{ width: postColW[8] }} />
                </colgroup>
                <thead>
                  <tr style={adminListTableTheadRowStyle}>
                    <th style={{ ...thStyle, ...adminListColBox(postColW[0]!), padding: postTbl.checkboxThPadding, textAlign: "center", verticalAlign: "middle", lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`, fontSize: 12, position: "relative", overflow: "hidden" }}>
                      <input type="checkbox" checked={allPageSelected} ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }} onChange={toggleAll} className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME} style={adminListTableCheckboxInputStyle} aria-label="전체 선택" />
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[0]!} onMouseDown={(e) => startPostColResize(0, e.clientX)} />
                    </th>
                    <th style={{ ...thStyle, ...adminListColBox(postColW[1]!), textAlign: "center", padding: postTbl.numberThPadding, position: "relative", overflow: "hidden" }}>
                      번호
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[1]!} onMouseDown={(e) => startPostColResize(1, e.clientX)} />
                    </th>
                    <th style={{ ...postThPad(postTbl.columnPadding.title.th), ...adminListColBox(postColW[2]!), textAlign: "left", position: "relative", overflow: "hidden" }}>
                      제목
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[2]!} onMouseDown={(e) => startPostColResize(2, e.clientX)} />
                    </th>
                    <th style={{ ...postThPad(postTbl.columnPadding.target.th), ...adminListColBox(postColW[3]!), textAlign: "center", position: "relative", overflow: "hidden" }}>
                      대상
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[3]!} onMouseDown={(e) => startPostColResize(3, e.clientX)} />
                    </th>
                    <th style={{ ...postThPad(postTbl.columnPadding.sender.th), ...adminListColBox(postColW[4]!), textAlign: "center", position: "relative", overflow: "hidden" }}>
                      수신 인원
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[4]!} onMouseDown={(e) => startPostColResize(4, e.clientX)} />
                    </th>
                    <th style={{ ...thStyle, ...adminListColBox(postColW[5]!), textAlign: "center", position: "relative", overflow: "hidden", padding: postTbl.scheduleRepeatThPadding }}>
                      반복 조건
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[5]!} onMouseDown={(e) => startPostColResize(5, e.clientX)} />
                    </th>
                    <th style={{ ...postThPad(postTbl.columnPadding.sentAt.th), ...adminListColBox(postColW[6]!), textAlign: "center", position: "relative", overflow: "hidden" }}>
                      등록일
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[6]!} onMouseDown={(e) => startPostColResize(6, e.clientX)} />
                    </th>
                    <th style={{ ...postThPad(postTbl.columnPadding.expiresAt.th), ...adminListColBox(postColW[7]!), textAlign: "center", position: "relative", overflow: "hidden" }}>
                      만료일
                      <AdminTableResizeHandle ariaLabel={POSTBOX_COL_RESIZE_LABELS[7]!} onMouseDown={(e) => startPostColResize(7, e.clientX)} />
                    </th>
                    <th style={{ ...postThPad(postTbl.columnPadding.status.th), ...adminListColBox(postColW[8]!), textAlign: "center", overflow: "hidden" }}>
                      상태
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && !hasLegacyScheduleJobs ? (
                    <tr><td colSpan={9} style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>{search ? "검색 결과가 없습니다." : "등록된 반복 우편이 없습니다."}</td></tr>
                  ) : (
                    <>
                      {pageItems.map((item, idx) => {
                        const isSelected = selected.has(item.postId);
                        const status = resolveStatus(item);
                        const dayMap: Record<string, string> = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토", Sun: "일" };
                        const kst = item.repeatDays && item.repeatTime
                          ? repeatUtcToKst(item.repeatTime, item.repeatDays as RepeatDay[])
                          : null;
                        const repeatLabel = kst
                          ? `${kst.kstDays.map((d) => dayMap[d] ?? d).join(" ")} ${kst.kstTime}`
                          : "—";
                        const expireDisplay = item.dispatchMode === "repeat" ? "무기한" : new Date(item.expiresAt).toLocaleDateString("ko-KR");
                        return (
                          <tr key={item.postId} onClick={() => setReceiptPost(item)} style={{ borderBottom: "1px solid #f1f5f9", background: idx % 2 === 0 ? "#fff" : "#fafafa", cursor: "pointer" }}>
                            <td style={{ ...tdStyle, ...adminListColBox(postColW[0]!), padding: postTbl.checkboxTdPadding, textAlign: "center", verticalAlign: "middle", lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`, fontSize: 12 }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleRow(item.postId)} className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME} style={adminListTableCheckboxInputStyle} aria-label={`${item.title} 선택`} />
                            </td>
                            <td style={{ ...tdStyle, ...adminListColBox(postColW[1]!), textAlign: "center", color: "#94a3b8", fontSize: 11, padding: postTbl.numberTdPadding }}>{(page - 1) * pageSize + idx + 1}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.title.td), ...adminListColBox(postColW[2]!), fontWeight: 600, color: "#1e293b", maxWidth: postTbl.titleMaxWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.target.td), ...adminListColBox(postColW[3]!), textAlign: "center", color: "#475569", fontSize: 12 }}>{formatTarget(item)}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.sender.td), ...adminListColBox(postColW[4]!), textAlign: "center", color: "#475569", fontSize: 12 }}>{formatTarget(item)}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.sentAt.td), ...adminListColBox(postColW[5]!), textAlign: "center", verticalAlign: "middle", color: "#475569", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: postTbl.scheduleRepeatTdPadding }}>{repeatLabel}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.sentAt.td), ...adminListColBox(postColW[6]!), textAlign: "center", color: "#475569", fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.expiresAt.td), ...adminListColBox(postColW[7]!), textAlign: "center", color: "#475569", fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{expireDisplay}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.status.td), ...adminListColBox(postColW[8]!), textAlign: "center" }}><StatusBadge status={status} /></td>
                          </tr>
                        );
                      })}
                      {hasLegacyScheduleJobs && filteredScheduleJobs.map((job, idx) => {
                        const isCancelled = job.status === "cancelled";
                        const statusColor = isCancelled ? "#94a3b8" : job.status === "done" ? "#059669" : job.status === "failed" ? "#ef4444" : job.status === "processing" ? "#3b82f6" : "#f59e0b";
                        const statusLabel = { pending: "대기", processing: "처리중", done: "완료", cancelled: "취소됨", failed: "실패" }[job.status] ?? job.status;
                        const repeatDayLabel = job.repeatDays ? job.repeatDays.map((d) => ({ Mon:"월",Tue:"화",Wed:"수",Thu:"목",Fri:"금",Sat:"토",Sun:"일" })[d]).join(" ") : "—";
                        const sendAt = job.nextRunAt ? new Date(job.nextRunAt) : null;
                        const expireAt = sendAt && job.expiresAfterMs ? new Date(sendAt.getTime() + job.expiresAfterMs) : null;
                        const repeatCondition = job.type === "repeat" ? `${repeatDayLabel}${job.repeatTime ? ` ${job.repeatTime}` : ""}` : "1회 예약";
                        const rowOffset = pageItems.length + idx;
                        return (
                          <tr key={job.jobId} onClick={() => setReceiptPost(scheduleJobToPostDoc(job))} style={{ borderBottom: "1px solid #f1f5f9", background: rowOffset % 2 === 0 ? "#fff" : "#fafafa", cursor: "pointer", opacity: 0.6 }}>
                            <td style={{ ...tdStyle, ...adminListColBox(postColW[0]!), padding: postTbl.checkboxTdPadding, textAlign: "center", verticalAlign: "middle", fontSize: 12 }} onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={selectedScheduleJobs.has(job.jobId)} onChange={() => toggleScheduleRow(job.jobId)} className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME} style={adminListTableCheckboxInputStyle} />
                            </td>
                            <td style={{ ...tdStyle, ...adminListColBox(postColW[1]!), textAlign: "center", color: "#94a3b8", fontSize: 11, padding: postTbl.numberTdPadding }}>{rowOffset + 1}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.title.td), ...adminListColBox(postColW[2]!), fontWeight: 600, color: "#1e293b", maxWidth: postTbl.titleMaxWidth, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.title} <span style={{ fontSize: 10, color: "#94a3b8" }}>(레거시)</span></td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.target.td), ...adminListColBox(postColW[3]!), textAlign: "center", color: "#475569", fontSize: 12 }}>{job.targetAudience === "specific" ? "지정" : "전체"}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.sender.td), ...adminListColBox(postColW[4]!), textAlign: "center", color: "#475569", fontSize: 12 }}>{job.sender || "—"}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.sentAt.td), ...adminListColBox(postColW[5]!), textAlign: "center", color: "#475569", fontSize: 12, whiteSpace: "nowrap", padding: postTbl.scheduleRepeatTdPadding }}>{repeatCondition}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.sentAt.td), ...adminListColBox(postColW[6]!), textAlign: "center", color: "#475569", fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{sendAt ? sendAt.toLocaleDateString("ko-KR") : "—"}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.expiresAt.td), ...adminListColBox(postColW[7]!), textAlign: "center", color: "#475569", fontSize: 12, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{expireAt ? expireAt.toLocaleDateString("ko-KR") : "—"}</td>
                            <td style={{ ...postTdPad(postTbl.columnPadding.status.td), ...adminListColBox(postColW[8]!), textAlign: "center", verticalAlign: "middle" }}>
                              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${statusColor}18`, color: statusColor }}>{statusLabel}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Admin Table */}
          {activeTab !== "repeat" && !fetchError && (
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
                  <tr style={adminListTableTheadRowStyle}>
                    <th
                      style={{
                        ...thStyle,
                        ...adminListColBox(postColW[0]!),
                        padding: postTbl.checkboxThPadding,
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
                        ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                        onChange={toggleAll}
                        className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME}
                        style={adminListTableCheckboxInputStyle}
                      />
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
                        item.targetAudience === "specific" && item.recipientCount > 0
                          ? Object.keys(item.recipientUids).length > 0
                            ? Object.entries(item.recipientUids)
                                .map(([uid, label]) => (label ? `${label} (${uid})` : uid))
                                .join("\n")
                            : `${item.recipientCount}명에게 발송됨`
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
                              lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`,
                              fontSize: 12,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRow(item.postId)}
                              className={ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME}
                              style={adminListTableCheckboxInputStyle}
                            />
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
          {!fetchError && (
            <div style={adminListPanelFooterBarStyle}>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>
                {activeTab === "admin" && postsHasMore
                  ? `불러온 ${filtered.length.toLocaleString()}건 · 서버에 더 있음`
                  : `총 ${filtered.length.toLocaleString()}건`}
                {selected.size > 0 && (
                  <span style={{ marginLeft: 8, color: "#0f172a", fontWeight: 600 }}>
                    ({selected.size}개 선택)
                  </span>
                )}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {activeTab === "admin" && postsHasMore ? (
                  <button
                    type="button"
                    onClick={() => void loadMorePosts()}
                    disabled={loadingMorePosts}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid #cbd5e1",
                      background: loadingMorePosts ? "#f1f5f9" : "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#334155",
                      cursor: loadingMorePosts ? "not-allowed" : "pointer",
                    }}
                  >
                    {loadingMorePosts ? "불러오는 중…" : "추가로 불러오기"}
                  </button>
                ) : null}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <PageBtn onClick={() => setPage(1)} disabled={page === 1} label="«" />
                <PageBtn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} label="‹" />
                {pageWindow.map((p) => (
                  <PageBtn key={p} onClick={() => setPage(p)} active={p === page} label={String(p)} />
                ))}
                <PageBtn onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} label="›" />
                <PageBtn onClick={() => setPage(totalPages)} disabled={page === totalPages} label="»" />
              </div>
              </div>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={adminListPanelPageSizeSelectStyle}
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

  const [previewTabIdx, setPreviewTabIdx] = useState(0);

  // post가 바뀌면 탭 인덱스 리셋
  useEffect(() => { setPreviewTabIdx(0); }, [post.postId]);

  const previewTabs = useMemo(() => {
    const list = post.regionContents ?? [];
    return orderRegionsGlobalFirst(list);
  }, [post.regionContents]);

  const previewCurrent = previewTabs[previewTabIdx] ?? previewTabs[0] ?? null;

  const overlayRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const {
    widths: receiptColW,
    totalWidth: receiptTableMinW,
    startResize: startReceiptColResize,
  } = useResizableAdminTableColumns({
    storageKey: RECEIPT_COL_STORAGE_KEY,
    defaults: RECEIPT_COL_DEFAULTS,
    mins: RECEIPT_COL_MINS,
  });

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

  const rewardItems = useMemo(
    () => (post.rewards ?? []).map((reward) => `${reward.table}:${reward.row}`),
    [post.rewards]
  );

  const rewardInlineText = useMemo(
    () =>
      (post.rewards ?? [])
        .map((reward) => `${reward.table}:${reward.row}`)
        .join(", "),
    [post.rewards]
  );

  const rewardItemLabel = useMemo(() => {
    if (rewardItems.length === 0) return "—";
    return rewardItems[0] ?? "—";
  }, [rewardItems]);

  const rewardCountLabel = useMemo(() => {
    if (!post.rewards || post.rewards.length === 0) return "—";
    if (post.rewards.length === 1) {
      const reward = post.rewards[0];
      return reward ? String(reward.count) : "—";
    }
    return String(post.rewards.reduce((sum, reward) => sum + reward.count, 0));
  }, [post.rewards]);

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
      <AdminGlobalLoadingOverlay
        message={loading ? ADMIN_DATA_LOADING_MESSAGE : null}
      />
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
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
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
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>
                {post.postId}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              style={{
                flexShrink: 0,
                border: "none",
                background: "transparent",
                color: "#64748b",
                cursor: "pointer",
                fontSize: 24,
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>

          {/* ── 우편 내용 미리보기 ── */}
          <div style={{ borderTop: "1px solid #f1f5f9", marginBottom: 2 }}>
            {previewTabs.length > 0 ? (
              <>
                <div
                  role="tablist"
                  aria-label="지역"
                  style={{ display: "flex", flexWrap: "wrap", borderBottom: "1px solid #e5e7eb" }}
                >
                  {previewTabs.map((c, i) => {
                    const active = i === previewTabIdx;
                    return (
                      <button
                        key={`${c.regionCode}-${i}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setPreviewTabIdx(i)}
                        style={{
                          padding: "10px 14px",
                          border: "none",
                          borderBottom: active ? "2px solid #0f172a" : "2px solid transparent",
                          marginBottom: -1,
                          background: "transparent",
                          color: active ? "#0f172a" : "#64748b",
                          fontWeight: active ? 700 : 500,
                          fontSize: 13,
                          cursor: "pointer",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {regionTabLabel(c.regionCode)}
                      </button>
                    );
                  })}
                </div>
                {previewCurrent && (
                  <div style={{ padding: "10px 0 12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", columnGap: 16, padding: "5px 0", alignItems: "start" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>제목</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>
                        {previewCurrent.title || "—"}
                      </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", columnGap: 16, padding: "5px 0", alignItems: "start" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>본문</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                        {previewCurrent.content || "—"}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "10px 0 12px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", columnGap: 16, padding: "5px 0", alignItems: "start" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>제목</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.01em" }}>
                    {post.title || "—"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", columnGap: 16, padding: "5px 0", alignItems: "start" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>본문</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
                    {post.content || "—"}
                  </span>
                </div>
              </div>
            )}
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
              <div style={{ position: "relative" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                  style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#9ca3af", pointerEvents: "none" }}>
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  placeholder="닉네임 또는 UID"
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

        {/* ── Body ── (로딩은 전역 오버레이) */}
        <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          {!loading && error && (
            <div style={{ padding: "60px 0", textAlign: "center", color: "#ef4444", fontSize: 13 }}>
              {error}
            </div>
          )}
          {!error && data && (
            <table style={{ width: "100%", minWidth: receiptTableMinW, borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12 }}>
              <colgroup>
                {receiptColW.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb", position: "sticky", top: 0, zIndex: 1 }}>
                  <th style={{ ...rThStyle, textAlign: "left", paddingLeft: 72, position: "relative", overflow: "hidden" }}>
                    닉네임
                    <AdminTableResizeHandle
                      ariaLabel={RECEIPT_COL_RESIZE_LABELS[0]!}
                      onMouseDown={(e) => startReceiptColResize(0, e.clientX)}
                    />
                  </th>
                  <th style={{ ...rThStyle, textAlign: "left", paddingLeft: 16, position: "relative", overflow: "hidden" }}>
                    UID
                    <AdminTableResizeHandle
                      ariaLabel={RECEIPT_COL_RESIZE_LABELS[1]!}
                      onMouseDown={(e) => startReceiptColResize(1, e.clientX)}
                    />
                  </th>
                  <th style={{ ...rThStyle, textAlign: "left", position: "relative", overflow: "hidden" }}>
                    아이템
                    <AdminTableResizeHandle
                      ariaLabel={RECEIPT_COL_RESIZE_LABELS[2]!}
                      onMouseDown={(e) => startReceiptColResize(2, e.clientX)}
                    />
                  </th>
                  <th style={{ ...rThStyle, textAlign: "center", position: "relative", overflow: "hidden" }}>
                    개수
                    <AdminTableResizeHandle
                      ariaLabel={RECEIPT_COL_RESIZE_LABELS[3]!}
                      onMouseDown={(e) => startReceiptColResize(3, e.clientX)}
                    />
                  </th>
                  <th style={{ ...rThStyle, textAlign: "center", paddingRight: 40 }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "52px 0", textAlign: "center", color: "#d1d5db", fontSize: 13 }}>
                      조회 결과가 없습니다.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    return (
                      <tr
                        key={r.uid}
                        style={{ borderBottom: "1px solid #f3f4f6" }}
                      >
                        <td
                          style={{
                            ...rTdStyle,
                            paddingLeft: 72,
                            fontWeight: 500,
                            color: "#111827",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={r.displayName}
                        >
                          {r.displayName || <span style={{ color: "#d1d5db" }}>—</span>}
                        </td>
                        <td
                          style={{
                            ...rTdStyle,
                            paddingLeft: 16,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={r.uid}
                        >
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#4b5563" }}>
                            {r.uid}
                          </span>
                        </td>
                        <td style={{ ...rTdStyle, color: "#4b5563", fontSize: 12 }}>
                          <div
                            title={rewardInlineText || "—"}
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: "100%",
                            }}
                          >
                            {rewardInlineText || "—"}
                          </div>
                        </td>
                        <td style={{ ...rTdStyle, textAlign: "center", color: "#4b5563", fontSize: 12 }}>
                          {rewardCountLabel}
                        </td>
                        <td style={{ ...rTdStyle, textAlign: "center", paddingRight: 40 }}>
                          <ReceiptStatusDot type={r.type} />
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
  verticalAlign: "middle",
  lineHeight: `${ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX}px`,
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
