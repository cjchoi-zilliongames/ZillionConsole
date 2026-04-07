/**
 * 관리자 **공지** / **우편** 목록 테이블
 *
 * - **열 너비**: 드래그 조절 + `localStorage` 저장 (기본값·최소값은 아래 상수)
 * - **셀 패딩**: `noticeListTableLayout` / `postboxListTableLayout` 의 `columnPadding` 등
 */

import type { CSSProperties } from "react";

type ColPad = { th?: string; td?: string };

/** 목록 테이블 `<thead>` 첫 행 (공지·우편 동일) */
export const adminListTableTheadRowStyle: CSSProperties = {
  background: "#f8fafc",
  borderBottom: "1px solid #e5e7eb",
};

/** 패널 하단 페이지네이션 바 (공지·우편 동일) */
export const adminListPanelFooterBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "14px 20px",
  borderTop: "1px solid #e2e8f0",
  gap: 12,
  background: "#fafbfc",
};

/** 공지·우편 발송 목록 툴바 검색 `<input>` 너비 (px) */
export const ADMIN_LIST_TOOLBAR_SEARCH_WIDTH_PX = 200;

/** 우편 탭 버튼(`padding 14px 18px` + 본문 + 2px 밑줄)과 맞춘 패널 상단 줄 최소 높이 */
export const ADMIN_LIST_PANEL_TOOLBAR_MIN_HEIGHT_PX = 50;

/**
 * 공지 툴바 왼쪽: 탭이 없을 때도 우편 탭과 같은 세로·밑줄 리듬만 맞춤 (표시 없음, 너비 0).
 * `alignSelf: stretch` 로 행 높이에 맞춰 2px transparent border가 컨테이너 하단과 겹친다.
 */
export const adminListPanelToolbarZeroWidthRhythmSpacerStyle: CSSProperties = {
  flexShrink: 0,
  width: 0,
  minWidth: 0,
  overflow: "hidden",
  alignSelf: "stretch",
  marginBottom: -1,
  borderBottom: "2px solid transparent",
  pointerEvents: "none",
  boxSizing: "border-box",
};

/** 선택 열 기본·최소 너비 (공지·우편 동일 — 좁게 줄이면 체크박스만 달리 보임) */
export const ADMIN_LIST_SELECT_COL_WIDTH_PX = 68;

/**
 * 공지·우편 목록 첫 열(선택) 너비 공유 — 페이지 전환 시 체크박스 위치 동일.
 * `useResizableAdminTableColumns` 의 `syncSelectColumnStorageKey` 로 연결.
 */
export const ADMIN_LIST_SELECT_COL_SYNC_STORAGE_KEY = "admin_list_select_col_width_sync_v1";

/** 공지·우편 목록 테이블 체크박스 — `globals.css` 와 픽셀 값 동기화 (18px 대비 약 5% 축소) */
export const ADMIN_LIST_TABLE_CHECKBOX_PX = 17;

/** 테이블·셀 font 상속보다 우선하도록 `globals.css` 에서 `!important` 로 고정 */
export const ADMIN_LIST_TABLE_CHECKBOX_CLASSNAME = "admin-list-table-checkbox";

/** 목록 테이블 헤더 글자와 동일 줄 높이 — 선택 열 `th`/`td`에 맞춰 체크박스 수직 정렬 */
export const ADMIN_LIST_TABLE_HEADER_LINE_HEIGHT_PX = 16;

export const adminListTableCheckboxInputStyle: CSSProperties = {
  width: ADMIN_LIST_TABLE_CHECKBOX_PX,
  height: ADMIN_LIST_TABLE_CHECKBOX_PX,
  minWidth: ADMIN_LIST_TABLE_CHECKBOX_PX,
  minHeight: ADMIN_LIST_TABLE_CHECKBOX_PX,
  maxWidth: ADMIN_LIST_TABLE_CHECKBOX_PX,
  maxHeight: ADMIN_LIST_TABLE_CHECKBOX_PX,
  margin: 0,
  padding: 0,
  cursor: "pointer",
  accentColor: "#0f172a",
  boxSizing: "border-box",
  fontSize: ADMIN_LIST_TABLE_CHECKBOX_PX,
  lineHeight: 1,
};

/** 공지 목록 — 열 너비 저장 키 */
export const ADMIN_NOTICE_LIST_COL_STORAGE_KEY = "admin_notice_list_col_widths_v1";

/** 순서: 선택, 이름, 게시일, UUID, 작성자, 등록일, 공개 여부 */
export const ADMIN_NOTICE_LIST_COL_DEFAULTS = [ADMIN_LIST_SELECT_COL_WIDTH_PX, 200, 140, 200, 100, 130, 96] as const;
export const ADMIN_NOTICE_LIST_COL_MINS = [ADMIN_LIST_SELECT_COL_WIDTH_PX, 80, 72, 96, 64, 88, 72] as const;

/** 우편 목록 — 열 너비 저장 키 */
export const ADMIN_POSTBOX_LIST_COL_STORAGE_KEY = "admin_postbox_list_col_widths_v1";

/** 순서: 선택, 번호, 제목, 대상, 발송인, 보상, 발송일, 만료일, 상태 */
export const ADMIN_POSTBOX_LIST_COL_DEFAULTS = [ADMIN_LIST_SELECT_COL_WIDTH_PX, 56, 220, 100, 88, 88, 100, 100, 88] as const;
export const ADMIN_POSTBOX_LIST_COL_MINS = [ADMIN_LIST_SELECT_COL_WIDTH_PX, 36, 100, 72, 64, 64, 72, 72, 64] as const;

/** 공지 `/admin/notice` — 패딩 등 (너비는 드래그 + 위 DEFAULTS) */
export const noticeListTableLayout = {
  checkboxThPadding: "10px 0",
  checkboxTdPadding: "11px 0",

  /** 이름·UUID 셀 maxWidth (열 너비와 함께 쓰임) */
  nameMaxWidth: 220,
  uuidMaxWidth: 200,

  columnPadding: {
    name: {} as ColPad,
    postingDate: {} as ColPad,
    uuid: {} as ColPad,
    author: {} as ColPad,
    registeredAt: {} as ColPad,
    isPublic: {} as ColPad,
  },
};

/** 우편 `/admin/postbox` */
export const postboxListTableLayout = {
  checkboxThPadding: "10px 0",
  checkboxTdPadding: "11px 0",

  numberThPadding: "10px 14px 10px 6px",
  numberTdPadding: "11px 14px 11px 6px",

  /** 예약·반복 탭: 반복 조건 / 예약 시각 열 (좌우 여유) */
  scheduleRepeatThPadding: "10px 12px",
  scheduleRepeatTdPadding: "11px 12px",

  titleMaxWidth: 260,

  columnPadding: {
    title: {} as ColPad,
    target: {} as ColPad,
    sender: {} as ColPad,
    reward: {} as ColPad,
    sentAt: {} as ColPad,
    expiresAt: {} as ColPad,
    status: {} as ColPad,
  },
};

export function adminListColBox(w: number) {
  return { width: w, minWidth: w, maxWidth: w, boxSizing: "border-box" as const };
}

/** 하단 페이지 크기 `<select>` (공지·우편 동일, 기존 대비 약 5% 축소) */
export const adminListPanelPageSizeSelectStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  fontSize: 12,
  color: "#334155",
  cursor: "pointer",
  boxSizing: "border-box",
  lineHeight: 1.25,
  minHeight: 28,
};
