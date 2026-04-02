"use client";

import type { ConflictResolution } from "../hooks/useStorageService";

type ConflictDialogProps = {
  conflictFile: string | null;
  conflictApplyAll: boolean;
  setConflictApplyAll: (v: boolean) => void;
  onResolve: (resolution: ConflictResolution, applyAll: boolean) => void;
};

export function ConflictDialog({ conflictFile, conflictApplyAll, setConflictApplyAll, onResolve }: ConflictDialogProps) {
  if (!conflictFile) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 420, width: "100%", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 8px" }}>이미 존재하는 파일</h2>
        <p style={{ fontSize: 14, color: "#374151", margin: "0 0 20px" }}>
          <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4, fontFamily: "ui-monospace, monospace" }}>
            {conflictFile}
          </code>
          이(가) 대상 폴더에 이미 존재합니다.
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#4b5563", marginBottom: 20, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={conflictApplyAll}
            onChange={(e) => setConflictApplyAll(e.target.checked)}
          />
          모든 항목에 적용
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => onResolve("overwrite", conflictApplyAll)}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            덮어쓰기
          </button>
          <button type="button" onClick={() => onResolve("skip", conflictApplyAll)}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            건너뛰기
          </button>
          <button type="button" onClick={() => onResolve("cancel", conflictApplyAll)}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
