import { NextResponse } from "next/server";
import { google } from "googleapis";

import { requireAnyAuth } from "@/lib/require-any-auth";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SheetMeta = { sheetId: number; title: string };

/** 사용자 OAuth access token으로 Google API 클라이언트 생성 */
function authFromToken(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function rowsToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell ?? "";
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(","),
    )
    .join("\n");
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

export async function POST(req: Request) {
  try {
    await requireAnyAuth(req);

    const body = await req.json();
    const { action, accessToken } = body as { action: string; accessToken?: string };

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Google 인증이 필요합니다.", authRequired: true },
        { status: 401 },
      );
    }

    const auth = authFromToken(accessToken);

    /* ─── list-spreadsheets: 사용자의 모든 스프레드시트 목록 ─── */
    if (action === "list-spreadsheets") {
      const drive = google.drive({ version: "v3", auth });
      try {
        const res = await drive.files.list({
          q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
          fields: "files(id,name,modifiedTime)",
          orderBy: "modifiedByMeTime desc,modifiedTime desc",
          pageSize: 100,
        });
        const files = (res.data.files ?? []).map((f) => ({
          id: f.id ?? "",
          name: f.name ?? "Untitled",
          modifiedTime: f.modifiedTime ?? "",
        }));
        return NextResponse.json({ ok: true, files });
      } catch (e: unknown) {
        const gErr = e as { code?: number };
        if (gErr.code === 401) {
          return NextResponse.json(
            { ok: false, error: "Google 인증이 만료되었습니다.", authRequired: true },
            { status: 401 },
          );
        }
        throw e;
      }
    }

    /* ─── list-sheets: 특정 스프레드시트의 시트 탭 목록 ─── */
    if (action === "list-sheets") {
      const { spreadsheetId } = body as { spreadsheetId: string };
      if (!spreadsheetId) {
        return NextResponse.json({ ok: false, error: "spreadsheetId가 필요합니다." }, { status: 400 });
      }
      const sheets = google.sheets({ version: "v4", auth });
      const res = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "properties.title,sheets.properties",
      });
      const title = res.data.properties?.title ?? "Untitled";
      const sheetList = (res.data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title ?? "Sheet",
      }));
      return NextResponse.json({ ok: true, spreadsheetId, title, sheets: sheetList });
    }

    /* ─── export-csv: 선택된 시트를 CSV로 변환 ─── */
    if (action === "export-csv") {
      const { spreadsheetId, selectedSheets } = body as {
        spreadsheetId: string;
        selectedSheets: SheetMeta[];
      };
      if (!spreadsheetId || !selectedSheets?.length) {
        return NextResponse.json(
          { ok: false, error: "스프레드시트 ID와 시트 목록이 필요합니다." },
          { status: 400 },
        );
      }
      const sheets = google.sheets({ version: "v4", auth });
      const csvFiles: { name: string; content: string }[] = [];
      for (const s of selectedSheets) {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: s.title,
        });
        const rows = (res.data.values ?? []) as string[][];
        csvFiles.push({
          name: `${sanitizeSheetName(s.title)}.csv`,
          content: rowsToCsv(rows),
        });
      }
      return NextResponse.json({ ok: true, csvFiles });
    }

    return NextResponse.json({ ok: false, error: "알 수 없는 action입니다." }, { status: 400 });
  } catch (e) {
    return jsonStorageError(e);
  }
}
