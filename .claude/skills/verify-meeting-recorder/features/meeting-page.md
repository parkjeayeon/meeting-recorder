# 회의 페이지

회의 하나를 열면 제목·메타, 화자 이름 막대, 재생 막대, 탭(회의록·확인 필요·액션·정리본·원본·화자)이 보인다. ⌘F로 지금 탭 본문을 찾고, 화자 이름을 눌러 바꾸고, 회의록의 할 일을 체크하고, 용어 설명을 확인한다.

## Sub-features

- `page-tabs` 탭 옮기기, 탭마다 본문.
- `page-find` ⌘F 찾기(찾은 수 `1/N`, 없으면 `없음`, Esc로 닫기).
- `page-speaker` 화자 칩 → 이름 입력 → Enter → 회의록·스크립트에 반영 알림.
- `page-todo` 회의록 할 일 체크(그 줄만 파일에 `[x]`).
- `page-term` 용어 카드: 추정은 `맞아요`, `고치기`, `지우기`.
- `page-menu` `더 보기`(…) 메뉴: 녹음 압축·휴지통으로 옮기기(확인 창).
- `page-remake` `다시 만들기` → `녹취부터 다시 만들기`.

## How to get to it (user POV)

- 회의 목록·홈 최근 회의 줄·⌘K 팔레트에서 회의 제목.
- 질문 탭의 결과 줄.

## Driving it with drive.js

Preconditions:

- 기본 예시 회의.

- **탭.** `{ "go": "#meeting/{id}" }` → `{ "expect": { "tab": "회의록" } }`, `{ "click": "원본", "role": "tab" }` → `{ "expect": { "text": "랩캐시도 쪽 확인만" } }`.
- **⌘F.** `{ "key": "f", "mods": ["meta"] }`, `{ "fill": "이 탭 본문에서 찾기", "value": "배포" }` → `{ "expect": { "text": "1/" } }`, `{ "key": "Escape" }`.
- **화자 이름.** `{ "click": "화자 1", "role": "button" }` 뒤 포커스된 입력칸에 이름을 쓰고 Enter(`js` 단계, 흐름 참고) → `{ "expect": { "called": "renameSpeaker", "args": ["{dir}", "화자 1", "민준"] } }`, `{ "expect": { "toast": "민준" } }`.
- **할 일.** 첫 `할 일 완료` 체크박스 → `{ "expect": { "file": "minutes.md", "includes": ["- [x] QA 마치기"] } }`.
- **용어.** `{ "click": "알림", "role": "button" }` → 카드 `알림 설명`, `{ "click": "맞아요" }` → `updateTerm`에 `["{dir}", "g2", { "status": "confirmed" }]`.
- **휴지통.** `{ "click": "더 보기", "role": "button" }`, `{ "click": "휴지통으로 옮기기" }`, `{ "confirm": true }` → `{ "expect": { "called": "trashMeeting", "args": ["{dir}"] } }`.
- **증거.** 흐름 `journeys/meeting-basics.json`.

## Gotchas

- 화자 이름 입력칸은 칩을 누르면 그 자리에 생기고 포커스를 받는다. 이름표가 없어 `fill`로 못 찾는다 → `js`로 포커스된 칸에 쓴다(사용자에겐 같은 동작).
- 재생은 가짜 환경에서 소리가 없다(`rec://` 오류는 무시). 재생 위치 증명은 이 도구로 하지 않는다.
- ⌘F 강조는 CSS Highlight API라 본문에 `<mark>`가 없다. 찾은 수 글자로 확인한다.
- 액션 탭은 `actions.json`이 있을 때만 보인다(기본 예시엔 없음).
