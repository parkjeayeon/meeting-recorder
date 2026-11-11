# 확인 필요

회의록을 만들며 LLM이 고른 "잘못 들린 말·불분명한 이름·근거가 없는 문장"을 사용자가 하나씩 처리한다. 고칠 말을 넣고 적용하면 녹취·정리본·회의록이 함께 바뀌고 항목은 처리함으로 간다. 확인 마치기 전까지는 처리한 것도 되돌리거나 다시 열 수 있고, 마치면 잠긴다.

## Sub-features

- `review-apply` 추정이 채워진 고칠 말을 적용(버튼 또는 Enter).
- `review-type` 추정이 없는 항목에 고칠 말을 직접 넣어 적용.
- `review-resolve` 녹취에 그 글자가 없는 이름 항목에 확인한 내용을 적고 확인됨.
- `review-keep` 그대로 두기(근거 확인 항목 포함).
- `review-bulk` 모두 고르기 → 추정대로 적용(고칠 말이 있는 것만)·그대로 두기·채팅으로 확인.
- `review-undo` 처리함에서 고친 항목 되돌리기, 그대로 둔 항목 다시 열기.
- `review-finalize` 확인 마치기(남은 것은 그대로 둔 것으로), 이후 처리함 잠김.

## How to get to it (user POV)

- 회의 화면의 `확인 필요` 탭 (탭 숫자 = 남은 항목 수).
- 회의 목록의 확인할 회의 카드 `확인하기`·`확인 마치기`.
- 홈 `챙길 일`의 `확인할 회의` → 회의 목록의 그 갈래 → 회의.

## Driving it with drive.js

Preconditions:

- 기본 예시 회의(남은 4, 처리함 2). `doctor.js` 통과.

- **탭 열기.** `{ "go": "#meeting/{id}" }`, `{ "click": "확인 필요", "role": "tab" }`. `{ "expect": { "tab": "확인 필요4" } }`.
- **추정대로 적용.** `{ "fill": "고칠 말", "value": "Memcached", "enter": true }` (첫 `고칠 말` 칸이 r1). `{ "expect": { "called": "applyReview", "args": ["{dir}", [{ "id": "r1", "guess": "Memcached" }]] } }`, 탭이 `확인 필요3`.
- **처리함 확인.** `{ "click": "처리함", "role": "button" }`. `Memcached`가 보이고, `{ "expect": { "file": "review.json", "includes": ["\"status\":\"applied\""] } }`.
- **확인됨.** `{ "fill": "확인한 내용", "value": "외부 개발자" }`, `{ "click": "확인됨" }`. `applyReview`에 `{ "id": "r3", "resolve": "외부 개발자" }`.
- **확인 마치기.** `{ "click": "남은 4개는 그대로 두고 확인 마치기" }`. `{ "expect": { "called": "finalizeReview" } }`, 알림 `회의록을 확정했습니다`, 처리함에 `되돌리기`·`다시 열기`가 없음.
- **증거.** `{ "snapshot": "after" }`, `{ "screenshot": "after" }`. 흐름 `journeys/review-apply.json`.

## Gotchas

- 항목마다 `고칠 말` 칸이 있다. 이름으로 찾으면 첫 칸(r1)이 잡힌다 — 다른 항목은 `within`으로 그 카드를 좁히거나 `js`로 고른다.
- `처리함`·`남은 것`은 칩 버튼이다(`role: "button"`). 탭이 아니다.
- 되돌리기는 예시의 r5만 된다. 항목에 `failRevert: true`를 붙이면 가짜 API가 실패시켜 오류 알림을 볼 수 있다.
- 확인 마치기 버튼 글자는 남은 수에 따라 바뀐다(`확인 마치기` / `남은 N개는 그대로 두고 확인 마치기`).
- 실제 녹취 치환(같은 글자 모두 바꾸기·되돌리기의 줄 단위 복원)은 가짜 API가 흉내만 낸다 → `review-crash-check.js`·`review-unify-check.js`로 본체를 확인한다.
