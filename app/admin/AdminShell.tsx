"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "firebase/auth";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";

import { adminFetch } from "@/lib/admin-client-fetch";
import { storageAuthFetch } from "@/lib/storage-auth-fetch";
import { getOrInitFirebaseBrowserApp } from "@/lib/firebase-browser-app";
import { hasFirebaseWebConfigClient, getFirebaseOptionsFromBrowser } from "@/lib/firebase-web-config-storage";
import { resolveAdminProjectDisplayName } from "@/lib/admin-project-display";

import { AdminSessionContext } from "./contexts/AdminSessionContext";
import { AdminConsoleLayout } from "./components/AdminConsoleLayout";
import { AdminGlobalLoadingOverlay } from "./components/AdminGlobalLoadingOverlay";
import { buildRedirectToAdminLoginUrl } from "@/lib/admin-post-login-path";
import { resolveActiveNav } from "./components/admin-nav-config";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // 로그인 페이지는 shell 적용 제외 (인증 redirect loop 방지)
  if (pathname.startsWith("/admin/login")) {
    return <>{children}</>;
  }

  return <AdminShellInner>{children}</AdminShellInner>;
}

/** 인증이 필요한 영역에서만 렌더. AdminShell에서 login 경로를 필터 후 호출. */
function AdminShellInner({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // ── Auth state (useAdminSession 로직 통합) ────────────────────────────────
  const [webMode, setWebMode] = useState<boolean | null>(null);
  const [adminSession, setAdminSession] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const r = await adminFetch("/api/admin/auth-status");
      const d = (await r.json()) as { loggedIn?: boolean; email?: string | null };
      if (!active) return;
      const hasFb = hasFirebaseWebConfigClient();
      if (d.loggedIn) {
        const ac = await adminFetch("/api/admin/tool-access");
        if (!ac.ok) {
          await adminFetch("/api/admin/logout", { method: "POST" });
          if (active) router.replace(buildRedirectToAdminLoginUrl({ denied: true }));
          return;
        }
        setAdminSession(true);
        setSessionEmail(d.email ?? null);
        setWebMode(hasFb);
        setBootstrapped(true);
        return;
      }
      if (hasFb) {
        setWebMode(true);
        setAdminSession(false);
        return;
      }
      setWebMode(false);
      setAdminSession(false);
      router.replace(buildRedirectToAdminLoginUrl());
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (webMode !== true || adminSession) return;
    const app = getOrInitFirebaseBrowserApp();
    if (!app) {
      router.replace(buildRedirectToAdminLoginUrl());
      return;
    }
    const auth = getAuth(app);
    let active = true;
    let unsub: (() => void) | undefined;

    void (async () => {
      try {
        // 새로고침 직후 persistence 복원 전에 onAuthStateChanged 가 null 로 한 번
        // 뜨는 경우가 있어, 그때 /admin/login → 로그인 화면이 /admin(홈)으로 보내 버림.
        await auth.authStateReady();
      } catch {
        /* ignore */
      }
      if (!active) return;
      unsub = onAuthStateChanged(auth, (user) => {
        if (!active) return;
        setFirebaseUser(user);
        if (!user) {
          router.replace(buildRedirectToAdminLoginUrl());
          return;
        }
        void (async () => {
          const ac = await storageAuthFetch("/api/admin/tool-access");
          if (!ac.ok) {
            await signOut(auth);
            if (!active) return;
            setFirebaseUser(null);
            router.replace(buildRedirectToAdminLoginUrl({ denied: true }));
            return;
          }
          if (!active) return;
          setBootstrapped(true);
        })();
      });
    })();

    return () => {
      active = false;
      unsub?.();
    };
  }, [webMode, adminSession, router]);

  const useClientStorage = webMode === true && !adminSession && firebaseUser !== null;
  const displayEmail = firebaseUser?.email ?? sessionEmail ?? null;

  const logout = useCallback(async () => {
    await adminFetch("/api/admin/logout", { method: "POST" });
    const app = getOrInitFirebaseBrowserApp();
    if (app) {
      try { await signOut(getAuth(app)); } catch { /* ignore */ }
    }
    router.replace("/admin/login");
  }, [router]);

  // ── Nav lock (작업 중 사이드바/상단바 잠금) ──────────────────────────────────
  const [navLocked, setNavLockedRaw] = useState(false);
  const setNavLocked = useCallback((locked: boolean) => {
    setNavLockedRaw(locked);
  }, []);

  // ── Project display name (useAdminProjectDisplayName 로직 통합) ──────────
  const [projectId, setProjectId] = useState<string | null>(null);
  useEffect(() => {
    setProjectId(getFirebaseOptionsFromBrowser()?.projectId ?? null);
  }, []);
  const projectDisplayName = resolveAdminProjectDisplayName(projectId);

  // ── Layout ───────────────────────────────────────────────────────────────
  const activeNav = resolveActiveNav(pathname);
  const globalLoadingMsg =
    webMode === null ? "초기화 중…" :
    !bootstrapped ? "인증 확인 중…" :
    null;

  return (
    <AdminSessionContext.Provider value={{
      webMode,
      adminSession,
      bootstrapped,
      useClientStorage,
      displayEmail,
      projectDisplayName,
      logout,
      navLocked,
      setNavLocked,
    }}>
      <AdminConsoleLayout
        activeNav={activeNav}
        projectDisplayName={projectDisplayName}
        useClientStorage={useClientStorage}
        displayEmail={displayEmail}
        onLogout={logout}
      >
        <AdminGlobalLoadingOverlay message={globalLoadingMsg} />
        {children}
      </AdminConsoleLayout>
    </AdminSessionContext.Provider>
  );
}
