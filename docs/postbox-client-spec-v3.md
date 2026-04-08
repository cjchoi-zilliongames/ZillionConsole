# 우편 시스템 v3 — `regionContents`

> **전제**: `dispatchMode`, `visibleFrom`, 반복 우편 등은 `postbox-client-spec-v2.md` 와 동일. v3는 **지역별 본문 배열**만 정의.

## 배열 필드

- 문서·`personal_list[]` 등: **`regionContents[]`** 만 사용.

## 행 스키마

| 필드 | 타입 | 설명 |
|------|------|------|
| `regionCode` | `string` | `GLOBAL` 또는 ISO3166 alpha-2 대문자 |
| `title` | `string` | |
| `content` | `string` | |
| `sender` | `string` | 선택. 없으면 문서 루트 `sender` |
| `fallback` | `boolean` | **GLOBAL 행만 `true`** |

문서 루트 `title`, `content`, `sender`는 폴백용으로 둘 수 있음.

## 표시 문구 선택

`userRegionCode`(ISO2) 기준:

1. `regionCode === userRegionCode` 인 행
2. 없으면 `fallback === true`(GLOBAL)
3. 없으면 문서 루트 `title` / `content` / `sender`
