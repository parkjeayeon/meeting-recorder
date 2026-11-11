# 처음 설정

처음 켜면 전체 화면 안내가 단계별로 나온다: 시작 → 권한 → (회의를 쓰면) 토큰 → 엔진 → 계정 → 마이크 → (받아쓰기를 쓰면) fn 키 → 연습 → 끝. 단계마다 진행 위치를 저장해 다시 켜도 이어진다. `뒤로`로 돌아갈 수 있고, 권한 단계에는 `나중에 하기`가 있다.

## Sub-features

- `ob-next` 시작하기·계속으로 다음 단계, 진행 저장.
- `ob-back` 뒤로.
- `ob-perms` 권한 상태(모두 허용 / 허용 필요)와 나중에 하기.
- `ob-finish` 마지막 시작하기 → 완료 저장, 안내 닫힘.

## How to get to it (user POV)

- 처음 실행.
- 설정에서 처음 설정 다시 보기.

## Driving it with drive.js

Preconditions:

- `"env": { "OB_STEP": "welcome" }` (권한 막힘을 보려면 `"OB_STEP": "permissions"` — 입력 모니터링이 거부로 나온다).

- **시작.** `{ "until": "Meeting Recorder를 시작합니다" }`, `{ "click": "시작하기", "role": "button", "wait": 600 }` → `{ "expect": { "called": "onboardingSet", "args": [{ "step": "permissions" }] } }`, `권한`이 보임.
- **뒤로.** `{ "click": "뒤로", "role": "button" }` → `Meeting Recorder를 시작합니다`.
- **증거.** 흐름 `journeys/onboarding.json`.

## Gotchas

- 처음 설정 화면엔 주소(`location.hash`)가 없다.
- 실제 권한 요청·엔진 설치는 가짜 API가 흉내만 낸다.
