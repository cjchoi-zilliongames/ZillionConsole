"use client";

import { useEffect, useRef, useState } from "react";

type SpreadsheetFile = { id: string; name: string; url: string; modifiedTime: string };
type SheetTab = { sheetId: number; title: string };
type Step = "list" | "tabs" | "folder" | "importing" | "done";

type SheetsImportModalProps = {
  onClose: () => void;
  onDone: () => void;
  onBusyChange?: (busy: boolean | "loading") => void;
};

import { storageAuthFetch } from "@/lib/storage-auth-fetch";

const HAS_SCRIPT = !!(process.env.NEXT_PUBLIC_SHEETS_SCRIPT_URL ?? "");

async function callScript(payload: Record<string, unknown>) {
  const res = await storageAuthFetch("/api/storage/sheets-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
}

function formatDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SheetsImportModal({ onClose, onDone, onBusyChange }: SheetsImportModalProps) {
  const [step, setStep] = useState<Step>("list");

  // list
  const [files, setFiles] = useState<SpreadsheetFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // tabs
  const [selectedFile, setSelectedFile] = useState<SpreadsheetFile | null>(null);
  const [allTabs, setAllTabs] = useState<SheetTab[]>([]);
  const [selectedTabs, setSelectedTabs] = useState<Set<string>>(new Set());
  const [tabsLoading, setTabsLoading] = useState(false);

  // folder
  const [displayName, setDisplayName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // importing
  const [importPhase, setImportPhase] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const locked = step === "importing" || step === "done";

  // ── Load spreadsheets on mount ──────────────────────────────
  useEffect(() => {
    if (!HAS_SCRIPT) { setFilesLoading(false); return; }
    onBusyChange?.("loading");
    void (async () => {
      try {
        const res = await callScript({ action: "list-spreadsheets" });
        if (!res.ok) { setFilesError(res.error ?? "불러오기 실패"); return; }
        setFiles((res.data?.files as SpreadsheetFile[]) ?? []);
      } catch {
        setFilesError("네트워크 오류");
      } finally {
        setFilesLoading(false);
        onBusyChange?.(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (step === "list" && !filesLoading) requestAnimationFrame(() => searchRef.current?.focus());
  }, [step, filesLoading]);

  // ── No script URL ───────────────────────────────────────────
  if (!HAS_SCRIPT) {
    return (
      <Overlay onClose={onClose}>
        <Header onClose={onClose} locked={false} />
        <div style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", borderRadius: 8, padding: "12px 14px", lineHeight: 1.6 }}>
          <b>NEXT_PUBLIC_SHEETS_SCRIPT_URL</b> 환경변수가 설정되지 않았습니다.
        </div>
      </Overlay>
    );
  }

  // ── Select spreadsheet → load tabs ──────────────────────────
  async function selectFile(file: SpreadsheetFile) {
    setSelectedFile(file);
    setDisplayName(file.name);
    setTabsLoading(true);
    setStep("tabs");
    try {
      const res = await callScript({ action: "list-sheets", spreadsheetId: file.id });
      if (!res.ok) { setStep("list"); return; }
      const tabs = (res.data?.sheets as SheetTab[]) ?? [];
      setAllTabs(tabs);
      setSelectedTabs(new Set(tabs.map((t) => t.title)));
    } catch {
      setStep("list");
    } finally {
      setTabsLoading(false);
    }
  }

  // ── Tab helpers ─────────────────────────────────────────────
  function toggleTab(title: string) {
    setSelectedTabs((p) => { const n = new Set(p); if (n.has(title)) n.delete(title); else n.add(title); return n; });
  }
  function toggleAll() {
    if (selectedTabs.size === allTabs.length) setSelectedTabs(new Set());
    else setSelectedTabs(new Set(allTabs.map((t) => t.title)));
  }

  // ── Export ──────────────────────────────────────────────────
  async function handleExport() {
    const name = displayName.trim();
    if (!name) { setFolderError("이름을 입력하세요."); return; }
    setFolderError(null);
    setImportError(null);
    setStep("importing");
    setImportPhase("내보내기 중…");
    onBusyChange?.(true);
    onClose();
    try {
      const res = await callScript({
        action: "export",
        spreadsheetId: selectedFile!.id,
        sheetNames: [...selectedTabs],
        folderName: name,
      });
      if (!res.ok) throw new Error(res.error ?? "내보내기 실패");
      onBusyChange?.(false);
      onDone();
    } catch (e) {
      onBusyChange?.(false);
      setImportError(e instanceof Error ? e.message : "내보내기 실패");
      setImportPhase("");
      setStep("folder");
    }
  }

  // ── Filtered files ──────────────────────────────────────────
  const filtered = search.trim()
    ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  // ── Render ──────────────────────────────────────────────────
  return (
    <Overlay onClose={() => {}}>
      <Header onClose={onClose} locked={locked} />

      {/* Step: Spreadsheet list */}
      {step === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            ref={searchRef} value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="스프레드시트 검색…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e2e8f0", fontSize: 13, outline: "none" }}
          />
          <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fafafa" }}>
            {filesLoading && <Msg>불러오는 중…</Msg>}
            {filesError && <Msg color="#dc2626">{filesError}</Msg>}
            {!filesLoading && !filesError && filtered.length === 0 && (
              <Msg>{search ? "검색 결과 없음" : "스프레드시트가 없습니다"}</Msg>
            )}
            {filtered.map((f) => (
              <button key={f.id} type="button" onClick={() => void selectFile(f)}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", border: "none", borderBottom: "1px solid #f1f5f9", background: "transparent", cursor: "pointer", textAlign: "left", fontSize: 13 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>📊</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "#0f172a" }}>{f.name}</span>
                <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{formatDate(f.modifiedTime)}</span>
              </button>
            ))}
          </div>
          <BtnRow><Btn label="취소" onClick={onClose} /><span /></BtnRow>
        </div>
      )}

      {/* Step: Sheet tabs */}
      {step === "tabs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            <b style={{ color: "#0f172a" }}>{selectedFile?.name}</b> — 가져올 시트 선택
          </div>
          {tabsLoading ? <Msg>불러오는 중…</Msg> : (
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fafafa" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                <input type="checkbox" checked={selectedTabs.size === allTabs.length && allTabs.length > 0} onChange={toggleAll} style={{ accentColor: "#2563eb" }} />
                전체 선택 ({allTabs.length})
              </label>
              {allTabs.map((t) => (
                <label key={t.sheetId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid #f8fafc", cursor: "pointer", fontSize: 13, color: "#334155" }}>
                  <input type="checkbox" checked={selectedTabs.has(t.title)} onChange={() => toggleTab(t.title)} style={{ accentColor: "#2563eb" }} />
                  {t.title}
                </label>
              ))}
            </div>
          )}
          <BtnRow>
            <Btn label="뒤로" onClick={() => setStep("list")} />
            <BtnPrimary label="다음" disabled={selectedTabs.size === 0} onClick={() => setStep("folder")} />
          </BtnRow>
        </div>
      )}

      {/* Step: Folder name */}
      {step === "folder" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#64748b" }}>새 앱 버전 폴더 이름 ({selectedTabs.size}개 시트 → CSV)</div>
          <input autoFocus value={displayName}
            onChange={(e) => { setDisplayName(e.target.value); setFolderError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") void handleExport(); }}
            placeholder="폴더 표시 이름"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: folderError ? "1.5px solid #f87171" : "1.5px solid #e2e8f0", fontSize: 13, fontFamily: "ui-monospace, monospace", outline: "none" }}
          />
          {folderError && <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{folderError}</p>}
          {importError && <p style={{ fontSize: 12, color: "#dc2626", margin: 0, background: "#fef2f2", borderRadius: 6, padding: "6px 8px" }}>{importError}</p>}
          <BtnRow>
            <Btn label="뒤로" onClick={() => { setStep("tabs"); setImportError(null); }} />
            <BtnPrimary label="가져오기" disabled={!displayName.trim()} onClick={() => void handleExport()} />
          </BtnRow>
        </div>
      )}

      {/* Step: Importing / Done */}
      {(step === "importing" || step === "done") && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: step === "done" ? "#15803d" : "#1e40af" }}>{importPhase}</div>
          <div style={{ width: "100%", height: 8, borderRadius: 4, background: "#e2e8f0", overflow: "hidden", marginTop: 12 }}>
            <div style={{
              height: "100%", borderRadius: 4, transition: "width 0.3s",
              width: step === "done" ? "100%" : "60%",
              background: step === "done"
                ? "linear-gradient(90deg, #15803d, #22c55e, #4ade80)"
                : "linear-gradient(90deg, #1d4ed8, #3b82f6, #60a5fa)",
            }} />
          </div>
        </div>
      )}
    </Overlay>
  );
}

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: 16, backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.04)", width: 500, height: 520, padding: "26px 26px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
      </div>
    </div>
  );
}

function Header({ onClose, locked }: { onClose: () => void; locked: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: "#0f172a" }}>Google Sheets 가져오기</h2>
      <button type="button" disabled={locked} onClick={onClose}
        style={{ border: "none", background: "transparent", fontSize: 20, lineHeight: 1, padding: 4, borderRadius: 8, cursor: locked ? "not-allowed" : "pointer", color: locked ? "#cbd5e1" : "#94a3b8", opacity: locked ? 0.55 : 1 }}>✕</button>
    </div>
  );
}

function Msg({ children, color = "#94a3b8" }: { children: React.ReactNode; color?: string }) {
  return <div style={{ padding: 24, textAlign: "center", fontSize: 13, color }}>{children}</div>;
}

function BtnRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>{children}</div>;
}

function Btn({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#475569" }}>{label}</button>;
}

function BtnPrimary({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ padding: "8px 18px", borderRadius: 10, border: "none", background: disabled ? "#94a3b8" : "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : "0 4px 14px rgba(37,99,235,0.35)" }}>
      {label}
    </button>
  );
}
