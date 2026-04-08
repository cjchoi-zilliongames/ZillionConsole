# 우편·공지 Firestore — 클라이언트 압축 명세

> 토큰 절약용 요약. 상세·예시는 `postbox-client-spec-v2.md`, `postbox-client-spec-v3.md`, `notice-client-spec-v1.md`.

## 컬렉션

| 경로 | 용도 |
|------|------|
| `global_mails/{id}` | 전체 우편 메타 |
| `personal_mail_dispatches/{id}` | 지정 우편 메타(수신자는 Storage) |
| `personal_mails/{uid}` | `personal_list[]`, `global_history[]` |
| `notices/{uuid}` | 공지 |

---

## 지역 문구

- **`regionContents[]`** 만 사용.
- 행: `regionCode` **`GLOBAL`** | ISO3166 alpha-2 대문자, `title`, `content`, **`fallback`**(규약상 **GLOBAL 행만 `true`**).
- 우편 행 추가: `sender?`. 공지 행 추가: `author?`, `imageKey?`. 없으면 문서 최상위 `sender` / `author` 폴백.
- **표시**: `userRegionCode`(게임이 정한 ISO2)로 `regionCode` 일치 행 → 없으면 `fallback===true` → 없으면 문서 최상위 `title`/`content`/발송인.

---

## 우편: 발송 모드·반복·만료

- **`dispatchMode`**: `immediate` | `scheduled` | `repeat`. **없으면 `immediate`**.
- **`scheduled` / `repeat`**: **`visibleFrom`**(Timestamp) 이후에만 노출.
- **`repeat`** (문서 1개 = 다회차):
  - `repeatDays[]`: `"Mon"`…`"Sun"` — **UTC 요일** 기준.
  - `repeatTime`: `"HH:mm"` — **UTC** (콘솔이 KST→UTC 저장).
  - **`repeatWindowMs`**: 해당 회차 **유효 구간 길이(ms)**. 수령/표시 만료 판단에 사용.
  - **`expiresAfterDays`**: `1|7|14|30` — 위와 **동일 의미**(사람용 일수). 대략 `repeatWindowMs ≈ expiresAfterDays * 86400000`.
  - **`expiresAt`**: 반복은 보통 센티널 — **`dispatchMode==="repeat"`이면 만료 판단에 쓰지 말 것.**
  - 회차: `windowStart = 해당일 UTC 0시 + repeatTime`, `windowEnd = windowStart + repeatWindowMs`. 오늘(UTC)이 `repeatDays`에 포함이고 `now ∈ [windowStart, windowEnd)` 일 때 그 회차 표시·수령.
- **`personal_mails/.../global_history[]` · 수령 기록**: 반복 수령 시 **`repeatKey`** `"YYYY-MM-DD"`(UTC 날짜)로 회차 구분.
- **`personal_list[]`**: 전역/디스패치와 동일하게 `visibleFrom`, `repeatDays`, `repeatTime`, `repeatWindowMs`, `expiresAfterDays`, `regionContents` 등이 붙을 수 있음.

---

## 공지

- `notices`: `regionContents[]`, `postingAt`, `postSchedule` immediate|scheduled, `isPublic` y|n, `noticeTitle`, `author`, `postingDate` 등.
- 문구 해석은 우편과 동일(지역 매칭 → GLOBAL fallback → 상위 필드).
