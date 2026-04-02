import { NextResponse } from "next/server";

export function jsonStorageError(e: unknown): NextResponse {
  const message = e instanceof Error ? e.message : "Unknown error";

  if (message === "UNAUTHORIZED") {
    return NextResponse.json(
      {
        ok: false,
        code: "UNAUTHORIZED",
        error: "로그인이 필요합니다.",
      },
      { status: 401 }
    );
  }

  if (message === "FORBIDDEN") {
    return NextResponse.json(
      {
        ok: false,
        code: "FORBIDDEN",
        error: "이 계정은 관리자 툴 사용이 허용되지 않습니다.",
      },
      { status: 403 }
    );
  }

  if (message === "ALLOWLIST_REQUIRED") {
    return NextResponse.json(
      {
        ok: false,
        code: "FORBIDDEN",
        error: "권한이 없습니다.",
      },
      { status: 403 }
    );
  }

  if (message === "NOT_CONFIGURED") {
    return NextResponse.json(
      {
        ok: false,
        code: "FORBIDDEN",
        error: "권한이 없습니다.",
      },
      { status: 403 }
    );
  }

  if (message === "NO_FIREBASE_PROJECT_ID") {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_FIREBASE_PROJECT_ID",
        error:
          "서버에 Firebase 프로젝트 ID가 없습니다. FIREBASE_PROJECT_ID 또는 NEXT_PUBLIC_FIREBASE_PROJECT_ID 를 설정하세요.",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
