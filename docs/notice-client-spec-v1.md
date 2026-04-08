# 공지 — Firestore `notices/{uuid}`

## 문서

| 필드 | 타입 |
|------|------|
| `noticeTitle` | `string` |
| `author` | `string` |
| `isPublic` | `"y" \| "n"` |
| `postSchedule` | `immediate` \| `scheduled` |
| `postingDate` | `YYYY-MM-DD` |
| `postingAt` | `Timestamp` |
| `regionContents` | `array` (아래) |

## `regionContents[]` 행

| 필드 | 타입 |
|------|------|
| `regionCode` | `GLOBAL` \| ISO3166 alpha-2 |
| `title` | `string` |
| `content` | `string` |
| `imageKey` | `string` (선택) |
| `author` | `string` (선택, 없으면 루트 `author`) |
| `fallback` | `boolean` (GLOBAL만 `true`) |

## 표시

우편과 동일: `userRegionCode` 일치 행 → `fallback` 행 → 루트 필드.
