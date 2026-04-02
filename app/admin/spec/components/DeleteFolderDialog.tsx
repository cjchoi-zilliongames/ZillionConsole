"use client";

type DeleteFolderDialogProps = {
  target: string | null;
  folderNames: Record<string, string>;
  fileCount: number;
  folderBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function DeleteFolderDialog({ target, folderNames, fileCount, folderBusy, onConfirm, onClose }: DeleteFolderDialogProps) {
  if (!target) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 400, width: "100%", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 8px" }}>앱 버전 삭제</h2>
        <p style={{ fontSize: 14, color: "#374151", margin: "0 0 16px" }}>
          <strong>{folderNames[target] ?? "(이름 없음)"}</strong>
          {fileCount > 0
            ? ` 버전 안에 파일 ${fileCount}개가 있습니다. 파일을 모두 삭제하고 버전을 삭제합니다.`
            : " 버전을 삭제합니다."}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={folderBusy} onClick={onConfirm}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {folderBusy ? "삭제 중…" : "삭제"}
          </button>
          <button type="button" disabled={folderBusy} onClick={onClose}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
