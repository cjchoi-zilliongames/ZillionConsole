"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { getStorage, list, ref } from "firebase/storage";

import { adminFetch } from "@/lib/admin-client-fetch";
import { storageAuthFetch } from "@/lib/storage-auth-fetch";
import { AdminLoginBar } from "../components/AdminLoginBar";
import { ADMIN_TOP_BAR_PX } from "../components/admin-console-constants";
import {
  getOrInitFirebaseBrowserApp,
  reinitFirebaseBrowserApp,
} from "@/lib/firebase-browser-app";
import {
  clearStoredFirebaseWebConfig,
  hasFirebaseWebConfigClient,
  saveFirebaseConfigFromPaste,
} from "@/lib/firebase-web-config-storage";
import { resolvePostLoginAdminPath } from "@/lib/admin-post-login-path";

function readNextSearchParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("next");
}

type AuthStatus = {
  loggedIn?: boolean;
  firebaseReady?: boolean;
  adminAuthReady?: boolean;
};

export default function AdminLoginPage() {
  const router = useRouter();

  const postLoginRedirect = useCallback(() => {
    router.replace(resolvePostLoginAdminPath(readNextSearchParam()));
  }, [router]);
  const [configReady, setConfigReady] = useState(false);
  const [configPaste, setConfigPaste] = useState("");
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [fbEmail, setFbEmail] = useState("");
  const [fbPassword, setFbPassword] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showServerLogin, setShowServerLogin] = useState(false);
  const loggingIn = useRef(false);

  useEffect(() => {
    setConfigReady(hasFirebaseWebConfigClient());
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/auth-status");
      const data = (await res.json()) as AuthStatus;
      setStatus(data);
      const hasFb = hasFirebaseWebConfigClient();
      if (data.loggedIn && !hasFb) {
        postLoginRedirect();
      }
    } catch {
      setStatus({});
    }
  }, [router, postLoginRedirect]);

  /** 서버에서 툴 허용 여부 확인. 실패 시 Firebase 로그아웃 + 빨간 메시지 */
  const verifyFirebaseToolAccess = useCallback(async (): Promise<boolean> => {
    const res = await storageAuthFetch("/api/admin/tool-access");
    if (res.ok) return true;
    const app = getOrInitFirebaseBrowserApp();
    if (app) {
      try {
        await signOut(getAuth(app));
      } catch {
        /* ignore */
      }
    }
    let msg = "권한이 없습니다.";
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    setFirebaseError(msg);
    return false;
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  /** 다른 화면에서 권한 거부로 돌아온 경우 */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("denied") === "1") {
      setFirebaseError("권한이 없습니다.");
      const next = q.get("next");
      const clean = new URLSearchParams();
      if (next) clean.set("next", next);
      const s = clean.toString();
      router.replace(s ? `/admin/login?${s}` : "/admin/login");
    }
  }, [router]);

  useEffect(() => {
    if (!configReady) return;
    const app = getOrInitFirebaseBrowserApp();
    if (!app) return;
    const auth = getAuth(app);
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user || loggingIn.current) return;
      void (async () => {
        if (await verifyFirebaseToolAccess()) {
          postLoginRedirect();
        }
      })();
    });
    return () => unsub();
  }, [configReady, router, verifyFirebaseToolAccess, postLoginRedirect]);

  function handleSaveFirebaseConfig() {
    setConfigSaveError(null);
    const result = saveFirebaseConfigFromPaste(configPaste);
    if (!result.ok) {
      setConfigSaveError(result.error);
      return;
    }
    reinitFirebaseBrowserApp();
    setConfigPaste("");
    setConfigReady(true);
  }

  function handleClearFirebaseConfig() {
    clearStoredFirebaseWebConfig();
    reinitFirebaseBrowserApp();
    setConfigReady(false);
    setFbEmail("");
    setFbPassword("");
    setFirebaseError(null);
    setAdminError(null);
  }

  function firebaseAuthErrorMessage(err: unknown): string {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    }
    if (code === "auth/too-many-requests") {
      return "시도가 너무 많습니다. 잠시 후 다시 시도하세요.";
    }
    if (code === "auth/popup-closed-by-user") {
      return "로그인 창이 닫혔습니다.";
    }
    if (code === "auth/popup-blocked") {
      return "팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용하세요.";
    }
    if (code === "auth/unauthorized-domain") {
      return "이 도메인은 Firebase에 등록되지 않았습니다. 콘솔 → Authentication → 설정 → 승인된 도메인을 확인하세요.";
    }
    if (code === "auth/operation-not-allowed") {
      return "Google 로그인이 꺼져 있습니다. 콘솔 → Authentication → Sign-in method 에서 Google을 사용 설정하세요.";
    }
    return "로그인에 실패했습니다. 콘솔 → Authentication 설정을 확인하세요.";
  }

  async function handleGoogleLogin() {
    setFirebaseError(null);
    setSubmitting(true);
    loggingIn.current = true;

    // 일부 브라우저에서 팝업을 닫아도 signInWithPopup이 throw하지 않아
    // finally가 실행되지 않는 경우를 대비한 focus 이벤트 폴백
    let settled = false;
    const onWindowFocus = () => {
      if (settled) return;
      // Firebase가 처리할 짧은 시간을 준 뒤에도 미완료면 강제 복원
      setTimeout(() => {
        if (!settled) {
          settled = true;
          setSubmitting(false);
        }
      }, 500);
    };
    window.addEventListener("focus", onWindowFocus, { once: true });

    try {
      const app = getOrInitFirebaseBrowserApp();
      if (!app) {
        setFirebaseError("먼저 Firebase 설정을 저장하세요.");
        return;
      }
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      settled = true;
      window.removeEventListener("focus", onWindowFocus);

      // Storage 접근 권한 체크
      try {
        const storage = getStorage(app);
        await list(ref(storage, ""), { maxResults: 1 });
      } catch (storageErr: unknown) {
        const code =
          typeof storageErr === "object" && storageErr !== null && "code" in storageErr
            ? String((storageErr as { code: string }).code)
            : "";
        if (code === "storage/unauthorized") {
          await signOut(auth);
          setFirebaseError("권한이 없습니다.");
          setSubmitting(false);
          return;
        }
      }

      if (await verifyFirebaseToolAccess()) {
        postLoginRedirect();
      }
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: string }).code)
          : "";
      // 사용자가 직접 팝업을 닫거나 취소한 경우 → 에러 없이 조용히 원복
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setFirebaseError(firebaseAuthErrorMessage(err));
      }
    } finally {
      settled = true;
      loggingIn.current = false;
      window.removeEventListener("focus", onWindowFocus);
      setSubmitting(false);
    }
  }

  async function handleFirebaseLogin(e: React.FormEvent) {
    e.preventDefault();
    setFirebaseError(null);
    setSubmitting(true);
    loggingIn.current = true;
    try {
      const app = getOrInitFirebaseBrowserApp();
      if (!app) {
        setFirebaseError("먼저 Firebase 설정을 저장하세요.");
        return;
      }
      const auth = getAuth(app);
      await signInWithEmailAndPassword(auth, fbEmail.trim(), fbPassword);
      if (await verifyFirebaseToolAccess()) {
        postLoginRedirect();
      }
    } catch (err: unknown) {
      setFirebaseError(firebaseAuthErrorMessage(err));
    } finally {
      loggingIn.current = false;
      setSubmitting(false);
    }
  }

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setAdminError(null);
    setSubmitting(true);
    try {
      const res = await adminFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password: adminPassword }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setAdminError(data.error ?? "로그인에 실패했습니다.");
        return;
      }
      postLoginRedirect();
    } catch {
      setAdminError("네트워크 오류");
    } finally {
      setSubmitting(false);
    }
  }

  const ready = status !== null;
  const canServerLogin = status?.firebaseReady && status?.adminAuthReady;
  const needServerEnvHint =
    ready && !configReady && !canServerLogin;

  return (
    <>
      <AdminLoginBar />
    <main
      style={{
        minHeight: "100vh",
        background: "#f5f7fb",
        fontFamily:
          'Inter, Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "#111827",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        paddingTop: ADMIN_TOP_BAR_PX + 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 28,
          boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 24px" }}>
          Firebase 계정 로그인
        </h1>

        {!configReady && (
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
                color: "#374151",
              }}
            >
              Firebase 웹 설정
            </div>
            <textarea
              value={configPaste}
              onChange={(e) => {
                setConfigPaste(e.target.value);
                setConfigSaveError(null);
              }}
              placeholder={'{ "apiKey": "...", "authDomain": "...", ... }'}
              rows={8}
              spellCheck={false}
              style={{
                width: "100%",
                boxSizing: "border-box",
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                padding: 12,
                borderRadius: 10,
                border: "1px solid #d1d5db",
                marginBottom: 10,
                resize: "vertical",
              }}
            />
            {configSaveError && (
              <p style={{ color: "#b91c1c", fontSize: 13, margin: "0 0 8px" }}>
                {configSaveError}
              </p>
            )}
            <button
              type="button"
              onClick={() => handleSaveFirebaseConfig()}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: "#1d4ed8",
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                cursor: "pointer",
              }}
            >
              저장하고 로그인으로 진행
            </button>

            {canServerLogin && (
              <>
                <div
                  style={{
                    textAlign: "center",
                    margin: "16px 0",
                    fontSize: 12,
                    color: "#9ca3af",
                  }}
                >
                  또는
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAdminError(null);
                    setShowServerLogin((v) => !v);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px dashed #d1d5db",
                    background: "#f9fafb",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {showServerLogin
                    ? "서버 관리자 로그인 접기"
                    : "서버 관리자로만 로그인 (.env 이미 있음)"}
                </button>
              </>
            )}
          </div>
        )}

        {configReady && (
          <>
            <form
              onSubmit={(e) => void handleFirebaseLogin(e)}
              style={{ marginBottom: 16 }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                이메일
              </label>
              <input
                type="email"
                autoComplete="username"
                value={fbEmail}
                onChange={(e) => setFbEmail(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  marginBottom: 14,
                  fontSize: 15,
                }}
              />
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 8,
                }}
              >
                비밀번호
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={fbPassword}
                onChange={(e) => setFbPassword(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  marginBottom: 16,
                  fontSize: 15,
                }}
              />
              <button
                type="submit"
                disabled={submitting || !ready}
                style={{
                  width: "100%",
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: submitting || !ready ? "wait" : "pointer",
                }}
              >
                {submitting ? "확인 중…" : !ready ? "불러오는 중…" : "이메일로 로그인"}
              </button>
            </form>

            <div
              style={{
                textAlign: "center",
                margin: "0 0 14px",
                fontSize: 12,
                color: "#9ca3af",
              }}
            >
              또는
            </div>

            <button
              type="button"
              disabled={submitting || !ready}
              onClick={() => void handleGoogleLogin()}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid #dadce0",
                background: "#fff",
                color: "#3c4043",
                fontWeight: 600,
                fontSize: 15,
                cursor: submitting || !ready ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                marginBottom: 16,
                boxShadow: "0 1px 2px rgba(60,64,67,0.15)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path
                  fill="#EA4335"
                  d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                />
                <path
                  fill="#4285F4"
                  d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                />
                <path
                  fill="#FBBC05"
                  d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                />
                <path
                  fill="#34A853"
                  d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                />
              </svg>
              {submitting ? "확인 중…" : !ready ? "불러오는 중…" : "Google로 로그인"}
            </button>

            {firebaseError && (
              <p
                style={{ color: "#b91c1c", fontSize: 14, margin: "0 0 14px" }}
              >
                {firebaseError}
              </p>
            )}

            {canServerLogin && (
              <button
                type="button"
                onClick={() => {
                  setAdminError(null);
                  setShowServerLogin((v) => !v);
                }}
                style={{
                  width: "100%",
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px dashed #d1d5db",
                  background: "#f9fafb",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {showServerLogin
                  ? "서버 관리자 로그인 접기"
                  : "서버 관리자로 로그인 (서비스 계정)"}
              </button>
            )}
          </>
        )}

        {((!configReady && showServerLogin && canServerLogin) ||
          (configReady && showServerLogin && canServerLogin)) && (
          <form onSubmit={(e) => void handleAdminLogin(e)}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 10,
                color: "#374151",
              }}
            >
              서버 관리자
            </div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              이메일
            </label>
            <input
              type="email"
              autoComplete="username"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                marginBottom: 14,
                fontSize: 15,
              }}
            />
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              비밀번호
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #d1d5db",
                marginBottom: 16,
                fontSize: 15,
              }}
            />
            {showServerLogin && adminError && (
              <p style={{ color: "#b91c1c", fontSize: 14, margin: "0 0 12px" }}>
                {adminError}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !ready || !canServerLogin}
              style={{
                width: "100%",
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: "#374151",
                color: "#fff",
                fontWeight: 700,
                fontSize: 15,
                cursor:
                  submitting || !ready || !canServerLogin ? "wait" : "pointer",
              }}
            >
              서버 관리자 로그인
            </button>
          </form>
        )}

      </div>
    </main>
    </>
  );
}
