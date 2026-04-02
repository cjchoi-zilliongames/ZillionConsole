"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type CSVPreviewModalProps = {
  preview: { displayName: string; rows: string[][] } | null;
  loading: boolean;
  onClose: () => void;
};

const PREVIEW_COL_MIN = 56;
const PREVIEW_ROWNUM_MIN = 40;

export function CSVPreviewModal({ preview, loading, onClose }: CSVPreviewModalProps) {
  const [search, setSearch] = useState("");
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  /** [행번호, ...데이터열] px 너비 */
  const [colWidths, setColWidths] = useState<number[]>([]);
  const colWidthsRef = useRef<number[]>([]);
  colWidthsRef.current = colWidths;
  const previewSigRef = useRef("");
  const resizeRef = useRef<{ boundary: number; startX: number; startWidths: number[] } | null>(null);

  const headers = useMemo(() => preview?.rows[0] ?? [], [preview]);
  const dataRows = useMemo(() => preview?.rows.slice(1) ?? [], [preview]);
  const csvHeaderSig = useMemo(() => headers.join("\x1c"), [headers]);

  // 파일·헤더가 바뀌면 열 너비 초기화 (레이아웃 전에 맞춰 깜빡임 방지)
  useLayoutEffect(() => {
    if (!preview || headers.length === 0) {
      previewSigRef.current = "";
      setColWidths([]);
      return;
    }
    const sig = `${preview.displayName}\0${csvHeaderSig}`;
    if (sig === previewSigRef.current) return;
    previewSigRef.current = sig;
    const rowW = 44;
    const per = Math.max(96, Math.min(220, Math.floor(900 / headers.length)));
    setColWidths([rowW, ...Array(headers.length).fill(per)]);
  }, [preview, csvHeaderSig, headers.length]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = resizeRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      const w = [...drag.startWidths];
      const i = drag.boundary;
      const left = w[i]! + delta;
      const right = w[i + 1]! - delta;
      const minLeft = i === 0 ? PREVIEW_ROWNUM_MIN : PREVIEW_COL_MIN;
      const minRight = PREVIEW_COL_MIN;
      if (left < minLeft || right < minRight) return;
      w[i] = left;
      w[i + 1] = right;
      colWidthsRef.current = w;
      setColWidths(w);
    }
    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, []);

  function startResize(boundary: number, clientX: number) {
    const w = colWidthsRef.current;
    if (w.length < 2 || boundary < 0 || boundary >= w.length - 1) return;
    resizeRef.current = { boundary, startX: clientX, startWidths: [...w] };
    /* 드래그 중 전역 커서 — SpecFilesTable 열 조절과 동일 */
    /* eslint-disable react-hooks/immutability -- DOM cursor during drag */
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    /* eslint-enable react-hooks/immutability */
  }

  function resizeHandle(label: string, boundary: number) {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        title="열 너비 조절"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startResize(boundary, e.clientX); }}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          zIndex: 4,
          touchAction: "none",
          marginRight: -1,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(37,99,235,0.12)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      />
    );
  }

  // 모달에 다른 미리보기가 열릴 때 검색어·높이 초기화
  useEffect(() => {
    if (preview) {
      setSearch("");
      setLockedHeight(null);
    }
  }, [preview]);

  // 데이터 로드 완료 후 높이 고정
  useEffect(() => {
    if (!loading && preview && dialogRef.current && !lockedHeight) {
      setLockedHeight(dialogRef.current.offsetHeight);
    }
  }, [loading, preview, lockedHeight]);

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return dataRows;
    const q = search.toLowerCase();
    return dataRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)));
  }, [dataRows, search]);

  function downloadCSV() {
    if (!preview) return;
    const content = preview.rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = preview.displayName;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!preview) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 24 }}
      role="presentation"
      onClick={() => { if (!loading) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        ref={dialogRef}
        style={{ background: "#fff", borderRadius: 16, display: "flex", flexDirection: "column", width: "min(1440px, calc(92vw * 1.2), calc(100vw - 48px))", maxHeight: "min(calc(85vh * 1.2), calc(100vh - 48px))", minHeight: "min(calc(68vh * 1.2), 936px)", height: lockedHeight ?? undefined, boxShadow: "0 32px 80px rgba(0,0,0,0.32)", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, background: "#fafafa" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>📄</span>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>CSV 미리보기</div>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#0f172a", fontFamily: "ui-monospace, monospace" }}>{preview.displayName}</h2>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={downloadCSV}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #d1fae5", background: "#ecfdf5", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#059669" }}
              >
                ⬇ CSV 내려받기
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 600, fontSize: 13, cursor: "pointer", color: "#374151" }}
              >
                ✕ 닫기
              </button>
            </div>
          </div>

          {/* 검색바 */}
          {!loading && dataRows.length > 0 && (
            <div style={{ position: "relative" }}>
              <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                placeholder="검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                style={{ width: "100%", padding: "8px 12px 8px 32px", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box", background: "#fff", color: "#111827" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "#2563eb"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "#e5e7eb"; }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
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
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 336, height: "100%", gap: 12, color: "#6b7280", fontSize: 14 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid #e5e7eb", borderTopColor: "#2563eb", animation: "_spin 0.7s linear infinite" }} />
              불러오는 중…
            </div>
          ) : preview.rows.length === 0 ? (
            <div style={{ padding: 40, color: "#9ca3af", fontSize: 14, textAlign: "center" }}>데이터 없음</div>
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: 40, color: "#9ca3af", fontSize: 14, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span><strong style={{ color: "#374151" }}>&quot;{search}&quot;</strong>에 대한 결과 없음</span>
            </div>
          ) : colWidths.length === 1 + headers.length ? (
            <table
              style={{
                width: colWidths.reduce((a, b) => a + b, 0),
                minWidth: "100%",
                tableLayout: "fixed",
                borderCollapse: "collapse",
                fontSize: 13,
                borderSpacing: 0,
              }}
            >
              <colgroup>
                {colWidths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ background: "#f1f5f9", position: "sticky", top: 0, zIndex: 2 }}>
                  <th
                    style={{
                      padding: "10px 10px",
                      textAlign: "center",
                      fontWeight: 600,
                      color: "#94a3b8",
                      borderBottom: "2px solid #e2e8f0",
                      borderRight: "1px solid #e2e8f0",
                      whiteSpace: "nowrap",
                      fontSize: 11,
                      background: "#f1f5f9",
                      position: "relative",
                      boxSizing: "border-box",
                      overflow: "hidden",
                    }}
                  >
                    #
                    {resizeHandle("행 번호 열과 첫 데이터 열 사이 너비 조절", 0)}
                  </th>
                  {headers.map((cell, ci) => (
                    <th
                      key={ci}
                      onMouseEnter={() => setHoveredCol(ci)}
                      onMouseLeave={() => setHoveredCol(null)}
                      style={{
                        padding: "10px 14px",
                        textAlign: "left",
                        fontWeight: 700,
                        color: hoveredCol === ci ? "#2563eb" : "#374151",
                        borderBottom: "2px solid #e2e8f0",
                        borderRight: ci === headers.length - 1 ? "none" : "1px solid #e2e8f0",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        letterSpacing: "0.03em",
                        background: hoveredCol === ci ? "#eff6ff" : "#f1f5f9",
                        cursor: "default",
                        transition: "background 0.1s, color 0.1s",
                        userSelect: "none",
                        position: "relative",
                        boxSizing: "border-box",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {cell}
                      {ci < headers.length - 1 ? resizeHandle(`열 "${cell}"과 다음 열 사이 너비 조절`, ci + 1) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, ri) => (
                  <tr
                    key={ri}
                    style={{ background: ri % 2 === 0 ? "#fff" : "#f8fafc" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "#eff6ff"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ri % 2 === 0 ? "#fff" : "#f8fafc"; }}
                  >
                    <td
                      style={{
                        padding: "7px 10px",
                        borderBottom: "1px solid #f1f5f9",
                        borderRight: "1px solid #f1f5f9",
                        color: "#cbd5e1",
                        fontSize: 11,
                        textAlign: "center",
                        userSelect: "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        boxSizing: "border-box",
                      }}
                    >
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
                          color: "#1f2937",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          background: hoveredCol === ci ? "#f0f7ff" : "transparent",
                          transition: "background 0.1s",
                          boxSizing: "border-box",
                        }}
                      >
                        {search.trim() ? <HighlightCell text={cell} query={search} /> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>

        {/* 푸터 */}
        {!loading && preview.rows.length > 0 && (
          <div style={{ padding: "9px 20px", borderTop: "1px solid #e5e7eb", fontSize: 12, color: "#94a3b8", flexShrink: 0, display: "flex", gap: 16, background: "#fafafa" }}>
            <span>전체 <strong style={{ color: "#374151" }}>{dataRows.length}</strong>행</span>
            <span>표시 <strong style={{ color: "#2563eb" }}>{filteredRows.length}</strong>행</span>
            <span><strong style={{ color: "#374151" }}>{headers.length}</strong>열</span>
            {search && <span style={{ color: "#f59e0b" }}>🔍 &quot;{search}&quot; 검색 중</span>}
          </div>
        )}
      </div>
    </div>
  );
}

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
