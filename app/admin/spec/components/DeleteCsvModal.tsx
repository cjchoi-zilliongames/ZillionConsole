"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { StorageService } from "../hooks/useStorageService";
import type { InventoryFile } from "../hooks/useInventory";

type GroupRowState = {
  displayName: string;
  files: InventoryFile[];
  status: "pending" | "deleting" | "done" | "error";
  progress: number;
  error?: string;
};

type DeleteCsvModalProps = {
  files: InventoryFile[];
  service: StorageService;
  onClose: () => void;
  onInventoryRefresh: () => Promise<void>;
  onSuccess?: (info: { count: number }) => void;
  onBusyChange?: (busy: boolean) => void;
};

const HP_TRANSITION = "width 0.22s cubic-bezier(0.33, 1, 0.68, 1), background 0.45s ease, box-shadow 0.45s ease";

function hpFillStyle(row: GroupRowState, batchDeletingWidth: number): CSSProperties {
  const w =
    row.status === "done"
      ? 100
      : row.status === "error"
        ? Math.max(row.progress, 18)
        : row.status === "deleting"
          ? batchDeletingWidth
          : row.progress;
  if (row.status === "done") {
    return {
      width: `${w}%`,
      background: "linear-gradient(90deg, #15803d 0%, #22c55e 55%, #4ade80 100%)",
      boxShadow: "0 0 12px rgba(34, 197, 94, 0.45)",
      transition: HP_TRANSITION,
    };
  }
  if (row.status === "error") {
    return {
      width: `${w}%`,
      background: "linear-gradient(90deg, #dc2626, #f87171)",
      boxShadow: "0 0 8px rgba(248, 113, 113, 0.4)",
      transition: HP_TRANSITION,
    };
  }
  if (row.status === "deleting") {
    return {
      width: `${w}%`,
      background: "linear-gradient(90deg, #1d4ed8 0%, #3b82f6 45%, #60a5fa 100%)",
      boxShadow: "0 0 10px rgba(59, 130, 246, 0.35)",
      transition: HP_TRANSITION,
    };
  }
  return {
    width: `${w}%`,
    background: "#cbd5e1",
    transition: HP_TRANSITION,
  };
}

function groupFilesByDisplayName(files: InventoryFile[]): { displayName: string; versions: InventoryFile[] }[] {
  const map = new Map<string, InventoryFile[]>();
  for (const f of files) {
    const arr = map.get(f.displayName) ?? [];
    arr.push(f);
    map.set(f.displayName, arr);
  }
  const groups = [...map.entries()].map(([displayName, versions]) => ({
    displayName,
    versions: [...versions].sort((a, b) => a.version - b.version),
  }));
  groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return groups;
}

export function DeleteCsvModal({
  files,
  service,
  onClose,
  onInventoryRefresh,
  onSuccess,
  onBusyChange,
}: DeleteCsvModalProps) {
  const groupedFiles = useMemo(() => groupFilesByDisplayName(files), [files]);

  const [groupRows, setGroupRows] = useState<GroupRowState[]>(() =>
    groupFilesByDisplayName(files).map((g) => ({
      displayName: g.displayName,
      files: g.versions,
      status: "pending" as const,
      progress: 0,
    }))
  );
  /** 차트별: 전체 삭제(all) vs 버전 체크(select) */
  const [groupModes, setGroupModes] = useState<Record<string, "all" | "select">>({});
  /** 선택삭제 모드에서 삭제할 버전 fullPath */
  const [selectChecked, setSelectChecked] = useState<Record<string, Set<string>>>({});

  const [deleting, setDeleting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const batchProgressRef = useRef(0);
  const batchTickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setGroupRows(
      groupedFiles.map((g) => ({
        displayName: g.displayName,
        files: g.versions,
        status: "pending",
        progress: 0,
      }))
    );
    setGroupModes({});
    const initialChecked: Record<string, Set<string>> = {};
    for (const g of groupedFiles) {
      initialChecked[g.displayName] = new Set(g.versions.map((v) => v.fullPath));
    }
    setSelectChecked(initialChecked);
  }, [groupedFiles]);

  const totalDeleteCount = useMemo(() => {
    let n = 0;
    for (const g of groupedFiles) {
      const mode = groupModes[g.displayName] ?? "all";
      if (mode === "all") {
        n += g.versions.length;
      } else {
        const chk = selectChecked[g.displayName];
        if (chk) n += g.versions.filter((v) => chk.has(v.fullPath)).length;
      }
    }
    return n;
  }, [groupedFiles, groupModes, selectChecked]);

  function getMode(displayName: string): "all" | "select" {
    return groupModes[displayName] ?? "all";
  }

  function setMode(displayName: string, mode: "all" | "select") {
    setGroupModes((prev) => ({ ...prev, [displayName]: mode }));
    if (mode === "select") {
      const g = groupedFiles.find((x) => x.displayName === displayName);
      if (g) {
        setSelectChecked((prev) => ({
          ...prev,
          [displayName]: new Set(g.versions.map((v) => v.fullPath)),
        }));
      }
    }
  }

  function toggleVersionCheck(displayName: string, fullPath: string) {
    setSelectChecked((prev) => {
      const g = groupedFiles.find((x) => x.displayName === displayName);
      if (!g) return prev;
      const cur = new Set(prev[displayName] ?? []);
      if (cur.has(fullPath)) cur.delete(fullPath);
      else cur.add(fullPath);
      return { ...prev, [displayName]: cur };
    });
  }

  useEffect(() => {
    onBusyChange?.(deleting || finishing);
  }, [deleting, finishing, onBusyChange]);

  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  useEffect(() => {
    if (!deleting && !finishing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [deleting, finishing]);

  useEffect(() => {
    return () => {
      if (batchTickerRef.current) {
        clearInterval(batchTickerRef.current);
        batchTickerRef.current = null;
      }
    };
  }, []);

  function stopBatchTicker() {
    if (batchTickerRef.current) {
      clearInterval(batchTickerRef.current);
      batchTickerRef.current = null;
    }
  }

  function startBatchTicker() {
    stopBatchTicker();
    const CAP = 88;
    const STEP = 1.75;
    const TICK_MS = 100;
    batchTickerRef.current = setInterval(() => {
      setBatchProgress((p) => {
        const next = Math.min(p + STEP, CAP);
        batchProgressRef.current = next;
        return next;
      });
    }, TICK_MS);
  }

  function buildPathsToDelete(): string[] {
    const paths: string[] = [];
    for (const g of groupedFiles) {
      const mode = groupModes[g.displayName] ?? "all";
      if (mode === "all") {
        for (const v of g.versions) paths.push(v.fullPath);
      } else {
        const chk = selectChecked[g.displayName];
        if (!chk) continue;
        for (const v of g.versions) {
          if (chk.has(v.fullPath)) paths.push(v.fullPath);
        }
      }
    }
    return paths;
  }

  async function runDelete() {
    if (deleting || finishing || groupRows.length === 0) return;
    const paths = buildPathsToDelete();
    if (paths.length === 0) return;

    const pathSet = new Set(paths);

    setDeleting(true);
    batchProgressRef.current = 4;
    setBatchProgress(4);
    startBatchTicker();
    setGroupRows((prev) =>
      prev.map((r) => ({
        ...r,
        status: r.files.some((f) => pathSet.has(f.fullPath)) ? ("deleting" as const) : r.status,
        progress: r.files.some((f) => pathSet.has(f.fullPath)) ? 0 : r.progress,
      }))
    );

    const msg = (e: unknown) => (e instanceof Error ? e.message : "삭제 실패");

    try {
      await service.deleteFiles(paths);
    } catch (e) {
      stopBatchTicker();
      const m = msg(e);
      const pw = Math.min(batchProgressRef.current, 55);
      setGroupRows((prev) =>
        prev.map((r) =>
          r.files.some((f) => pathSet.has(f.fullPath))
            ? { ...r, status: "error", error: m, progress: pw }
            : r
        )
      );
      setDeleting(false);
      return;
    }

    stopBatchTicker();
    setGroupRows((prev) =>
      prev.map((r) =>
        r.files.some((f) => pathSet.has(f.fullPath)) ? { ...r, status: "done", progress: 100 } : r
      )
    );
    await new Promise((r) => setTimeout(r, 280));

    setDeleting(false);
    setFinishing(true);
    const n = paths.length;
    try {
      await onInventoryRefresh();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 420));
    onClose();
    onSuccess?.({ count: n });
  }

  const blocked = deleting || finishing;
  const hasErrorRow = groupRows.some((r) => r.status === "error");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 110,
        padding: 16,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-chart-modal-title"
        aria-busy={blocked}
        style={{
          position: "relative",
          overflow: "hidden",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 24px 64px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)",
          width: "100%",
          maxWidth: 560,
          padding: "26px 26px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="delete-chart-modal-title" style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "#0f172a", letterSpacing: "-0.02em" }}>
            차트 삭제
          </h2>
          <button
            type="button"
            disabled={blocked}
            title={blocked ? "삭제·목록 반영이 끝날 때까지 닫을 수 없어요" : "닫기"}
            onClick={() => onClose()}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
              borderRadius: 8,
              cursor: blocked ? "not-allowed" : "pointer",
              color: blocked ? "#cbd5e1" : "#94a3b8",
              opacity: blocked ? 0.55 : 1,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxHeight: 320,
            overflowY: "auto",
            paddingRight: 2,
            borderRadius: 14,
          }}
        >
          {groupRows.map((row) => {
            const g = groupedFiles.find((x) => x.displayName === row.displayName);
            const versions = g?.versions ?? row.files;
            const multiVersion = versions.length > 1;
            const mode = getMode(row.displayName);
            const checkedSet = selectChecked[row.displayName] ?? new Set();
            const showSelectPanel = multiVersion && mode === "select" && !deleting && !finishing;

            return (
              <div
                key={row.displayName}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  padding: "10px 12px 12px",
                  borderRadius: 12,
                  background:
                    row.status === "done"
                      ? "linear-gradient(145deg, #f0fdf4 0%, #ecfdf5 100%)"
                      : row.status === "error"
                        ? "linear-gradient(145deg, #fef2f2 0%, #fff1f2 100%)"
                        : "#f8fafc",
                  border: `1px solid ${
                    row.status === "done" ? "#86efac" : row.status === "error" ? "#fecaca" : "#e2e8f0"
                  }`,
                  boxShadow:
                    row.status === "deleting"
                      ? "0 0 0 1px rgba(59, 130, 246, 0.15), 0 4px 16px rgba(59, 130, 246, 0.1)"
                      : "none",
                  transition: "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, minHeight: 22 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                      color:
                        row.status === "done"
                          ? "#15803d"
                          : row.status === "error"
                            ? "#b91c1c"
                            : row.status === "deleting"
                              ? "#1d4ed8"
                              : "#64748b",
                      width: 36,
                      flexShrink: 0,
                      paddingTop: 2,
                    }}
                  >
                    {row.status === "done"
                      ? "완료"
                      : row.status === "error"
                        ? "실패"
                        : row.status === "deleting"
                          ? `${Math.round(batchProgress)}%`
                          : "대기"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#0f172a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: "1 1 120px",
                          minWidth: 0,
                        }}
                        title={row.displayName}
                      >
                        {row.displayName}
                      </span>
                      {!deleting && !finishing && multiVersion && (
                        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            onClick={() => setMode(row.displayName, "all")}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 8,
                              border: mode === "all" ? "1px solid #2563eb" : "1px solid #e2e8f0",
                              background: mode === "all" ? "#eff6ff" : "#fff",
                              color: mode === "all" ? "#1d4ed8" : "#64748b",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            전체삭제
                          </button>
                          <button
                            type="button"
                            onClick={() => setMode(row.displayName, "select")}
                            style={{
                              padding: "4px 10px",
                              borderRadius: 8,
                              border: mode === "select" ? "1px solid #2563eb" : "1px solid #e2e8f0",
                              background: mode === "select" ? "#eff6ff" : "#fff",
                              color: mode === "select" ? "#1d4ed8" : "#64748b",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            선택삭제
                          </button>
                        </div>
                      )}
                    </div>
                    {!deleting && !finishing && (
                      <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>
                        {multiVersion ? (
                          <>
                            버전 {versions.length}개 ·{" "}
                            {getMode(row.displayName) === "all"
                              ? "이 차트의 모든 버전이 삭제 대상입니다."
                              : `선택한 버전만 삭제합니다. (${versions.filter((v) => checkedSet.has(v.fullPath)).length}/${versions.length}개 선택됨)`}
                          </>
                        ) : (
                          <>버전 1개 · 단일 파일이 삭제 대상입니다.</>
                        )}
                      </div>
                    )}
                  </div>
                  {row.status === "error" && row.error && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#b91c1c",
                        flexShrink: 0,
                        maxWidth: 100,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        paddingTop: 2,
                      }}
                      title={row.error}
                    >
                      {row.error}
                    </span>
                  )}
                </div>

                {/* 선택삭제: 카드와 분리된 패널이 아래로 살짝 펼쳐짐 */}
                <div
                  aria-hidden={!showSelectPanel}
                  style={{
                    overflow: "hidden",
                    /* 펼침 높이는 고정해 전환을 부드럽게; 내용은 안쪽에서 스크롤 */
                    maxHeight: showSelectPanel ? 272 : 0,
                    opacity: showSelectPanel ? 1 : 0,
                    transition:
                      "max-height 0.34s cubic-bezier(0.33, 1, 0.32, 1), opacity 0.22s ease-out",
                    pointerEvents: showSelectPanel ? "auto" : "none",
                  }}
                >
                  <div
                    style={{
                      marginTop: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #e2e8f0",
                      background: "#fff",
                      boxShadow: "0 10px 30px rgba(15,23,42,0.1), 0 2px 8px rgba(15,23,42,0.04)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      maxHeight: 260,
                      overflowY: "auto",
                      animation: showSelectPanel
                        ? "deleteCsvSheetIn 0.32s cubic-bezier(0.33, 1, 0.32, 1) both"
                        : undefined,
                    }}
                  >
                    {versions.map((v) => (
                      <label
                        key={v.fullPath}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          cursor: "pointer",
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid #f1f5f9",
                          background: "#f8fafc",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checkedSet.has(v.fullPath)}
                          onChange={() => toggleVersionCheck(row.displayName, v.fullPath)}
                          style={{ width: 15, height: 15, cursor: "pointer", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155", fontFamily: "ui-monospace, monospace" }}>
                          v{v.version}
                        </span>
                        <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis" }} title={v.fileName}>
                          {v.fileName}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: "rgba(148, 163, 184, 0.35)",
                    overflow: "hidden",
                    position: "relative",
                    marginTop: 10,
                  }}
                >
                  <div style={{ height: "100%", borderRadius: 999, ...hpFillStyle(row, batchProgress) }} />
                  {row.status === "deleting" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
                        width: "40%",
                        animation: "deleteCsvShine 1.1s ease-in-out infinite",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <style>{`
          @keyframes deleteCsvShine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
          @keyframes deleteCsvSheetIn {
            from {
              opacity: 0.65;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>

        {!finishing && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, paddingTop: 2 }}>
            {totalDeleteCount === 0 && !deleting && (
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#b45309",
                  textAlign: "center",
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                }}
              >
                삭제할 파일이 없습니다. 선택삭제에서 버전을 하나 이상 선택하거나 전체삭제로 바꿔 주세요.
              </p>
            )}
            {deleting && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontWeight: 500,
                  color: "#94a3b8",
                  textAlign: "center",
                  lineHeight: 1.45,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#f8fafc",
                  border: "1px solid #f1f5f9",
                }}
              >
                삭제가 진행 중이에요. 완료될 때까지 닫기·취소는 잠시 비활성이에요.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={deleting}
                title={deleting ? "삭제가 끝날 때까지 취소할 수 없어요" : undefined}
                onClick={onClose}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "1px solid #e2e8f0",
                  background: deleting ? "#f1f5f9" : "#fff",
                  fontSize: 13,
                  cursor: deleting ? "not-allowed" : "pointer",
                  color: deleting ? "#94a3b8" : "#475569",
                  fontWeight: 600,
                  opacity: deleting ? 0.92 : 1,
                }}
              >
                취소
              </button>
              <button
                type="button"
                disabled={deleting || hasErrorRow || totalDeleteCount === 0}
                title={
                  totalDeleteCount === 0
                    ? "삭제할 파일을 먼저 지정해 주세요"
                    : deleting
                      ? "삭제가 끝날 때까지 기다려 주세요"
                      : undefined
                }
                onClick={() => void runDelete()}
                style={{
                  padding: "10px 22px",
                  borderRadius: 10,
                  border: "none",
                  background:
                    deleting || hasErrorRow || totalDeleteCount === 0
                      ? "#fca5a5"
                      : "linear-gradient(180deg, #dc2626 0%, #b91c1c 100%)",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor:
                    deleting ? "wait" : hasErrorRow || totalDeleteCount === 0 ? "not-allowed" : "pointer",
                  boxShadow:
                    deleting || hasErrorRow || totalDeleteCount === 0 ? "none" : "0 4px 14px rgba(185, 28, 28, 0.35)",
                  opacity: deleting ? 0.95 : 1,
                }}
              >
                {deleting ? "삭제 중…" : `삭제 (${totalDeleteCount}개)`}
              </button>
            </div>
          </div>
        )}

        {finishing && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 18,
              zIndex: 20,
              pointerEvents: "auto",
              cursor: "wait",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 28,
              background: "rgba(255, 255, 255, 0.38)",
              backdropFilter: "blur(14px) saturate(1.2)",
              WebkitBackdropFilter: "blur(14px) saturate(1.2)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
              userSelect: "none",
            }}
          >
            <div
              style={{
                textAlign: "center",
                padding: "18px 22px",
                borderRadius: 14,
                background: "rgba(255, 255, 255, 0.55)",
                border: "1px solid rgba(255, 255, 255, 0.7)",
                boxShadow: "0 8px 32px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(148, 163, 184, 0.12)",
                maxWidth: 300,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#334155", letterSpacing: "-0.02em", lineHeight: 1.55 }}>
                목록을 맞추는 중입니다.
                <br />
                잠시만 기다려주세요.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
