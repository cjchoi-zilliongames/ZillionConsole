# 공지(Notice) 시스템 v1 — 게임 클라이언트 명세

> **작성일**: 2026-04-08  
> **저장소**: Firestore 컬렉션 `notices/{uuid}` (관리 API와 동일 구조를 가정).

---

## 1. 문서 필드(요약)

| 필드 | 타입 | 설명 |
|------|------|------|
| `uuid` | `string` | 문서 ID와 동일한 식별자 |
| `noticeTitle` | `string` | 공지 이름(관리용·목록용) |
| `author` | `string` | 기본 작성자 표시명 |
| `isPublic` | `"y" \| "n"` | 공개 여부 |
| `postSchedule` | `"immediate" \| "scheduled"` | 즉시 / 예약 |
| `postingDate` | `string` | `YYYY-MM-DD` |
| `postingAt` | `Timestamp` | 게시 시각 |
| `regionContents` | `array` | **지역별 본문 블록** (아래 스키마) |

레거시로 `contents[]` + `language`만 있는 문서가 있을 수 있다. 신규·수정 저장은 **`regionContents`** 로 통일한다.

---

## 2. `regionContents[]` 항목

| 필드 | 타입 | 설명 |
|------|------|------|
| `regionCode` | `string` | **`GLOBAL`** 또는 ISO 3166-1 alpha-2 대문자 |
| `title` | `string` | 지역별 제목 |
| `content` | `string` | 지역별 본문 |
| `imageKey` | `string` | (선택) 스토리지 경로 등 이미지 키 |
| `author` | `string` | (선택) 지역별 작성자. 없으면 문서 최상위 `author` 폴백 |
| `fallback` | `boolean` | 규약상 **GLOBAL 행만 `true`** |

---

## 3. 표시 문구·에셋 선택 알고리즘

유저 지역 `userRegionCode`(ISO 2자리)를 결정한 뒤:

1. `regionContents`에서 `regionCode === userRegionCode` 인 항목이 있으면 그 행의 `title`, `content`, `imageKey`, `author`(또는 상위 `author` 폴백).
2. 없으면 `fallback === true` 인 행(**GLOBAL**).
3. 그래도 없으면 레거시 단일 객체 필드 등 구버전 경로가 있으면 그것을 사용(운영 데이터에 따름).

---

## 4. 버전 호환

- 구 클라이언트: `regionContents` 미지원 시 `contents` + `language`만 처리 가능.
- 신 클라이언트: `regionContents` 우선, 필요 시 `contents` 읽기 폴백 후 제거.

언어 코드를 지역 코드로 자동 치환하는 마이그레이션은 권장하지 않는다. 별도 매핑 테이블·수동 검수를 사용한다.
