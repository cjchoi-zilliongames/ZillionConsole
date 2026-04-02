"use client";

type LiveRouteChangeDialogProps = {
  pending: { targetFolder: string | null } | null;
  folderNames: Record<string, string>;
  onConfirm: (folder: string | null) => void;
  onClose: () => void;
};

export function LiveRouteChangeDialog({ pending, folderNames, onConfirm, onClose }: LiveRouteChangeDialogProps) {
  if (!pending) return null;
  const target = pending.targetFolder;
  const clearing = target === null;
  const targetLabel = clearing ? null : (folderNames[target] ?? target.replace(/\/$/, ""));
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.62)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16 }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-change-warn-title"
        style={{ background: "#fff", borderRadius: 16, padding: 0, maxWidth: 460, width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,0.28)", border: "1px solid #fecaca", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ background: "linear-gradient(180deg, #fef2f2 0%, #fff 100%)", borderLeft: "5px solid #dc2626", padding: "20px 22px 18px" }}>
          <h2 id="live-change-warn-title" style={{ fontSize: 18, fontWeight: 800, margin: "0 0 10px", color: "#991b1b", letterSpacing: "-0.02em" }}>
            {clearing ? "라이브 해제 — 주의" : "라이브 버전 변경 — 주의"}
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: "#1f2937", margin: "0 0 14px", fontWeight: 600 }}>
            Unity에서 사용하는 스펙 데이터의{" "}
            <span style={{ color: "#b91c1c" }}>기준(라이브)</span>이 바뀝니다. 기준이 달라지면 Unity 클라이언트에서{" "}
            <span style={{ color: "#b91c1c" }}>예기치 않은 동작</span>이 발생할 수 있습니다.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: "#4b5563", margin: 0 }}>
            실행 중인 앱·캐시·배포 파이프라인과 실제로 불러오는 스펙이 어긋날 수 있습니다. 팀과 조율했는지 확인한 뒤에만 진행하세요.
          </p>
          {!clearing && targetLabel && (
            <p style={{ margin: "14px 0 0", padding: "10px 12px", background: "#f9fafb", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 13, color: "#374151" }}>
              <span style={{ color: "#6b7280", fontWeight: 600 }}>새 라이브로 설정할 앱 버전: </span>
              <strong style={{ fontFamily: "ui-monospace, monospace" }}>{targetLabel}</strong>
            </p>
          )}
          {clearing && (
            <p style={{ margin: "14px 0 0", padding: "10px 12px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fcd34d", fontSize: 13, color: "#92400e", fontWeight: 600 }}>
              라이브를 해제하면 Unity 쪽 기본 동작·매핑에도 영향을 줄 수 있습니다.
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, padding: "16px 22px 20px", background: "#fafafa", borderTop: "1px solid #f3f4f6" }}>
          <button type="button" onClick={onClose}
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", color: "#374151" }}>
            취소
          </button>
          <button type="button" onClick={() => onConfirm(pending.targetFolder)}
            style={{ flex: 1, padding: "11px 14px", borderRadius: 10, border: "1px solid #dc2626", background: "#dc2626", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 2px 8px rgba(220,38,38,0.35)" }}>
            {clearing ? "라이브 해제" : "라이브로 변경"}
          </button>
        </div>
      </div>
    </div>
  );
}
