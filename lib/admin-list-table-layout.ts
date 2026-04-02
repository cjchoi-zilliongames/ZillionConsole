/**
 * 관리자 **공지** / **우편** 목록 테이블
 *
 * - **열 너비**: 드래그 조절 + `localStorage` 저장 (기본값·최소값은 아래 상수)
 * - **셀 패딩**: `noticeListTableLayout` / `postboxListTableLayout` 의 `columnPadding` 등
 */

type ColPad = { th?: string; td?: string };

/** 공지 목록 — 열 너비 저장 키 */
export const ADMIN_NOTICE_LIST_COL_STORAGE_KEY = "admin_notice_list_col_widths_v1";

/** 순서: 선택, 이름, 게시일, UUID, 작성자, 등록일, 공개 여부 */
export const ADMIN_NOTICE_LIST_COL_DEFAULTS = [68, 200, 140, 200, 100, 130, 96] as const;
export const ADMIN_NOTICE_LIST_COL_MINS = [44, 80, 72, 96, 64, 88, 72] as const;

/** 우편 목록 — 열 너비 저장 키 */
export const ADMIN_POSTBOX_LIST_COL_STORAGE_KEY = "admin_postbox_list_col_widths_v1";

/** 순서: 선택, 번호, 제목, 대상, 발송인, 보상, 발송일, 만료일, 상태 */
export const ADMIN_POSTBOX_LIST_COL_DEFAULTS = [68, 56, 220, 100, 88, 88, 100, 100, 88] as const;
export const ADMIN_POSTBOX_LIST_COL_MINS = [44, 36, 100, 72, 64, 64, 72, 72, 64] as const;

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
