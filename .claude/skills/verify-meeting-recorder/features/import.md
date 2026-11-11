# 녹음 파일 가져오기

다른 앱에서 녹음한 파일을 골라(또는 끌어다 놓아) 회의로 가져온다. 확인 창에 파일(이름 순서대로 이어 붙임), 짐작한 회의 날짜·시각과 그 출처, 참석 인원, 녹음에 담기지 않은 내용(메모)이 있고, `가져오기`를 누르면 받아쓰기와 회의록을 만들기 시작한다.

## Sub-features

- `import-pick` `파일 가져오기` → 파일 고르기.
- `import-sheet` 확인 창: 파일 목록, 회의 날짜·시각(짐작 출처), 참석 인원, 메모.
- `import-run` 가져오기 → 본체에 파일 경로와 시각·메모.

## How to get to it (user POV)

- 회의 화면 위 `파일 가져오기`.
- 회의 화면에 파일 끌어다 놓기.

## Driving it with drive.js

Preconditions:

- `"noMeeting": true`. 가짜 파일 고르기는 이름에 시각이 든 m4a 둘을 돌려준다(짐작 출처 `name`, `STUB_GUESS`로 바꿈).

- **고르기.** `{ "go": "#meetings" }`, `{ "click": "파일 가져오기", "role": "button" }` → `{ "expect": { "called": "pickAudio" } }`, `녹음 파일 가져오기`와 파일 이름이 보임.
- **메모.** `{ "fill": "예: 녹음을 끝낸 뒤", "value": "배포일은 목요일로 바꾸기로 함" }`.
- **가져오기.** `{ "click": "가져오기", "role": "button", "exact": true, "within": "#importSheet" }` → `importMeeting`에 두 경로와 `{ "notes": … }`.
- **증거.** 흐름 `journeys/import.json`.

## Gotchas

- 날짜 칸은 `<input type=date>`라 `fill`로 넣을 땐 `YYYY-MM-DD`. 미래 시각은 막힌다.
- 끌어다 놓기 길은 이 도구로 아직 증명하지 않았다.
- 실제 변환·이어 붙이기는 본체(`src/import-audio.js`) 몫이라 이 도구로 증명되지 않는다.
