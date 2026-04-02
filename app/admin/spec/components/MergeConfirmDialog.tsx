"use client";

import type { MergeConflict } from "../hooks/useFolderOperations";

type MergeConfirmDialogProps = {
  pending: { sourceFolder: string; conflicts: MergeConflict[]; additions: string[] } | null;
  liveFolder: string | null;
  folderNames: Record<string, string>;
  mergeBusy: boolean;
  mergeFinishing: boolean;
  mergeProgress: number;
  fileStatuses: Record<string, "moving" | "done">;
  onConfirm: () => void;
  onClose: () => void;
};

export function MergeConfirmDialog({ pending, liveFolder, folderNames, mergeBusy, mergeFinishing, mergeProgress, fileStatuses, onConfirm, onClose }: MergeConfirmDialogProps) {
  if (!pending && !mergeFinishing) return null;
  const srcLabel = pending ? (folderNames[pending.sourceFolder]?.trim() || pending.sourceFolder.replace(/\/$/, "")) : "";
  const destLabel = liveFolder ? (folderNames[liveFolder]?.trim() || liveFolder.replace(/\/$/, "")) : "";
  const { conflicts = [], additions = [] } = pending ?? {};

  const allRows = [
    ...conflicts.map((c) => ({
      key: c.displayName,
      displayName: c.displayName,
      versionLabel: `v${c.destVersions.at(-1)} → v${c.srcVersions.at(-1)}`,
      isConflict: true,
    })),
    ...additions.map((name) => ({
      key: name,
      displayName: name,
      versionLabel: "신규",
      isConflict: false,
    })),
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.62)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}
      role="presentation"
      onClick={() => { if (!mergeBusy && !mergeFinishing) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={mergeBusy || mergeFinishing}
        style={{ position: "relative", background: "#fff", borderRadius: 16, padding: 0, maxWidth: 500, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.28)", border: "1px solid #bfdbfe", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        {mergeFinishing && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "absolute", inset: 0, zIndex: 20,
              pointerEvents: "auto", cursor: "wait",
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 16,
              background: "rgba(255,255,255,0.38)",
              backdropFilter: "blur(14px) saturate(1.2)",
              WebkitBackdropFilter: "blur(14px) saturate(1.2)",
            }}
          >
            <div style={{
              textAlign: "center", padding: "18px 22px", borderRadius: 14,
              background: "rgba(255,255,255,0.55)", border: "1px solid rgba(255,255,255,0.7)",
              boxShadow: "0 8px 32px rgba(15,23,42,0.08), 0 0 0 1px rgba(148,163,184,0.12)",
              maxWidth: 300,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#334155", letterSpacing: "-0.02em", lineHeight: 1.55 }}>
                목록을 맞추는 중입니다.<br />잠시만 기다려주세요.
              </div>
            </div>
          </div>
        )}
        <div style={{ background: "linear-gradient(180deg, #eff6ff 0%, #fff 100%)", borderLeft: "5px solid #2563eb", padding: "20px 22px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 10px", color: "#1e3a8a", letterSpacing: "-0.02em" }}>
              라이브로 병합 — 확인
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "#1f2937", margin: 0 }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#1d4ed8" }}>{srcLabel}</span>
              {" "}의 스펙 CSV를{" "}
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: "#166534" }}>{destLabel} (라이브)</span>
              {" "}폴더로 병합합니다.
            </p>
          </div>

          {conflicts.length > 0 && (
            <div style={{ padding: "10px 14px", background: "#fef9c3", border: "1px solid #fde047", borderRadius: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#92400e", margin: 0 }}>
                ⚠️ 라이브에 이미 존재하는 스펙 {conflicts.length}개는 덮어씁니다
              </p>
            </div>
          )}

          {additions.length > 0 && (
            <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#166534", margin: 0 }}>
                ✅ 새로 추가될 스펙 {additions.length}개
              </p>
            </div>
          )}

          {/* File rows with progress bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", paddingRight: 2 }}>
            {allRows.map((row) => {
              const status = fileStatuses[row.displayName];
              const isDone = status === "done";
              const isMoving = status === "moving";
              const barWidth = isDone ? 100 : isMoving ? mergeProgress : 0;
              const barColor = isDone
                ? "linear-gradient(90deg, #15803d 0%, #22c55e 100%)"
                : row.isConflict
                  ? "linear-gradient(90deg, #d97706 0%, #f59e0b 100%)"
                  : "linear-gradient(90deg, #15803d 0%, #22c55e 100%)";
              return (
                <div
                  key={row.key}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "8px 10px 10px",
                    borderRadius: 10,
                    background: isDone ? "linear-gradient(145deg, #f0fdf4 0%, #ecfdf5 100%)" : row.isConflict ? "#fffbeb" : "#f0fdf4",
                    border: `1px solid ${isDone ? "#86efac" : row.isConflict ? "#fde68a" : "#bbf7d0"}`,
                    transition: "background 0.4s ease, border-color 0.4s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 18 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                      color: isDone ? "#15803d" : isMoving ? "#1d4ed8" : "#94a3b8",
                      width: 32,
                      flexShrink: 0,
                    }}>
                      {isDone ? "완료" : isMoving ? `${Math.round(mergeProgress)}%` : "대기"}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.displayName}
                    </span>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "ui-monospace, monospace",
                      color: row.isConflict ? "#b45309" : "#15803d",
                      flexShrink: 0,
                    }}>
                      {row.versionLabel}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 999, background: "rgba(148,163,184,0.25)", overflow: "hidden", position: "relative" }}>
                    <div style={{
                      height: "100%",
                      borderRadius: 999,
                      width: `${barWidth}%`,
                      background: barColor,
                      transition: isDone ? "width 0.25s ease" : "width 0.12s linear",
                    }} />
                    {isMoving && (
                      <div style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
                        width: "40%",
                        animation: "mergeShine 1.1s ease-in-out infinite",
                        pointerEvents: "none",
                      }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <style>{`
          @keyframes mergeShine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>

        <div style={{ display: "flex", gap: 10, padding: "16px 22px 20px", background: "#fafafa", borderTop: "1px solid #f3f4f6" }}>
          <button type="button" disabled={mergeBusy} onClick={onClose}
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", fontWeight: 700, fontSize: 13, cursor: mergeBusy ? "not-allowed" : "pointer", color: "#374151" }}>
            취소
          </button>
          <button type="button" disabled={mergeBusy} onClick={onConfirm}
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #2563eb", background: "#2563eb", color: "#fff", fontWeight: 800, fontSize: 13, cursor: mergeBusy ? "not-allowed" : "pointer", boxShadow: "0 2px 8px rgba(37,99,235,0.35)", opacity: mergeBusy ? 0.7 : 1 }}>
            {mergeBusy ? "병합 중…" : "병합 실행"}
          </button>
        </div>
      </div>
    </div>
  );
}
