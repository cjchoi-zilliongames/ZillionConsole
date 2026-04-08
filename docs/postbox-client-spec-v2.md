# 우편 시스템 v2 — 게임 클라이언트 변경 명세

> **작성일**: 2026-04-07
> **변경 요약**: 서버 Cron 제거. 모든 우편(즉시/예약/반복)은 관리 콘솔에서 등록하는 순간 Firestore에 **실제 문서로 즉시 생성**된다. 게임 클라이언트가 `visibleFrom`, `repeatDays` 등 새 필드를 읽어 **표시 여부와 수령 가능 여부를 직접 판단**해야 한다.

---

## 1. 컬렉션 구조 변경 없음

| 컬렉션 | 변경 |
|--------|------|
| `global_mails` | 기존 그대로. **필드만 추가** |
| `personal_mails/{uid}` | 기존 그대로. `personal_list[]` / `global_history[]` **필드만 추가** |
| `personal_mail_dispatches` | 기존 그대로. **필드만 추가** |

---

## 2. 새로 추가된 필드

### 2-1. `global_mails/{id}` · `personal_mail_dispatches/{id}` 문서

| 필드 | 타입 | 조건 | 설명 |
|------|------|------|------|
| `dispatchMode` | `"immediate" \| "scheduled" \| "repeat"` | 항상 | 발송 방식. 기존 문서에는 없으므로 **없으면 `"immediate"`** 취급 |
| `visibleFrom` | `Timestamp` | `scheduled`, `repeat` | 이 시각 이후부터 클라이언트에 표시 |
| `repeatDays` | `string[]` | `repeat` | 반복 요일. `"Mon"` `"Tue"` `"Wed"` `"Thu"` `"Fri"` `"Sat"` `"Sun"` |
| `repeatTime` | `string` | `repeat` | 반복 시각. `"HH:mm"` 형식, **UTC** (관리 콘솔에서 KST→UTC 변환 후 저장됨) |
| `repeatWindowMs` | `number` | `repeat` | 각 회차의 유효 시간(밀리초). 이 시간이 지나면 해당 회차 미수령 처리 |
| `expiresAfterDays` | `number` | `repeat` | 관리자가 선택한 회차별 만료 일수 (`1` / `7` / `14` / `30`). `repeatWindowMs`와 동일 의미의 사람 친화적 표현 |

> `isActive`, `expiresAt`, `createdAt`, `title`, `content`, `sender`, `rewards`, `localeContents` 등 기존 필드는 **그대로** 유지.

### 2-2. `personal_mails/{uid}.personal_list[]` 항목

기존 `PersonalListEntry`에 아래 필드가 **선택적으로** 추가됨:

| 필드 | 타입 | 조건 | 설명 |
|------|------|------|------|
| `visibleFrom` | `Timestamp` | `scheduled`, `repeat` | 위와 동일 |
| `repeatDays` | `string[]` | `repeat` | 위와 동일 |
| `repeatTime` | `string` | `repeat` | 위와 동일 |
| `repeatWindowMs` | `number` | `repeat` | 위와 동일 |
| `expiresAfterDays` | `number` | `repeat` | 위와 동일 |

### 2-3. `personal_mails/{uid}.global_history[]` 항목

| 필드 | 타입 | 조건 | 설명 |
|------|------|------|------|
| `repeatKey` | `string` | 반복 우편 수령 시 | 어느 회차에서 수령했는지. **`"YYYY-MM-DD"`** 형식 (UTC 기준 날짜) |

---

## 3. 클라이언트 표시 로직

### 3-1. 즉시 우편 (`dispatchMode` 없음 또는 `"immediate"`)

**변경 없음.** 기존과 동일하게 처리.

```
표시 조건: isActive && now < expiresAt
```

### 3-2. 예약 우편 (`dispatchMode === "scheduled"`)

문서는 이미 Firestore에 존재하지만, `visibleFrom` 이전에는 **숨겨야** 한다.

```
표시 조건: isActive && now >= visibleFrom && now < expiresAt
```

- `visibleFrom` 이전 → 문서가 보여도 무시
- `visibleFrom` 이후 → 일반 즉시 우편과 동일 동작
- `expiresAt` 이후 → 만료

### 3-3. 반복 우편 (`dispatchMode === "repeat"`)

**문서 1개**로 여러 회차를 표현한다. 클라이언트가 우편함을 열 때마다 "지금이 유효 회차 안인지" 계산한다.

#### 회차 윈도우 계산

```
1. now(UTC)의 요일이 repeatDays[]에 포함되는지 확인
2. 포함되면:
   windowStart = 오늘(UTC) + repeatTime (HH:mm)
   windowEnd   = windowStart + repeatWindowMs
   표시 조건: now >= windowStart && now < windowEnd
3. 포함되지 않으면: 숨김
```

**주의**: `repeatTime`과 `repeatDays`는 **UTC** 기준으로 저장된다. 관리 콘솔에서 KST 입력값을 UTC로 변환 후 저장하므로, 클라이언트는 UTC 그대로 사용하면 된다. 로컬 시간 변환 불필요.

#### 의사 코드

```
function isRepeatMailVisible(mail, now):
    utcDayName = getDayName(now)  // "Mon", "Tue", ...
    if utcDayName not in mail.repeatDays:
        return false

    todayUTC = startOfDayUTC(now)
    [hours, minutes] = parse(mail.repeatTime)
    windowStart = todayUTC + hours * 3600000 + minutes * 60000
    windowEnd   = windowStart + mail.repeatWindowMs

    return now >= windowStart AND now < windowEnd
```

#### `expiresAt` 처리

반복 우편의 `expiresAt`은 `2099-12-31T23:59:59Z` (센티널 값)으로 설정된다. 클라이언트는 `dispatchMode === "repeat"`이면 `expiresAt`을 **무시**하고 위 윈도우 계산으로만 판단한다.

#### 반복 우편 회차별 만료 시간 — `expiresAfterDays`

반복 우편은 관리자가 **상대적인 만료 기간**(1일 / 7일 / 14일 / 30일)을 선택한다. 이 값이 `expiresAfterDays` 필드로 저장된다.

| 필드 | 타입 | 예시 | 설명 |
|------|------|------|------|
| `expiresAfterDays` | `number` | `7` | 각 회차 시작 시각으로부터 이 일수가 지나면 해당 회차 만료 |
| `repeatWindowMs` | `number` | `604800000` | 동일 값의 밀리초 표현 (`expiresAfterDays * 86400000`) |

두 필드는 동일한 의미이다. `expiresAfterDays`는 사람이 읽기 쉬운 일수, `repeatWindowMs`는 계산용 밀리초.

**클라이언트 회차별 만료 계산**:

```
windowStart = 오늘(UTC) + repeatTime
windowEnd   = windowStart + (expiresAfterDays * 86400000)
            = windowStart + repeatWindowMs

해당 회차 만료 = now >= windowEnd
```

> `expiresAfterDays`가 없는 구 데이터는 `repeatWindowMs / 86400000`로 일수를 역산하거나, `repeatWindowMs` 그대로 사용.

---

## 4. 수령(Claim) 처리

### 4-1. 즉시 · 예약 우편

**변경 없음.** 기존과 동일하게 `claimedAt` / `isClaimed` 기록.

### 4-2. 반복 우편 — 전체 발송 (global_mails)

수령 시 `global_history[]`에 항목을 추가할 때, **`repeatKey` 필드를 포함**해야 한다:

```json
{
  "globalMailId": "gm_20260407_090000",
  "title": "매일 출석 보상",
  "rewards": [...],
  "sender": "운영팀",
  "claimedAt": Timestamp,
  "repeatKey": "2026-04-07"
}
```

**`repeatKey` 생성 규칙**: `YYYY-MM-DD` (UTC 기준 오늘 날짜)

#### 중복 수령 방지

```
function hasClaimedThisInstance(globalHistory, mailId, now):
    todayKey = formatUTC(now, "YYYY-MM-DD")
    return globalHistory.any(entry =>
        entry.globalMailId == mailId AND entry.repeatKey == todayKey
    )
```

- `repeatKey`가 오늘과 같은 항목이 이미 있으면 → **수령 완료** (보상 표시 안 함)
- 없으면 → 미수령 (보상 수령 가능)

### 4-3. 반복 우편 — 지정 발송 (personal_list)

`personal_list[]` 항목의 기존 `claimedAt` 대신, 아래 방식으로 회차별 수령을 추적:

**방법 A (권장 — `lastClaimedAt` 비교)**:
```
기존 claimedAt 필드를 그대로 사용:
- 수령 시 claimedAt = now (Timestamp)
- 다음 회차 시작 시 claimedAt < windowStart 이면 → 미수령으로 다시 표시
```

```
function hasClaimedThisWindow(entry, windowStart):
    if entry.claimedAt == null: return false
    return entry.claimedAt >= windowStart
```

이 방식은 `personal_list` 배열이 무한히 커지지 않는 장점이 있다.

---

## 5. 하위 호환

| 상황 | 처리 |
|------|------|
| `dispatchMode` 필드 없음 | `"immediate"` 취급. 기존 로직 그대로 |
| `visibleFrom` 필드 없음 | 즉시 표시 (기존과 동일) |
| `repeatDays` 필드 없음 | 반복 아님 (기존과 동일) |
| `repeatKey` 없는 `global_history` 항목 | 기존 1회성 수령 기록. 무시하지 말 것 |

---

## 6. 요약 체크리스트

- [ ] 우편함 열 때 `dispatchMode` 필드 확인 로직 추가
- [ ] `"scheduled"`: `visibleFrom` 이전이면 숨김
- [ ] `"repeat"`: 요일 + 시각 윈도우 계산해서 표시/숨김
- [ ] `"repeat"` 전체 우편 수령 시 `global_history`에 `repeatKey` 포함
- [ ] `"repeat"` 지정 우편 수령 시 `claimedAt` 갱신 → 윈도우 시작과 비교로 재표시
- [ ] `expiresAt`이 `2099-12-31` 센티널이면 반복 우편 — `expiresAt` 무시
- [ ] 하위 호환: 새 필드 없으면 기존 로직 유지

---

## 7. 시간대 (Timezone) 규칙

| 필드 | 저장 형식 | 시간대 |
|------|----------|--------|
| `visibleFrom` | Firestore Timestamp | UTC (관리 콘솔이 KST 입력을 UTC Timestamp으로 변환) |
| `repeatTime` | `"HH:mm"` 문자열 | **UTC** (관리 콘솔이 KST→UTC 변환 후 저장. 예: KST 10:00 → `"01:00"`) |
| `repeatDays` | `string[]` | **UTC 기준 요일** (KST 자정 경계를 넘으면 요일도 시프트. 예: KST 화 02:00 → UTC 월 17:00 → `["Mon"]`) |
| `expiresAt` | Firestore Timestamp | UTC |
| `createdAt` | Firestore Timestamp | UTC (서버 자동) |
| `repeatWindowMs` | `number` (ms) | 시간대 무관 (duration) |

> 클라이언트는 모든 시간 필드를 **UTC 그대로** 해석하면 된다. 별도 시간대 변환 불필요.

---

## 8. 언어별 발송인(sender) — v3 변경

### 변경 의도

기존에는 우편 문서에 전역 `sender` 필드 하나만 있었다. 다국어 우편에서 발송인도 언어별로 다르게 표시해야 하므로, `localeContents[]` 배열 안에 `sender` 필드를 추가했다. 전역 `sender`는 하위 호환용으로 유지한다.

### 우편 (global_mails / personal_mail_dispatches)

| 위치 | 필드 | 타입 | 설명 |
|------|------|------|------|
| `localeContents[]` | `sender` | `string` | **NEW (v3)** — 해당 언어의 발송인. 예: `"운영팀"` (ko), `"Operations"` (en) |
| 문서 루트 | `sender` | `string` | 하위 호환용. FB 언어의 sender와 동일 값. 새 필드가 없는 구 데이터에서 폴백 |

**클라이언트 발송인 결정 우선순위**:
1. 유저 언어에 매칭되는 `localeContents[]` 항목의 `sender` 사용
2. 매칭 항목 없거나 `sender`가 빈 문자열이면 → `fallback: true` 항목의 `sender`
3. 그래도 없으면 → 문서 루트의 전역 `sender` 필드

### personal_list[] 항목

`PersonalListEntry.localeContents[].sender` 동일 적용. 전역 `PersonalListEntry.sender`도 하위 호환용으로 유지.

### 공지 (notices)

| 위치 | 필드 | 타입 | 설명 |
|------|------|------|------|
| `contents[]` | `author` | `string` | **NEW (v3)** — 해당 언어의 작성자 |
| 문서 루트 | `author` | `string` | 하위 호환용. FB 언어의 author와 동일 값 |

클라이언트 결정 우선순위: 우편의 `sender`와 동일 패턴.

---

## 9. 필드 전체 타입 참조

```typescript
// Firestore 문서 필드 (global_mails / personal_mail_dispatches)
type DispatchMode = "immediate" | "scheduled" | "repeat";
type RepeatDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

interface MailDocument {
  // 기존 필드 (변경 없음)
  title: string;
  content: string;
  sender: string;
  isActive: boolean;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  rewards: { table: string; row: string; count: number; rowValues?: Record<string, string> }[];
  localeContents?: {
    language: string;
    title: string;
    content: string;
    sender?: string;       // v3: 언어별 발송인
    fallback: boolean;
  }[];

  // v2 추가 필드
  dispatchMode?: DispatchMode;       // 없으면 "immediate"
  visibleFrom?: Timestamp;           // scheduled, repeat
  repeatDays?: RepeatDay[];          // repeat
  repeatTime?: string;               // repeat, "HH:mm" UTC
  repeatWindowMs?: number;           // repeat, ms
  expiresAfterDays?: number;         // repeat, 관리자 선택 일수 (1/7/14/30)
}

// personal_list[] 항목
interface PersonalListEntry {
  mailId: string;
  title: string;
  content: string;
  rewards: { table: string; row: string; count: number; rowValues?: Record<string, string> }[];
  expiresAt: Timestamp;
  sender: string;                    // 하위 호환용 (FB sender)
  localeContents?: {
    language: string;
    title: string;
    content: string;
    sender?: string;       // v3: 언어별 발송인
    fallback: boolean;
  }[];
  claimedAt?: Timestamp;
  isClaimed?: boolean;
  dismissedAt?: Timestamp;

  // v2 추가 필드
  visibleFrom?: Timestamp;
  repeatDays?: RepeatDay[];
  repeatTime?: string;
  repeatWindowMs?: number;
  expiresAfterDays?: number;         // 관리자 선택 일수 (1/7/14/30)
}

// global_history[] 항목
interface GlobalHistoryEntry {
  globalMailId: string;
  title: string;
  rewards: { table: string; row: string; count: number; rowValues?: Record<string, string> }[];
  sender?: string;
  claimedAt?: Timestamp;

  // v2 추가 필드
  repeatKey?: string;                // "YYYY-MM-DD" — 반복 우편 회차 식별
}
```
