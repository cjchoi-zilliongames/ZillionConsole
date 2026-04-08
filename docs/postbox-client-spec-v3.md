# 우편 시스템 v3 — 지역(`regionContents`) 명세

> **작성일**: 2026-04-08  
> **전제**: [우편 시스템 v2](./postbox-client-spec-v2.md)의 `dispatchMode`, `visibleFrom`, 반복 우편 규칙 등은 그대로 적용된다. v3는 **다국어 배열 필드명·스키마**만 바꾼다.

---

## 1. Breaking 변경 요약

| v2 (언어) | v3 (지역) |
|-----------|-----------|
| `localeContents[]` | **`regionContents[]`** |
| 항목 필드 `language` | 항목 필드 **`regionCode`** (`GLOBAL` 또는 ISO 3166-1 alpha-2 대문자) |
| (관례) 첫 행 `en` + 폴백 | 첫 행 **`GLOBAL`**, **`fallback: true` 는 GLOBAL 행만** |

레거시 문서에 `localeContents` / `language`만 있을 수 있다. **신규 저장은 `regionContents`만 쓴다.** 구버전 클라이언트는 필드 존재 여부로 분기한다.

---

## 2. `regionContents[]` 항목 스키마

`global_mails`, `personal_mail_dispatches`, `personal_mails.personal_list[]` 등 우편 본문이 배열로 나뉜 곳에 공통 적용.

| 필드 | 타입 | 설명 |
|------|------|------|
| `regionCode` | `string` | **`GLOBAL`** 또는 정확히 2자리 `A–Z` (예: `KR`, `US`) |
| `title` | `string` | 해당 지역 제목 |
| `content` | `string` | 해당 지역 본문 |
| `sender` | `string` | (선택) 지역별 발송인. 없으면 문서 최상위 `sender` 폴백 |
| `fallback` | `boolean` | 규약상 **`GLOBAL` 행만 `true`** |

문서 최상위 `title`, `content`, `sender`는 하위 호환용으로 유지될 수 있다.

---

## 3. 표시 문구 선택 알고리즘

게임이 유저의 현재 지역 코드 `userRegionCode`(ISO 2자리)를 정한 뒤:

1. `regionContents`에서 `regionCode === userRegionCode` 인 항목이 있으면 그 행의 `title` / `content` / `sender`(또는 상위 `sender` 폴백).
2. 없으면 `fallback === true` 인 행(규약상 **GLOBAL**)을 사용.
3. 그래도 없으면 문서 최상위 `title` / `content` / `sender`.

의사 코드:

```
function resolveMailCopy(mail, userRegionCode):
    rows = mail.regionContents ?? mail.localeContents  // 구버전 호환 시
    if rows:
        exact = find row where normalize(row.regionCode ?? row.language) == userRegionCode
        if exact:
            return pickSender(exact, mail)
        fb = find row where row.fallback == true
        if fb:
            return pickSender(fb, mail)
    return { title: mail.title, content: mail.content, sender: mail.sender }
```

`localeContents` / `language`는 **마이그레이션 전 레거시**이며, 언어 코드를 지역 코드로 1:1 가정하면 안 된다.

---

## 4. 배포·버전

- 콘솔·Firestore가 v3 필드만 쓰기 시작하면, **구 클라이언트**는 `regionContents`를 모를 수 있다 → 반드시 **클라 버전과 데이터 마이그레이션 시점**을 맞출 것.
- 신규 클라이언트는 `regionContents` 우선, 없을 때만 `localeContents` 읽기 폴백을 잠시 유지할 수 있다.
