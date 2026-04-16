import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

import { getSpecBucket } from "@/lib/firebase-admin";
import { jsonStorageError } from "@/lib/storage-api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_KEY = process.env.SHEETS_IMPORT_KEY ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-import-key",
};

/**
 * Google Apps Script 확장에서 CSV 데이터를 수신하여
 * 앱 버전 폴더를 만들고 CSV 파일을 등록한다.
 *
 * Auth: `x-import-key` 헤더로 공유 키 검증.
 */
export async function POST(req: Request) {
  try {
    const key = req.headers.get("x-import-key") ?? "";
    if (!IMPORT_KEY || key !== IMPORT_KEY) {
      return NextResponse.json({ ok: false, error: "유효하지 않은 import key입니다." }, { status: 403 });
    }

    const body = await req.json() as {
      folderName?: string;
      csvFiles?: { name: string; content: string }[];
    };

    const { folderName, csvFiles } = body;
    if (!folderName?.trim() || !csvFiles?.length) {
      return NextResponse.json({ ok: false, error: "folderName과 csvFiles가 필요합니다." }, { status: 400 });
    }

    const bucket = getSpecBucket();

    // 랜덤 폴더 경로 생성
    const folderPath = randomBytes(4).toString("hex");

    // 폴더 마커 생성
    const markerFile = bucket.file(`${folderPath}/.folder`);
    await markerFile.save("", { contentType: "text/plain" });

    // CSV 파일 업로드
    const uploaded: string[] = [];
    for (const csv of csvFiles) {
      const safeName = csv.name.replace(/[/\\:*?"<>|]/g, "_");
      const filePath = `${folderPath}/${safeName}`;
      const file = bucket.file(filePath);
      await file.save(csv.content, {
        contentType: "text/csv; charset=utf-8",
        metadata: { cacheControl: "no-cache" },
      });
      uploaded.push(safeName);
    }

    return NextResponse.json({
      ok: true,
      folderPath: `${folderPath}/`,
      folderName: folderName.trim(),
      uploaded,
    }, { headers: CORS_HEADERS });
  } catch (e) {
    return jsonStorageError(e);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" } });
}
