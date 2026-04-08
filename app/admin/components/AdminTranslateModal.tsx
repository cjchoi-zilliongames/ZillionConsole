"use client";

import { useState, useCallback } from "react";
import { storageAuthFetch as authFetch } from "@/lib/storage-auth-fetch";
import { TRANSLATE_LANG_OPTIONS, recommendTranslateLangForRegion } from "@/lib/region-catalog";

type Props = {
  /** API 맥락용 — 현재 편집 중인 지역 탭 */
  regionCode: string;
  maxContentLength: number;
  onClose: () => void;
  getFields: () => { title: string; content: string; third: string };
  onApply: (fields: { title: string; content: string; third: string }) => void;
};

export function AdminTranslateModal({
  regionCode,
  maxContentLength,
  onClose,
  getFields,
  onApply,
}: Props) {
  const [targetLang, setTargetLang] = useState<string>(() => recommendTranslateLangForRegion(regionCode));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [skipMsg, setSkipMsg] = useState<string | null>(null);

  const run = useCallback(async () => {
    const f = getFields();
    if (!f.title.trim() && !f.content.trim()) {
      setErr("제목 또는 내용을 먼저 입력하세요.");
      return;
    }
    setErr(null);
    setSkipMsg(null);
    setBusy(true);
    try {
      const res = await authFetch("/api/admin/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceLang: "auto",
          sourceTitle: f.title,
          sourceContent: f.content,
          sourceSender: f.third,
          targetLang,
          sourceRegionCode: regionCode,
          targetRegionCode: regionCode,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        skipped?: boolean;
        message?: string;
        title?: string;
        content?: string;
        sender?: string;
        error?: string;
      };
      if (!data.ok) {
        setErr(data.error ?? "번역 요청 실패");
        return;
      }
      if (data.skipped) {
        setSkipMsg(data.message ?? "번역할 필요가 없습니다.");
        return;
      }
      onApply({
        title: data.title ?? "",
        content: (data.content ?? "").slice(0, maxContentLength),
        third: data.sender ?? "",
      });
      onClose();
    } catch {
      setErr("네트워크 오류");
    } finally {
      setBusy(false);
    }
  }, [getFields, targetLang, maxContentLength, regionCode, onApply, onClose]);

  const fPreview = getFields();
  const canRun = !!(fPreview.title.trim() || fPreview.content.trim());

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI 번역"
        style={{
          background: "#fff",
          borderRadius: 12,
          width: "min(320px, 100%)",
          padding: "18px 20px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <label htmlFor="admin-translate-lang" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>
          번역할 언어
        </label>
        <select
          id="admin-translate-lang"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          disabled={busy}
          style={{
            width: "100%",
            marginBottom: 12,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: 13,
          }}
        >
          {TRANSLATE_LANG_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>

        {err && <div style={{ marginBottom: 10, fontSize: 12, color: "#dc2626" }}>{err}</div>}
        {skipMsg && <div style={{ marginBottom: 10, fontSize: 12, color: "#b45309" }}>{skipMsg}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              fontWeight: 600,
              fontSize: 13,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy || !canRun}
            onClick={() => void run()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: busy || !canRun ? "#cbd5e1" : "#0f172a",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: busy || !canRun ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "번역 중…" : "번역"}
          </button>
        </div>
      </div>
    </div>
  );
}
