"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ChartMemos } from "@/lib/spec/chart-memos";
import type { InventoryFile } from "../hooks/useInventory";

type FileGroup = { displayName: string; versions: InventoryFile[] };

const COL_MIN = { select: 40, name: 100, version: 88 };

/** 차트 목록 선택 열 — 크기는 `globals.css` `.spec-files-table-checkbox` */
const SPEC_FILES_TABLE_CHECKBOX_CLASSNAME = "spec-files-table-checkbox";

/** 목록·드롭다운 공통 표기: `ver.` 접두 + 번호 */
function chartVersionText(n: number) {
  return `ver.${n}`;
}

/** 단일 배지·버전 드롭다운 동일 외곽(높이·테두리·배경) */
const CHART_VER_CONTROL_OUTER: CSSProperties = {
  boxSizing: "border-box",
  minHeight: 32,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.9)",
};

type SpecFilesTableProps = {
  fileGroupsInFolder: FileGroup[];
  selectedPaths: Set<string>;
  activePathByDisplay: Record<string, string>;
  setActivePathByDisplay: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  allVisibleSelected: boolean;
  toggleSelectAllVisible: () => void;
  /** 같은 행(차트)에 속한 모든 버전 파일 경로를 함께 선택/해제 */
  toggleGroup: (versions: InventoryFile[]) => void;
  chartMemos: ChartMemos;
  editingMemoKey: string | null;
  editingMemoValue: string;
  setEditingMemoKey: (key: string | null) => void;
  setEditingMemoValue: (val: string) => void;
  onSaveMemo: (key: string, val: string) => void;
  folderNames: Record<string, string>;
  onCsvPreview: (file: InventoryFile) => void;
  onRowContextMenu: (file: InventoryFile, x: number, y: number) => void;
};

export function SpecFilesTable({
  fileGroupsInFolder, selectedPaths, activePathByDisplay, setActivePathByDisplay,
  allVisibleSelected, toggleSelectAllVisible, toggleGroup,
  chartMemos,
  editingMemoKey, editingMemoValue, setEditingMemoKey, setEditingMemoValue,
  onSaveMemo, folderNames, onCsvPreview, onRowContextMenu,
}: SpecFilesTableProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  /** Escape로 편집 취소 시 이어지는 blur에서 저장하지 않도록 함 */
  const skipMemoBlurSaveRef = useRef(false);
  /** 편집 시작 시점 저장값 — blur 시 내용 동일하면 onSaveMemo 호출 안 함(캔슬·무변경) */
  const memoEditBaselineRef = useRef("");
  /** 메모 없을 때만 "메모 추가…" 힌트를 호버 시 표시 */
  const [hoveredMemoKey, setHoveredMemoKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [nameHeaderHovered, setNameHeaderHovered] = useState(false);
  /** CSV 미리보기 표와 동일: 열·행 호버 */
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  const sortedGroups = useMemo(() => {
    if (sortDir === "asc") return fileGroupsInFolder;
    return [...fileGroupsInFolder].sort((a, b) => b.displayName.localeCompare(a.displayName));
  }, [fileGroupsInFolder, sortDir]);
  const [colWidths, setColWidths] = useState(() => {
    try {
      const raw = localStorage.getItem("spec_csv_col_widths");
      const j = raw ? (JSON.parse(raw) as { s?: unknown; n?: unknown; v?: unknown }) : {};
      return {
        select: typeof j.s === "number" && j.s >= COL_MIN.select ? j.s : 52,
        name: typeof j.n === "number" && j.n >= COL_MIN.name ? j.n : 280,
        version: typeof j.v === "number" && j.v >= COL_MIN.version ? j.v : 100,
      };
    } catch {
      return { select: 52, name: 280, version: 100 };
    }
  });
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;
  const resizeRef = useRef<{
    kind: 0 | 1 | 2;
    startX: number;
    startSelect: number;
    startName: number;
    startVersion: number;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(w);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /** 컨테이너보다 넓을 때 비례 축소한 표시용 열 너비 */
  const displayedColWidths = useMemo(() => {
    if (!containerWidth) return colWidths;
    const { select, name, version } = colWidths;
    const fixedTotal = select + name + version;
    const minMemo = 120;
    const available = containerWidth - minMemo;
    if (fixedTotal <= available) return colWidths;
    const ratio = Math.max(0, available) / fixedTotal;
    const newSelect = Math.max(COL_MIN.select, Math.round(select * ratio));
    const newVersion = Math.max(COL_MIN.version, Math.round(version * ratio));
    const newName = Math.max(COL_MIN.name, Math.round(name * ratio));
    return { select: newSelect, name: newName, version: newVersion };
  }, [colWidths, containerWidth]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = resizeRef.current;
      if (!drag) return;
      const innerW = wrapRef.current ? wrapRef.current.clientWidth - 6 : 800;
      const delta = e.clientX - drag.startX;
      if (drag.kind === 0) {
        let sel = drag.startSelect + delta;
        const maxSel = drag.startSelect + drag.startName - COL_MIN.name;
        sel = Math.max(COL_MIN.select, Math.min(sel, maxSel));
        const nam = drag.startSelect + drag.startName - sel;
        const next = { ...colWidthsRef.current, select: sel, name: nam };
        colWidthsRef.current = next;
        setColWidths(next);
      } else if (drag.kind === 1) {
        const sel = colWidthsRef.current.select;
        const maxName = Math.max(COL_MIN.name, innerW - sel - COL_MIN.version);
        let nam = drag.startName + delta;
        nam = Math.max(COL_MIN.name, Math.min(nam, maxName));
        const next = { ...colWidthsRef.current, name: nam };
        colWidthsRef.current = next;
        setColWidths(next);
      } else {
        let ver = drag.startVersion + delta;
        ver = Math.max(COL_MIN.version, ver);
        const next = { ...colWidthsRef.current, version: ver };
        colWidthsRef.current = next;
        setColWidths(next);
      }
    }
    function onUp() {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        const { select, name, version } = colWidthsRef.current;
        localStorage.setItem("spec_csv_col_widths", JSON.stringify({ s: select, n: name, v: version }));
      } catch { /* ignore */ }
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

  function startResize(kind: 0 | 1 | 2, clientX: number) {
    const w = colWidthsRef.current;
    resizeRef.current = { kind, startX: clientX, startSelect: w.select, startName: w.name, startVersion: w.version };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const resizeHandle = (label: string, kind: 0 | 1 | 2) => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="열 너비 조절"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); startResize(kind, e.clientX); }}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 2, touchAction: "none", marginRight: -1 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(37,99,235,0.12)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    />
  );

  const thPreview = (col: number, extra: CSSProperties = {}) => ({
    background: hoveredCol === col ? "#eff6ff" : "#f1f5f9",
    borderBottom: "2px solid #e2e8f0",
    borderRight: "1px solid #e2e8f0",
    transition: "background 0.1s, color 0.1s" as const,
    ...extra,
  });

  const tdPreview = (col: number, extra: CSSProperties = {}) => ({
    padding: col === 0 ? "7px 10px" : "7px 14px",
    borderBottom: "1px solid #f1f5f9",
    borderRight: "1px solid #f1f5f9",
    verticalAlign: "middle" as const,
    boxSizing: "border-box" as const,
    background: hoveredCol === col ? "#f0f7ff" : ("transparent" as const),
    transition: "background 0.1s" as const,
    ...extra,
  });

  return (
    <>
      <style>{`
        .spec-chart-ver-select {
          appearance: none;
          -webkit-appearance: none;
          -moz-appearance: none;
          cursor: pointer;
        }
        .spec-chart-ver-select:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2), 0 1px 2px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,0.9);
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }
        .spec-chart-ver-select:hover:not(:focus) {
          border-color: #cbd5e1;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
        }
      `}</style>
      <div ref={wrapRef} style={{ display: "flex", flexDirection: "column", minWidth: 0, background: "#fff", boxSizing: "border-box" }}>
      <table
        aria-label={fileGroupsInFolder.length === 0 ? "스펙 CSV 없음 — 빈 표" : "스펙 CSV 목록"}
        style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13, borderSpacing: 0 }}
      >
        <colgroup>
          <col style={{ width: `${displayedColWidths.select}px` }} />
          <col style={{ width: `${displayedColWidths.name}px` }} />
          <col style={{ width: `${displayedColWidths.version}px` }} />
          <col />
        </colgroup>
        <thead>
          <tr style={{ background: "#f1f5f9", position: "sticky", top: 0, zIndex: 3 }}>
            <th
              style={{
                ...thPreview(0, {
                  padding: "10px 10px",
                  textAlign: "center",
                  position: "relative",
                  color: "#94a3b8",
                  fontWeight: 600,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }),
              }}
              onMouseEnter={() => setHoveredCol(0)}
              onMouseLeave={() => setHoveredCol(null)}
            >
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                title="전체 선택"
                aria-label="전체 선택"
                className={SPEC_FILES_TABLE_CHECKBOX_CLASSNAME}
              />
              {resizeHandle("선택 열과 이름 열 사이 너비 조절", 0)}
            </th>
            <th
              style={{
                ...thPreview(1, {
                  textAlign: "left",
                  padding: "10px 14px",
                  color: hoveredCol === 1 ? "#2563eb" : "#374151",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.03em",
                  position: "relative",
                  overflow: "hidden",
                  cursor: "pointer",
                  userSelect: "none",
                }),
              }}
              onMouseEnter={() => { setHoveredCol(1); setNameHeaderHovered(true); }}
              onMouseLeave={() => { setHoveredCol(null); setNameHeaderHovered(false); }}
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            >
              <div style={{ display: "flex", alignItems: "center", paddingRight: 14 }}>
                <span style={{ flex: 1 }}>차트명</span>
                <span style={{ color: "#9ca3af", display: "flex", alignItems: "center", lineHeight: 1, flexShrink: 0, opacity: nameHeaderHovered ? 1 : 0, transition: "opacity 0.15s" }}>
                  {sortDir === "desc" ? (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ transform: "scaleX(-1)" }}>
                      <line x1="1" y1="3" x2="11" y2="3" /><line x1="1" y1="6" x2="8" y2="6" /><line x1="1" y1="9" x2="5" y2="9" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ transform: "scaleX(-1)" }}>
                      <line x1="1" y1="3" x2="5" y2="3" /><line x1="1" y1="6" x2="8" y2="6" /><line x1="1" y1="9" x2="11" y2="9" />
                    </svg>
                  )}
                </span>
              </div>
              {resizeHandle("차트명 열과 버전 열 사이 너비 조절", 1)}
            </th>
            <th
              style={{
                ...thPreview(2, {
                  textAlign: "left",
                  padding: "10px 14px",
                  color: hoveredCol === 2 ? "#2563eb" : "#374151",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.03em",
                  position: "relative",
                  overflow: "hidden",
                }),
              }}
              onMouseEnter={() => setHoveredCol(2)}
              onMouseLeave={() => setHoveredCol(null)}
            >
              버전
              {resizeHandle("버전 열과 차트 메모 열 사이 너비 조절", 2)}
            </th>
            <th
              style={{
                ...thPreview(3, {
                  textAlign: "left",
                  padding: "10px 14px",
                  color: hoveredCol === 3 ? "#2563eb" : "#374151",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.03em",
                  borderRight: "none",
                }),
              }}
              onMouseEnter={() => setHoveredCol(3)}
              onMouseLeave={() => setHoveredCol(null)}
            >
              차트 메모
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedGroups.map((g, ri) => {
            const activePath = activePathByDisplay[g.displayName] ?? g.versions[g.versions.length - 1]!.fullPath;
            const activeFile = g.versions.find((v) => v.fullPath === activePath) ?? g.versions[g.versions.length - 1]!;
            const memoKey = activeFile.fullPath;
            const rowBg = hoveredRow === ri ? "#eff6ff" : ri % 2 === 0 ? "#fff" : "#f8fafc";
            return (
              <tr
                key={g.displayName}
                style={{ background: rowBg }}
                onMouseEnter={() => setHoveredRow(ri)}
                onMouseLeave={() => setHoveredRow(null)}
                onContextMenu={(e) => { e.preventDefault(); onRowContextMenu(activeFile, e.clientX, e.clientY); }}
              >
                <td style={{ ...tdPreview(0, { overflow: "hidden", textAlign: "center" }) }}>
                  <input
                    type="checkbox"
                    checked={g.versions.length > 0 && g.versions.every((v) => selectedPaths.has(v.fullPath))}
                    onChange={() => toggleGroup(g.versions)}
                    aria-label={`선택 ${g.displayName}`}
                    className={SPEC_FILES_TABLE_CHECKBOX_CLASSNAME}
                  />
                </td>
                <td
                  title={g.displayName}
                  style={{ ...tdPreview(1, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", fontWeight: 600, color: "#1d4ed8" }) }}
                  onClick={() => onCsvPreview(activeFile)}
                >
                  {g.displayName}
                </td>
                <td style={{ ...tdPreview(2, { overflow: "hidden" }) }}>
                  {g.versions.length === 1 ? (
                    <span
                      title={chartVersionText(g.versions[0]!.version)}
                      style={{
                        ...CHART_VER_CONTROL_OUTER,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                        padding: "5px 11px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#94a3b8",
                          letterSpacing: "0.04em",
                          fontFamily: "system-ui, Segoe UI, sans-serif",
                          lineHeight: "20px",
                        }}
                      >
                        ver.
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          fontVariantNumeric: "tabular-nums",
                          color: "#0f172a",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                          letterSpacing: "-0.03em",
                          lineHeight: "20px",
                        }}
                      >
                        {g.versions[0]!.version}
                      </span>
                    </span>
                  ) : (
                    <div style={{ position: "relative", width: "100%", maxWidth: "100%" }}>
                      <select
                        className="spec-chart-ver-select"
                        value={activeFile.fullPath}
                        onChange={(e) => {
                          e.stopPropagation();
                          setActivePathByDisplay((prev) => ({ ...prev, [g.displayName]: e.target.value }));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        aria-label={`${g.displayName} 버전 선택`}
                        style={{
                          ...CHART_VER_CONTROL_OUTER,
                          width: "100%",
                          maxWidth: "100%",
                          padding: "5px 30px 5px 11px",
                          color: "#0f172a",
                          fontSize: 13,
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                          letterSpacing: "-0.02em",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                          lineHeight: "20px",
                        }}
                      >
                        {g.versions.map((v) => (
                          <option key={v.fullPath} value={v.fullPath}>
                            {chartVersionText(v.version)}
                          </option>
                        ))}
                      </select>
                      <span
                        aria-hidden
                        style={{
                          position: "absolute",
                          right: 9,
                          top: "50%",
                          transform: "translateY(-50%)",
                          pointerEvents: "none",
                          color: "#64748b",
                          display: "flex",
                          alignItems: "center",
                          lineHeight: 0,
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 4.5L6 7.5L9 4.5" />
                        </svg>
                      </span>
                    </div>
                  )}
                </td>
                <td
                  style={{ ...tdPreview(3, { borderRight: "none" }) }}
                  onClick={() => {
                    const baseline = chartMemos[memoKey] ?? "";
                    memoEditBaselineRef.current = baseline;
                    setEditingMemoKey(memoKey);
                    setEditingMemoValue(baseline);
                  }}
                  onMouseEnter={() => setHoveredMemoKey(memoKey)}
                  onMouseLeave={() => setHoveredMemoKey(null)}
                >
                  {editingMemoKey === memoKey ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingMemoValue}
                      onChange={(e) => setEditingMemoValue(e.target.value)}
                      onBlur={(e) => {
                        if (skipMemoBlurSaveRef.current) {
                          skipMemoBlurSaveRef.current = false;
                          return;
                        }
                        const next = e.currentTarget.value.trim();
                        const base = memoEditBaselineRef.current.trim();
                        if (next === base) {
                          setEditingMemoKey(null);
                          return;
                        }
                        onSaveMemo(memoKey, e.currentTarget.value);
                        setEditingMemoKey(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") {
                          e.preventDefault();
                          skipMemoBlurSaveRef.current = true;
                          setEditingMemoKey(null);
                        }
                      }}
                      style={{ width: "100%", boxSizing: "border-box", border: "1px solid #93c5fd", borderRadius: 6, padding: "4px 8px", fontSize: 13, outline: "none", background: "#eff6ff" }}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: 13,
                        color: chartMemos[memoKey] ? "#374151" : "#9ca3af",
                        cursor: "text",
                        display: "block",
                        minHeight: 22,
                        padding: "2px 4px",
                        borderRadius: 4,
                        opacity: chartMemos[memoKey] ? 1 : hoveredMemoKey === memoKey ? 1 : 0,
                      }}
                    >
                      {chartMemos[memoKey] ?? "메모 추가…"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
