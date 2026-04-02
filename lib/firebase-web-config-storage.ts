"use client";

import type { FirebaseOptions } from "firebase/app";

import { getPublicFirebaseOptions } from "@/lib/firebase-public-config";

const LS_KEY = "spec_admin_firebase_web_config_v1";

function isCompleteOptions(j: unknown): j is FirebaseOptions {
  if (!j || typeof j !== "object") return false;
  const o = j as Record<string, unknown>;
  return (
    typeof o.apiKey === "string" &&
    o.apiKey.length > 0 &&
    typeof o.authDomain === "string" &&
    typeof o.projectId === "string" &&
    typeof o.storageBucket === "string" &&
    typeof o.messagingSenderId === "string" &&
    typeof o.appId === "string"
  );
}

/** 콘솔에서 복사한 스니펫(또는 JSON)에서 FirebaseOptions 추출 */
export function parseFirebaseWebConfigPaste(input: string): FirebaseOptions | null {
  let s = input.trim();
  s = s.replace(/^export\s+default\s+/i, "");
  s = s.replace(/^const\s+\w+\s*=\s*/i, "");
  s = s.replace(/;\s*$/g, "");

  const extractBraced = (t: string): string | null => {
    const i = t.indexOf("{");
    if (i < 0) return null;
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return t.slice(i, j + 1);
      }
    }
    return null;
  };

  if (!s.startsWith("{")) {
    const inner = extractBraced(s);
    if (inner) s = inner;
  }

  const tryParse = (raw: string): unknown | null => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      try {
        return new Function(`"use strict"; return (${raw});`)() as unknown;
      } catch {
        return null;
      }
    }
  };

  const j = tryParse(s);
  if (!j || !isCompleteOptions(j)) return null;
  return j;
}

export function getStoredFirebaseOptions(): FirebaseOptions | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LS_KEY);
  if (!raw?.trim()) return null;
  try {
    const j = JSON.parse(raw) as unknown;
    return isCompleteOptions(j) ? j : null;
  } catch {
    return null;
  }
}

export function setStoredFirebaseOptions(opts: FirebaseOptions): void {
  localStorage.setItem(LS_KEY, JSON.stringify(opts));
}

export function clearStoredFirebaseWebConfig(): void {
  localStorage.removeItem(LS_KEY);
}

/** .env 의 NEXT_PUBLIC_* 또는 브라우저에 저장한 설정 */
export function getFirebaseOptionsFromBrowser(): FirebaseOptions | null {
  const fromEnv = getPublicFirebaseOptions();
  if (fromEnv) return fromEnv;
  return getStoredFirebaseOptions();
}

export function hasFirebaseWebConfigClient(): boolean {
  return getFirebaseOptionsFromBrowser() !== null;
}

export function saveFirebaseConfigFromPaste(
  text: string
): { ok: true } | { ok: false; error: string } {
  const opts = parseFirebaseWebConfigPaste(text);
  if (!opts) {
    return {
      ok: false,
      error:
        "형식을 인식하지 못했습니다. Firebase 콘솔 → 프로젝트 설정 → 일반 → 웹 앱에서 `firebaseConfig` 객체 전체를 복사해 붙여넣으세요.",
    };
  }
  setStoredFirebaseOptions(opts);
  return { ok: true };
}
