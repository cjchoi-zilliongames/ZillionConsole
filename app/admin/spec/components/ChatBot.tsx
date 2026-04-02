"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { storageAuthFetch } from "@/lib/storage-auth-fetch";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const QUICK_QUESTIONS = [
  "파일을 어떻게 업로드하나요?",
  "앱 버전 구조가 어떻게 되나요?",
  "라이브로 병합은 언제 쓰나요?",
  "버전 번호 규칙이 뭔가요?",
];

export function ChatBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "instant" }), 50);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setStreaming(true);

    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...nextMessages, assistantMsg]);

    try {
      const res = await storageAuthFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok || !res.body) throw new Error("응답 오류");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: updated[updated.length - 1].content + parsed.text,
                };
                return updated;
              });
            }
          } catch (parseErr) {
            throw parseErr;
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "오류가 발생했습니다. 다시 시도해 주세요.",
        };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 88, right: 24, width: 360, height: 520,
          background: "#fff", borderRadius: 16, boxShadow: "0 8px 40px rgba(15,23,42,0.18)",
          border: "1px solid #e5e7eb", display: "flex", flexDirection: "column",
          zIndex: 90, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f9fafb" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>질리언게임즈 툴 도우미</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>사용법을 물어보세요</div>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)}
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18, color: "#9ca3af", lineHeight: 1, padding: 2 }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>자주 묻는 질문:</p>
                {QUICK_QUESTIONS.map((q) => (
                  <button key={q} type="button" onClick={() => void sendMessage(q)}
                    style={{ textAlign: "left", padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 10, background: "#f9fafb", fontSize: 13, cursor: "pointer", color: "#374151", lineHeight: 1.4 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#f9fafb")}>
                    {q}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "9px 12px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user" ? "#2563eb" : "#f3f4f6",
                    color: msg.role === "user" ? "#fff" : "#111827",
                    fontSize: 13, lineHeight: 1.55, wordBreak: "break-word",
                  }}>
                    {msg.role === "user" ? (
                      <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                    ) : (
                      <div className="_md">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                        {streaming && i === messages.length - 1 && (
                          <span style={{ display: "inline-block", width: 6, height: 13, background: "#9ca3af", marginLeft: 2, borderRadius: 2, verticalAlign: "middle", animation: "_blink 1s step-end infinite" }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(input); } }}
              placeholder="질문을 입력하세요…"
              disabled={streaming}
              style={{ flex: 1, padding: "9px 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: 13, outline: "none", color: "#111827", background: streaming ? "#f9fafb" : "#fff" }}
            />
            <button type="button" onClick={() => void sendMessage(input)} disabled={streaming || !input.trim()}
              style={{ padding: "9px 14px", borderRadius: 10, border: "none", background: (streaming || !input.trim()) ? "#bfdbfe" : "#2563eb", color: "#fff", fontWeight: 700, fontSize: 13, cursor: (streaming || !input.trim()) ? "default" : "pointer" }}>
              전송
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="어드민 도우미"
        style={{
          position: "fixed", bottom: 24, right: 24, width: 54, height: 54,
          borderRadius: "50%", border: "none",
          background: open ? "#1d4ed8" : "#2563eb",
          color: "#fff", fontSize: 24, cursor: "pointer",
          boxShadow: "0 4px 16px rgba(37,99,235,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 90, transition: "background 0.15s",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "#1d4ed8"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "#2563eb"; }}
      >
        {open ? "✕" : "💬"}
      </button>

      <style>{`
        @keyframes _blink { 0%,100%{opacity:1} 50%{opacity:0} }
        ._md { line-height: 1.6; }
        ._md p { margin: 0 0 6px; }
        ._md p:last-child { margin-bottom: 0; }
        ._md ul, ._md ol { margin: 4px 0 6px; padding-left: 18px; }
        ._md li { margin-bottom: 2px; }
        ._md strong { font-weight: 700; }
        ._md code { background: #e5e7eb; border-radius: 3px; padding: 1px 4px; font-size: 12px; font-family: monospace; }
        ._md h1, ._md h2, ._md h3 { font-weight: 700; margin: 8px 0 4px; }
        ._md h1 { font-size: 15px; }
        ._md h2 { font-size: 14px; }
        ._md h3 { font-size: 13px; }
        ._md hr { border: none; border-top: 1px solid #e5e7eb; margin: 8px 0; }
      `}</style>
    </>
  );
}
