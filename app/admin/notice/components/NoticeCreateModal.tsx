"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import DatePicker, { registerLocale } from "react-datepicker";
import { ko } from "date-fns/locale";
import { offset } from "@floating-ui/react";
import "react-datepicker/dist/react-datepicker.css";
import { storageAuthFetch as authFetch } from "@/lib/storage-auth-fetch";
import { signalNoticeChange } from "@/lib/firestore-notice-signal";
import { useAdminSession } from "@/app/admin/hooks/useAdminSession";
import type { NoticeDoc, NoticeLocaleEntry, NoticePostSchedule } from "@/app/api/admin/notices/route";
import { NOTICE_LANG_CATALOG } from "@/lib/notice-lang-display";
import { SCHEDULED_AT_DISPLAY_FORMAT } from "@/lib/format-scheduled-at-ko";

registerLocale("ko", ko);

const noticeScheduleDatePickerPopperModifiers = [offset({ mainAxis: 10, crossAxis: -48 })];

const MAX_BODY = 4000;
const MAX_LANGS = 10;

type LocaleRow = {
  id: string;
  language: string;
  title: string;
  content: string;
  imageKey: string;
  fallback: boolean;
};

function makeRow(language: string, fallback: boolean): LocaleRow {
  return {
    id: `${language}-${Math.random().toString(36).slice(2, 9)}`,
    language,
    title: "",
    content: "",
    imageKey: "",
    fallback,
  };
}

function scheduledEarliestAllowedDate(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 1, 0, 0);
  return d;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function clampScheduledDate(d: Date): Date {
  const floor = scheduledEarliestAllowedDate();
  const x = new Date(d);
  x.setSeconds(0, 0);
  if (x.getTime() < floor.getTime()) return new Date(floor);
  return x;
}

function initialScheduledAtDate(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 5, 0, 0);
  return clampScheduledDate(d);
}

function labelForLang(code: string): string {
  return NOTICE_LANG_CATALOG.find((l) => l.code === code)?.label ?? code;
}

/** 미리보기 탭 순서와 동일하게 정렬 */
function orderedLocaleRowsForEdit(contents: NoticeLocaleEntry[]): NoticeLocaleEntry[] {
  const list = contents ?? [];
  const fb = list.filter((c) => c.fallback);
  const rest = list.filter((c) => !c.fallback).sort((a, b) => a.language.localeCompare(b.language));
  return [...fb, ...rest];
}

/** 원격 수정 여부 비교용(열었을 때 스냅샷 vs 목록의 최신본) */
function noticeContentSig(n: NoticeDoc): string {
  const contents = orderedLocaleRowsForEdit(n.contents ?? []);
  return JSON.stringify({
    noticeTitle: n.noticeTitle,
    author: n.author,
    isPublic: n.isPublic,
    postSchedule: n.postSchedule,
    postingAt: n.postingAt,
    contents,
  });
}

type Props = {
  onClose: () => void;
  onCreated?: () => void | Promise<void>;
  /** 있으면 해당 공지를 PATCH로 수정 */
  editNotice?: NoticeDoc | null;
  /** 수정 중 목록에서 찾은 최신본(다른 기기에서 수정 반영 여부 판별) */
  listNotice?: NoticeDoc | null;
};

const NOTICE_CREATE_DRAFT_STORAGE_KEY = "admin-notice-create-draft-v1";

/** 예전 자동 저장 키 제거(등록 성공 시 등) */
export function clearNoticeCreateDraft() {
  try {
    localStorage.removeItem(NOTICE_CREATE_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function NoticeCreateModal({
  onClose,
  onCreated,
  editNotice = null,
  listNotice = null,
}: Props) {
  const { displayEmail, bootstrapped } = useAdminSession();
  const isEdit = editNotice != null;

  const authorDisplay = useMemo(() => {
    if (!displayEmail) return "운영자";
    const at = displayEmail.indexOf("@");
    if (at <= 0) return displayEmail;
    return displayEmail.slice(0, at);
  }, [displayEmail]);

  const [noticeName, setNoticeName] = useState("");
  const [postSchedule, setPostSchedule] = useState<NoticePostSchedule>("immediate");
  const [postingAtDate, setPostingAtDate] = useState<Date>(() => initialScheduledAtDate());
  const [rows, setRows] = useState<LocaleRow[]>(() => [makeRow("ko", true), makeRow("en", false)]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeRow = useMemo(() => {
    const first = rows[0];
    if (!first) return null;
    if (activeId) {
      const found = rows.find((r) => r.id === activeId);
      if (found) return found;
    }
    return first;
  }, [rows, activeId]);

  const [isPublic, setIsPublic] = useState(true);
  const [authorName, setAuthorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [listNewerThanOpen, setListNewerThanOpen] = useState(false);
  const editOpenedSigRef = useRef("");

  function hydrateFormFromNotice(n: NoticeDoc) {
    setNoticeName(n.noticeTitle);
    setPostSchedule(n.postSchedule);
    const at = new Date(n.postingAt);
    setPostingAtDate(n.postSchedule === "scheduled" ? clampScheduledDate(at) : at);
    setIsPublic(n.isPublic === "y");
    setAuthorName((n.author || "운영자").slice(0, 80));
    const ordered = orderedLocaleRowsForEdit(n.contents ?? []);
    if (ordered.length === 0) {
      setRows([makeRow("ko", true)]);
      setActiveId(null);
    } else {
      const nextRows: LocaleRow[] = ordered.map((c, i) => ({
        id: `edit-${c.language}-${i}`,
        language: c.language,
        title: c.title,
        content: c.content,
        imageKey: c.imageKey,
        fallback: c.fallback,
      }));
      setRows(nextRows);
      const fb = nextRows.find((r) => r.fallback);
      setActiveId(fb?.id ?? nextRows[0]?.id ?? null);
    }
  }

  useLayoutEffect(() => {
    if (!editNotice) return;
    hydrateFormFromNotice(editNotice);
    editOpenedSigRef.current = noticeContentSig(editNotice);
    setListNewerThanOpen(false);
  }, [editNotice?.uuid]);

  useEffect(() => {
    if (!isEdit || !listNotice) {
      setListNewerThanOpen(false);
      return;
    }
    if (noticeContentSig(listNotice) !== editOpenedSigRef.current) {
      setListNewerThanOpen(true);
    } else {
      setListNewerThanOpen(false);
    }
  }, [isEdit, listNotice]);

  useEffect(() => {
    if (postSchedule !== "scheduled") return;
    setPostingAtDate((prev) => clampScheduledDate(prev));
  }, [postSchedule]);

  const filterScheduledTime = useCallback((time: Date) => {
    return time.getTime() >= scheduledEarliestAllowedDate().getTime();
  }, []);

  const addableLangs = useMemo(
    () => NOTICE_LANG_CATALOG.filter((l) => !rows.some((r) => r.language === l.code)),
    [rows],
  );

  function setActiveField<K extends keyof LocaleRow>(id: string, key: K, value: LocaleRow[K]) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
  }

  function setFallbackFor(id: string) {
    setRows((prev) => prev.map((r) => ({ ...r, fallback: r.id === id })));
  }

  function removeRow(id: string) {
    setRows((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((r) => r.id !== id);
      const removed = prev.find((r) => r.id === id);
      if (removed?.fallback && next.length > 0) {
        next[0] = { ...next[0]!, fallback: true };
      }
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  function addLanguage(code: string) {
    if (rows.length >= MAX_LANGS) return;
    const row = makeRow(code, false);
    setRows((prev) => [...prev, row]);
    setActiveId(row.id);
  }

  const canSubmit = useMemo(() => {
    if (!noticeName.trim()) return false;
    if (rows.length === 0) return false;
    if (rows.filter((r) => r.fallback).length !== 1) return false;
    return rows.every((r) => r.title.trim() && r.content.trim());
  }, [noticeName, rows]);

  async function onPickImage(file: File | null) {
    if (!file || !activeRow) return;
    if (file.size > 1024 * 1024) {
      setError("이미지는 최대 1MB까지 업로드할 수 있습니다.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await authFetch("/api/admin/notices/upload-image", { method: "POST", body: form });
      const data = await res.json() as { ok: boolean; path?: string; error?: string };
      if (!data.ok || !data.path) throw new Error(data.error ?? "업로드 실패");
      setActiveField(activeRow.id, "imageKey", data.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  const handleSubmit = useCallback(async () => {
    setError(null);
    if (!canSubmit) return;
    if (postSchedule === "scheduled") {
      const floor = scheduledEarliestAllowedDate();
      if (postingAtDate.getTime() < floor.getTime()) {
        setError("예약 게시 시각은 현재 시각 이후(최소 1분 뒤)여야 합니다.");
        return;
      }
    }
    const postingIso =
      postSchedule === "scheduled" ? postingAtDate.toISOString() : new Date().toISOString();
    const author =
      isEdit
        ? authorName.trim() || "운영자"
        : authorDisplay;

    const payload: {
      uuid?: string;
      noticeTitle: string;
      author: string;
      isPublic: "y" | "n";
      postSchedule: NoticePostSchedule;
      postingAt: string;
      contents: NoticeLocaleEntry[];
    } = {
      noticeTitle: noticeName.trim(),
      author,
      isPublic: isPublic ? "y" : "n",
      postSchedule,
      postingAt: postingIso,
      contents: rows.map((r) => ({
        language: r.language,
        title: r.title.trim(),
        content: r.content,
        imageKey: r.imageKey.trim(),
        fallback: r.fallback,
      })),
    };
    if (isEdit && editNotice) {
      payload.uuid = editNotice.uuid;
    }

    setSubmitting(true);
    try {
      const res = await authFetch("/api/admin/notices", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? (isEdit ? "저장 실패" : "등록 실패"));
      void signalNoticeChange();
      if (!isEdit) clearNoticeCreateDraft();
      await Promise.resolve(onCreated?.());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit,
    postingAtDate,
    noticeName,
    authorDisplay,
    authorName,
    isEdit,
    editNotice,
    isPublic,
    postSchedule,
    rows,
    onCreated,
    onClose,
  ]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 125,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notice-create-modal-title"
        style={{
          width: "min(860px, calc(100vw - 24px))",
          height: "min(83vh, 970px)",
          maxHeight: "min(83vh, 970px)",
          display: "flex",
          flexDirection: "column",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
          }}
        >
          <h2
            id="notice-create-modal-title"
            style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}
          >
            {isEdit ? "공지 수정하기" : "공지 등록"}
          </h2>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="닫기"
            style={{
              border: "none",
              background: "transparent",
              cursor: submitting ? "not-allowed" : "pointer",
              color: "#64748b",
              fontSize: 24,
              lineHeight: 1,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {listNewerThanOpen && isEdit && listNotice && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 14px",
              background: "#fffbeb",
              borderBottom: "1px solid #fde68a",
              fontSize: 13,
              color: "#92400e",
              flexShrink: 0,
            }}
          >
            <span>다른 화면에서 이 공지가 수정되었습니다. 목록의 최신 내용으로 폼을 맞출 수 있습니다.</span>
            <button
              type="button"
              onClick={() => {
                hydrateFormFromNotice(listNotice);
                editOpenedSigRef.current = noticeContentSig(listNotice);
                setListNewerThanOpen(false);
              }}
              style={{
                flexShrink: 0,
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid #fbbf24",
                background: "#fff",
                fontSize: 12,
                fontWeight: 600,
                color: "#b45309",
                cursor: "pointer",
              }}
            >
              최신 반영
            </button>
          </div>
        )}

        {!bootstrapped ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 14,
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            인증 확인 중…
          </div>
        ) : (
          <>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <section
                style={{
                  flexShrink: 0,
                  padding: "10px 16px 12px",
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px 22px",
                    alignItems: "start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <MetaLabel>공지 이름</MetaLabel>
                    <input
                      type="text"
                      value={noticeName}
                      onChange={(e) => setNoticeName(e.target.value)}
                      placeholder="공지 이름을 입력하세요."
                      style={inputCompact}
                      maxLength={200}
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <MetaLabel>작성자</MetaLabel>
                    {isEdit ? (
                      <input
                        type="text"
                        value={authorName}
                        onChange={(e) => setAuthorName(e.target.value.slice(0, 80))}
                        placeholder="작성자"
                        style={inputCompact}
                        maxLength={80}
                      />
                    ) : (
                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          fontSize: 13,
                          color: "#334155",
                          fontWeight: 600,
                        }}
                      >
                        {authorDisplay}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <MetaLabel>게시일</MetaLabel>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <RadioChip compact active={postSchedule === "immediate"} onClick={() => setPostSchedule("immediate")}>
                        즉시 게시
                      </RadioChip>
                      <RadioChip compact active={postSchedule === "scheduled"} onClick={() => setPostSchedule("scheduled")}>
                        예약 게시
                      </RadioChip>
                    </div>
                  </div>
                  <div style={{ minWidth: 0, minHeight: 55 }}>
                    {postSchedule === "scheduled" ? (
                      <>
                        <MetaLabel>
                          게시 시각{" "}
                          <span style={{ color: "#94a3b8", fontWeight: 400 }}>(현재 시각 이후만 설정 가능)</span>
                        </MetaLabel>
                        <DatePicker
                          selected={postingAtDate}
                          onChange={(d: Date | null) => {
                            if (d) setPostingAtDate(clampScheduledDate(d));
                          }}
                          locale="ko"
                          showTimeSelect
                          timeIntervals={1}
                          dateFormat={SCHEDULED_AT_DISPLAY_FORMAT}
                          timeFormat="HH:mm"
                          timeCaption="시각"
                          minDate={startOfLocalDay(new Date())}
                          filterTime={filterScheduledTime}
                          popperPlacement="bottom-start"
                          popperModifiers={noticeScheduleDatePickerPopperModifiers}
                          showPopperArrow={false}
                          popperClassName="post-register-datepicker-popper"
                          wrapperClassName="post-register-datepicker-wrap"
                          className="post-register-datepicker-input"
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </section>

              <section
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    display: "grid",
                    gridTemplateColumns: "minmax(168px, 9fr) minmax(0, 33fr)",
                    overflow: "hidden",
                    alignItems: "stretch",
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      minHeight: 0,
                      overflowY: "auto",
                      borderRight: "1px solid #f1f5f9",
                      background: "#fafbfc",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 12px 6px",
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#64748b",
                        }}
                      >
                        <span>언어 ({rows.length}/{MAX_LANGS})</span>
                        <span title="언어는 최대 10개까지 추가할 수 있습니다." style={{ cursor: "help", color: "#94a3b8" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                          </svg>
                        </span>
                      </div>

                      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 10px" }}>
                        {rows.map((r) => {
                          const active = activeRow?.id === r.id;
                          return (
                            <div
                              key={r.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                marginBottom: 6,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveId(r.id);
                                }}
                                style={{
                                  flex: 1,
                                  textAlign: "left",
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: active ? "2px solid #2563eb" : "2px solid #e2e8f0",
                                  background: active ? "#eff6ff" : "#fff",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: active ? 700 : 500,
                                  color: active ? "#1d4ed8" : "#334155",
                                }}
                              >
                                <span>{labelForLang(r.language)}</span>
                              </button>
                              <button
                                type="button"
                                title="대표 언어로 지정"
                                onClick={() => setFallbackFor(r.id)}
                                style={{
                                  padding: "4px 6px",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  borderRadius: 8,
                                  border: r.fallback ? "1px solid #2563eb" : "1px solid #e2e8f0",
                                  background: r.fallback ? "#dbeafe" : "#fff",
                                  color: r.fallback ? "#1d4ed8" : "#64748b",
                                  cursor: "pointer",
                                }}
                              >
                                FB
                              </button>
                              <button
                                type="button"
                                title="언어 제거"
                                disabled={rows.length <= 1}
                                onClick={() => removeRow(r.id)}
                                style={{
                                  padding: 4,
                                  border: "none",
                                  background: "transparent",
                                  color: rows.length <= 1 ? "#e2e8f0" : "#94a3b8",
                                  cursor: rows.length <= 1 ? "not-allowed" : "pointer",
                                }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                                </svg>
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ padding: "0 8px 12px" }}>
                        <select
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) addLanguage(v);
                            e.target.value = "";
                          }}
                          disabled={addableLangs.length === 0 || rows.length >= MAX_LANGS}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #e2e8f0",
                            background: "#fff",
                            fontSize: 12,
                            color: addableLangs.length === 0 ? "#94a3b8" : "#334155",
                          }}
                        >
                          <option value="">언어를 추가하세요.</option>
                          {addableLangs.map((l) => (
                            <option key={l.code} value={l.code}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ minWidth: 0, minHeight: 0, overflowY: "auto", padding: "12px 16px 16px" }}>
                      {activeRow ? (
                        <>
                          <FieldLabel>제목</FieldLabel>
                          <input
                            type="text"
                            value={activeRow.title}
                            onChange={(e) => setActiveField(activeRow.id, "title", e.target.value)}
                            placeholder="공지 제목을 입력하세요."
                            style={inputFull}
                            maxLength={200}
                          />

                          <div style={{ height: 14 }} />

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <FieldLabel style={{ marginBottom: 0 }}>내용</FieldLabel>
                            <span style={{ fontSize: 12, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                              {activeRow.content.length} / {MAX_BODY}
                            </span>
                          </div>
                          <textarea
                            value={activeRow.content}
                            onChange={(e) => {
                              const t = e.target.value.slice(0, MAX_BODY);
                              setActiveField(activeRow.id, "content", t);
                            }}
                            placeholder="공지 내용을 입력하세요."
                            rows={14}
                            style={{
                              ...inputFull,
                              resize: "vertical",
                              minHeight: "clamp(192px, 38vh, 432px)",
                              lineHeight: 1.55,
                            }}
                          />

                          <div style={{ height: 16 }} />

                          <FieldLabel>이미지(선택)</FieldLabel>
                          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                            첨부 이미지는 한 장만 등록 가능합니다. (최대 1MB)
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                            <label
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 16px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                                background: uploading ? "#f1f5f9" : "#fff",
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#334155",
                                cursor: uploading ? "wait" : "pointer",
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                              </svg>
                              {uploading ? "업로드 중…" : "이미지 업로드"}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                disabled={uploading}
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  void onPickImage(e.target.files?.[0] ?? null);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {activeRow.imageKey ? (
                              <>
                                <span style={{ fontSize: 11, color: "#64748b", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
                                  {activeRow.imageKey}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setActiveField(activeRow.id, "imageKey", "")}
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#dc2626",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                  }}
                                >
                                  제거
                                </button>
                              </>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <p style={{ color: "#94a3b8", fontSize: 14 }}>언어를 선택하세요.</p>
                      )}
                    </div>
                  </div>
              </section>
            </div>

            <footer
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 14,
                padding: "14px 20px",
                borderTop: "1px solid #f1f5f9",
                background: "#fafbfc",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#334155" }}>공개여부</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPublic}
                  onClick={() => setIsPublic((v) => !v)}
                  style={{
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    border: "none",
                    background: isPublic ? "#2563eb" : "#cbd5e1",
                    cursor: "pointer",
                    position: "relative",
                    transition: "background 0.15s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 3,
                      left: isPublic ? 24 : 3,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      transition: "left 0.15s",
                    }}
                  />
                </button>
                <span style={{ fontSize: 13, color: isPublic ? "#059669" : "#64748b", fontWeight: 600 }}>
                  {isPublic ? "공개" : "비공개"}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {error && (
                  <span style={{ fontSize: 13, color: "#dc2626", maxWidth: 220 }}>{error}</span>
                )}
                <button
                  type="button"
                  disabled={submitting}
                  onClick={onClose}
                  style={{
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                    background: "#fff",
                    color: "#334155",
                    fontWeight: 600,
                    fontSize: 14,
                    cursor: submitting ? "not-allowed" : "pointer",
                  }}
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={!canSubmit || submitting}
                  onClick={() => void handleSubmit()}
                  style={{
                    padding: "10px 26px",
                    borderRadius: 10,
                    border: "none",
                    background: !canSubmit || submitting ? "#cbd5e1" : "#0f172a",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 14,
                    cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
                  }}
                >
                  {submitting ? (isEdit ? "저장 중…" : "등록 중…") : isEdit ? "저장하기" : "등록하기"}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function MetaLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>{children}</div>
  );
}

function FieldLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 8, ...style }}>
      {children}
    </div>
  );
}

function RadioChip({
  active,
  onClick,
  children,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: compact ? "5px 12px" : "8px 16px",
        borderRadius: 999,
        border: active ? "2px solid #0f172a" : "2px solid #e2e8f0",
        background: active ? "#0f172a" : "#fff",
        color: active ? "#fff" : "#64748b",
        fontWeight: 600,
        fontSize: compact ? 12 : 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const inputFull: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#fff",
  fontSize: 14,
  color: "#0f172a",
  outline: "none",
};

const inputCompact: CSSProperties = {
  ...inputFull,
  padding: "8px 11px",
  fontSize: 13,
};
