"use client";

import Link from "next/link";

const card: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 22,
  boxShadow: "0 4px 20px rgba(15, 23, 42, 0.06)",
  textDecoration: "none",
  color: "inherit",
  display: "block",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

export function AdminHomeClient() {
  return (
    <div style={{ padding: "28px 0 48px", width: "100%", maxWidth: 960 }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>대시보드</h1>
      <p style={{ margin: "0 0 28px", fontSize: 14, color: "#64748b" }}>자주 쓰는 기능으로 이동하세요.</p>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
        <Link href="/admin/spec" style={card} className="admin-home-card">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#0891b2", marginBottom: 8 }}>데이터</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>차트 관리</div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>스펙 데이터 / 버전 관리 시스템</div>
        </Link>
        <Link href="/admin/postbox" style={card} className="admin-home-card">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7c3aed", marginBottom: 8 }}>운영</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>우편</div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>유저 우편·보상·공지 발송 (준비 중)</div>
        </Link>
        <Link href="/admin/notice" style={card} className="admin-home-card">
          <div style={{ fontSize: 12, fontWeight: 700, color: "#ea580c", marginBottom: 8 }}>운영</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>공지</div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.45 }}>Firestore 공지 등록·목록</div>
        </Link>
      </div>
      <style>{`
        .admin-home-card:hover {
          border-color: #cbd5e1 !important;
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.1) !important;
        }
      `}</style>
    </div>
  );
}
