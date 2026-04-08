"use client";

export type RegionCopySourceItem = { id: string; label: string };

type Props = {
  sources: RegionCopySourceItem[];
  onClose: () => void;
  onPickSource: (sourceRowId: string) => void;
  onPickEmpty: () => void;
};

export function AdminRegionCopySourceModal({ sources, onClose, onPickSource, onPickEmpty }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 160,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "18px 20px",
          width: "min(320px, 100%)",
          maxHeight: "min(400px, 85vh)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "#0f172a" }}>내용을 복사하겠습니까?</p>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            marginBottom: 12,
            border: "1px solid #e2e8f0",
            borderRadius: 10,
          }}
        >
          {sources.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPickSource(s.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "11px 14px",
                border: "none",
                borderBottom: i < sources.length - 1 ? "1px solid #f1f5f9" : "none",
                background: "#fff",
                fontSize: 14,
                fontWeight: 600,
                color: "#1e293b",
                cursor: "pointer",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onPickEmpty}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              color: "#475569",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            비우고 추가
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              background: "#fff",
              color: "#64748b",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
