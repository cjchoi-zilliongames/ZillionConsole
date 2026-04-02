"use client";

type RenameFolderDialogProps = {
  target: string | null;
  newName: string;
  setNewName: (v: string) => void;
  folderBusy: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function RenameFolderDialog({ target, newName, setNewName, folderBusy, onConfirm, onClose }: RenameFolderDialogProps) {
  if (!target) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 380, width: "100%", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 12px" }}>폴더 이름 변경</h2>
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConfirm();
            if (e.key === "Escape") onClose();
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            fontSize: 14,
            fontFamily: "ui-monospace, monospace",
            marginBottom: 4,
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" disabled={folderBusy} onClick={onConfirm}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {folderBusy ? "변경 중…" : "변경"}
          </button>
          <button type="button" onClick={onClose}
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#f9fafb", color: "#374151", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
