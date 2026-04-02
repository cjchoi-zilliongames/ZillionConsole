"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { StorageService } from "../hooks/useStorageService";
import type { InventoryFile } from "../hooks/useInventory";

type UploadRow = {
  file: File;
  duplicate: boolean;
  mode: "new" | "overwrite";
  overwriteVersion: number | null;
  existingVersions: number[];
  customVersion: number | null;
  status: "pending" | "uploading" | "done" | "error";
  /** 0–100, HP 바용 */
  progress: number;
  error?: string;
};

type UploadModalProps = {
  selectedFolder: string;
  filesInFolder: InventoryFile[];
  service: StorageService;
  onClose: () => void;
  onUploadComplete: () => Promise<void>;
  /** 전부 성공 후 모달이 닫히기 직전 (목록 갱신 이후) */
  onUploadSuccess?: (info: { count: number }) => void;
};

const HP_TRANSITION = "width 0.22s cubic-bezier(0.33, 1, 0.68, 1), background 0.45s ease, box-shadow 0.45s ease";

function hpFillStyle(row: UploadRow): CSSProperties {
  const w = row.status === "done" ? 100 : row.status === "error" ? Math.max(row.progress, 18) : row.progress;
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
  if (row.status === "uploading") {
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

export function UploadModal({ selectedFolder, filesInFolder, service, onClose, onUploadComplete, onUploadSuccess }: UploadModalProps) {
  const [uploadRows, setUploadRows] = useState<UploadRow[]>([]);
  const [uploading, setUploading] = useState(false);
  /** 업로드는 끝났고 onUploadComplete·닫기 전 구간 */
  const [finishing, setFinishing] = useState(false);
  const [uploadDragOver, setUploadDragOver] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const progressTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    if (!uploading && !finishing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading, finishing]);

  useEffect(() => {
    return () => {
      for (const t of progressTimersRef.current.values()) clearInterval(t);
      progressTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (uploading) setUploadDragOver(false);
  }, [uploading]);

  function startProgressTicker(fileKey: string) {
    const existing = progressTimersRef.current.get(fileKey);
    if (existing) clearInterval(existing);
    const id = setInterval(() => {
      setUploadRows((prev) =>
        prev.map((r) => {
          if (`${r.file.name}:${r.file.size}` !== fileKey || r.status !== "uploading") return r;
          const cap = 88 + Math.random() * 4;
          const delta = 2 + Math.random() * 7;
          const next = Math.min(r.progress + delta, cap);
          return { ...r, progress: next };
        })
      );
    }, 90);
    progressTimersRef.current.set(fileKey, id);
  }

  function stopProgressTicker(fileKey: string) {
    const t = progressTimersRef.current.get(fileKey);
    if (t) clearInterval(t);
    progressTimersRef.current.delete(fileKey);
  }

  function fileKey(f: File) {
    return `${f.name}:${f.size}`;
  }

  function addFilesToUpload(files: FileList | File[]) {
    if (uploading || finishing) return;
    const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".csv"));
    if (arr.length === 0) return;
    setUploadRows((prev) => {
      const next = [...prev];
      for (const file of arr) {
        if (next.some((r) => r.file.name === file.name)) continue;
        const existing = filesInFolder.filter((f) => f.displayName === file.name);
        const existingVersions = existing.map((f) => f.version).sort((a, b) => a - b);
        const duplicate = existingVersions.length > 0;
        next.push({
          file,
          duplicate,
          mode: "new",
          overwriteVersion: duplicate ? existingVersions[existingVersions.length - 1]! : null,
          existingVersions,
          customVersion: null,
          status: "pending",
          progress: 0,
        });
      }
      return next;
    });
  }

  async function runUpload() {
    if (uploading || uploadRows.length === 0) return;
    const pending = uploadRows.filter((r) => r.status === "pending");
    if (pending.length === 0) return;
    const batchCount = pending.length;

    setUploading(true);

    for (const row of pending) {
      const key = fileKey(row.file);
      setUploadRows((prev) =>
        prev.map((r) => (r.file === row.file ? { ...r, status: "uploading", progress: 4 } : r))
      );
      startProgressTicker(key);

      try {
        await service.uploadFiles(selectedFolder, [
          {
            file: row.file,
            mode: row.mode,
            overwriteVersion: row.overwriteVersion,
            customVersion: row.customVersion,
          },
        ]);
        stopProgressTicker(key);
        setUploadRows((prev) =>
          prev.map((r) => (r.file === row.file ? { ...r, status: "done", progress: 100 } : r))
        );
        await new Promise((r) => setTimeout(r, 280));
      } catch (e) {
        stopProgressTicker(key);
        const msg = e instanceof Error ? e.message : "업로드 실패";
        setUploadRows((prev) =>
          prev.map((r) =>
            r.file === row.file ? { ...r, status: "error", error: msg, progress: Math.min(r.progress, 55) } : r
          )
        );
        setUploading(false);
        return;
      }
    }

    setUploading(false);
    setFinishing(true);
    try {
      await onUploadComplete();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 420));
    onClose();
    onUploadSuccess?.({ count: batchCount });
  }

  const pendingCount = uploadRows.filter((r) => r.status === "pending").length;
  const chromeLocked = uploading || finishing;

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
        aria-busy={finishing || uploading}
        aria-labelledby="upload-modal-title"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "#fff",
          borderRadius: 18,
          boxShadow: "0 24px 64px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)",
          width: "100%",
          maxWidth: 540,
          padding: "26px 26px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="upload-modal-title" style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "#0f172a", letterSpacing: "-0.02em" }}>CSV 업로드</h2>
          <button
            type="button"
            disabled={chromeLocked}
            title={chromeLocked ? "업로드·목록 반영이 끝날 때까지 닫을 수 없어요" : "닫기"}
            onClick={() => onClose()}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
              borderRadius: 8,
              cursor: chromeLocked ? "not-allowed" : "pointer",
              color: chromeLocked ? "#cbd5e1" : "#94a3b8",
              opacity: chromeLocked ? 0.55 : 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ position: "relative", borderRadius: 14 }}>
          <div
            onDragOver={(e) => {
              if (uploading) {
                e.preventDefault();
                return;
              }
              e.preventDefault();
              setUploadDragOver(true);
            }}
            onDragLeave={() => {
              if (!uploading) setUploadDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setUploadDragOver(false);
              if (uploading) return;
              addFilesToUpload(e.dataTransfer.files);
            }}
            onClick={() => {
              if (!uploading) uploadInputRef.current?.click();
            }}
            style={{
              border: `2px dashed ${uploadDragOver && !uploading ? "#2563eb" : "#cbd5e1"}`,
              borderRadius: 14,
              background:
                uploading
                  ? "#f1f5f9"
                  : uploadDragOver
                    ? "linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%)"
                    : "#f8fafc",
              padding: "26px 18px",
              textAlign: "center",
              cursor: uploading ? "not-allowed" : "pointer",
              transition: "border-color 0.2s, background 0.2s, opacity 0.2s",
              opacity: uploading ? 0.72 : 1,
            }}
          >
            <div style={{ fontSize: 30, marginBottom: 8, opacity: uploading ? 0.35 : 0.9 }}>📂</div>
            <div style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
              CSV 파일을 여기에 드래그하거나 클릭하여 선택
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>여러 파일 동시 선택 가능 · .csv 만 허용</div>
            <input
              ref={uploadInputRef}
              type="file"
              accept=".csv"
              multiple
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(e) => {
                if (e.target.files) addFilesToUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {uploading && (
            <div
              role="presentation"
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 14,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: 16,
                background: "rgba(255, 255, 255, 0.45)",
                backdropFilter: "blur(8px) saturate(1.1)",
                WebkitBackdropFilter: "blur(8px) saturate(1.1)",
                border: "1px dashed rgba(148, 163, 184, 0.55)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                pointerEvents: "auto",
                cursor: "not-allowed",
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: 24, lineHeight: 1, opacity: 0.5, filter: "grayscale(0.2)" }} aria-hidden>
                🔒
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: "-0.01em" }}>업로드 중</span>
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, textAlign: "center", lineHeight: 1.45 }}>
                드래그·추가 선택은 잠시 막혀 있어요
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "#b45309",
                  fontWeight: 600,
                  textAlign: "center",
                  lineHeight: 1.4,
                  marginTop: 4,
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "rgba(251, 191, 36, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.25)",
                  maxWidth: 240,
                }}
              >
                완료될 때까지 이 화면을 유지해 주세요.
              </span>
            </div>
          )}
        </div>

        {uploadRows.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 280, overflowY: "auto", paddingRight: 2 }}>
            {uploadRows.map((row, i) => (
              <div
                key={`${row.file.name}-${row.file.size}-${i}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "10px 12px 12px",
                  borderRadius: 12,
                  background:
                    row.status === "done"
                      ? "linear-gradient(145deg, #f0fdf4 0%, #ecfdf5 100%)"
                      : row.status === "error"
                        ? "linear-gradient(145deg, #fef2f2 0%, #fff1f2 100%)"
                        : row.duplicate && row.status === "pending"
                          ? "#fffbeb"
                          : "#f8fafc",
                  border: `1px solid ${
                    row.status === "done"
                      ? "#86efac"
                      : row.status === "error"
                        ? "#fecaca"
                        : row.duplicate && row.status === "pending"
                          ? "#fcd34d"
                          : "#e2e8f0"
                  }`,
                  boxShadow:
                    row.status === "done"
                      ? "0 0 0 1px rgba(34, 197, 94, 0.12), 0 4px 14px rgba(34, 197, 94, 0.08)"
                      : row.status === "uploading"
                        ? "0 0 0 1px rgba(59, 130, 246, 0.15), 0 4px 16px rgba(59, 130, 246, 0.1)"
                        : "none",
                  transition: "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 22 }}>
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
                            : row.status === "uploading"
                              ? "#1d4ed8"
                              : "#64748b",
                      width: 36,
                      flexShrink: 0,
                    }}
                  >
                    {row.status === "done" ? "완료" : row.status === "error" ? "실패" : row.status === "uploading" ? `${Math.round(row.progress)}%` : "대기"}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      fontWeight: 600,
                      color: row.status === "done" ? "#14532d" : "#334155",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.file.name}
                  >
                    {row.file.name}
                  </span>
                  {row.status === "error" && row.error && (
                    <span style={{ fontSize: 10, color: "#b91c1c", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }} title={row.error}>
                      {row.error}
                    </span>
                  )}
                  {row.status === "pending" && (
                    <button
                      type="button"
                      disabled={uploading || finishing}
                      title={uploading || finishing ? "업로드가 진행 중이에요. 대기 중인 항목은 목록에서 뺄 수 없어요" : "목록에서 제거"}
                      onClick={() => setUploadRows((prev) => prev.filter((_, j) => j !== i))}
                      style={{
                        border: "none",
                        background: "transparent",
                        fontSize: 14,
                        color: uploading || finishing ? "#cbd5e1" : "#94a3b8",
                        cursor: uploading || finishing ? "not-allowed" : "pointer",
                        flexShrink: 0,
                        lineHeight: 1,
                        opacity: uploading || finishing ? 0.55 : 1,
                        borderRadius: 6,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: "rgba(148, 163, 184, 0.35)",
                    overflow: "hidden",
                    position: "relative",
                  }}
                >
                  <div style={{ height: "100%", borderRadius: 999, ...hpFillStyle(row) }} />
                  {row.status === "uploading" && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
                        width: "40%",
                        animation: "uploadShine 1.1s ease-in-out infinite",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>

                {row.status === "pending" && (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {row.duplicate && (
                      <>
                        <button
                          type="button"
                          onClick={() => setUploadRows((prev) => prev.map((r, j) => (j === i ? { ...r, mode: "new" } : r)))}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: `1.5px solid ${row.mode === "new" ? "#2563eb" : "#e2e8f0"}`,
                            background: row.mode === "new" ? "#dbeafe" : "#fff",
                            color: row.mode === "new" ? "#1d4ed8" : "#64748b",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          새 버전
                        </button>
                        <button
                          type="button"
                          onClick={() => setUploadRows((prev) => prev.map((r, j) => (j === i ? { ...r, mode: "overwrite" } : r)))}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 8,
                            border: `1.5px solid ${row.mode === "overwrite" ? "#b45309" : "#e2e8f0"}`,
                            background: row.mode === "overwrite" ? "#fef3c7" : "#fff",
                            color: row.mode === "overwrite" ? "#b45309" : "#64748b",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          덮어쓰기
                        </button>
                        {row.mode === "overwrite" && (
                          <select
                            value={row.overwriteVersion ?? ""}
                            onChange={(e) =>
                              setUploadRows((prev) =>
                                prev.map((r, j) => (j === i ? { ...r, overwriteVersion: Number(e.target.value) } : r))
                              )
                            }
                            style={{
                              fontSize: 11,
                              padding: "3px 8px",
                              borderRadius: 8,
                              border: "1px solid #d97706",
                              background: "#fff",
                              color: "#92400e",
                              fontWeight: 600,
                            }}
                          >
                            {row.existingVersions.map((v) => (
                              <option key={v} value={v}>{`{${v}}`} 버전</option>
                            ))}
                          </select>
                        )}
                      </>
                    )}
                    {row.mode === "new" && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: "#64748b" }}>버전 번호:</span>
                        <input
                          type="number"
                          min={1}
                          placeholder="자동"
                          value={row.customVersion ?? ""}
                          onChange={(e) =>
                            setUploadRows((prev) =>
                              prev.map((r, j) =>
                                j === i ? { ...r, customVersion: e.target.value ? Number(e.target.value) : null } : r
                              )
                            )
                          }
                          style={{
                            width: 64,
                            padding: "3px 8px",
                            borderRadius: 8,
                            border: "1px solid #93c5fd",
                            fontSize: 11,
                            textAlign: "center",
                          }}
                        />
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>비우면 자동</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <style>{`
          @keyframes uploadShine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>

        {!finishing && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, paddingTop: 2 }}>
          {uploading && (
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
              업로드 진행중...
            </p>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            disabled={uploading}
            title={uploading ? "업로드가 끝날 때까지 취소할 수 없어요" : undefined}
            onClick={onClose}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: uploading ? "#f1f5f9" : "#fff",
              fontSize: 13,
              cursor: uploading ? "not-allowed" : "pointer",
              color: uploading ? "#94a3b8" : "#475569",
              fontWeight: 600,
              opacity: uploading ? 0.92 : 1,
            }}
          >
            취소
          </button>
          <button
            type="button"
            disabled={uploading || pendingCount === 0}
            title={uploading ? "업로드가 끝날 때까지 기다려 주세요" : undefined}
            onClick={() => void runUpload()}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              background: uploading || pendingCount === 0 ? "#93c5fd" : "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: uploading ? "wait" : pendingCount === 0 ? "not-allowed" : "pointer",
              boxShadow: uploading || pendingCount === 0 ? "none" : "0 4px 14px rgba(37, 99, 235, 0.35)",
              opacity: uploading ? 0.95 : 1,
            }}
          >
            {uploading ? "업로드 중…" : `업로드 (${pendingCount}개)`}
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
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#334155",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.55,
                }}
              >
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
