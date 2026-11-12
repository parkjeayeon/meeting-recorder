# 회의 목록

(React 화면. 질문 탭 본문만 아직 옛 화면 코드.) 회의 화면은 확인할 회의 카드(최대 6, 넘치면 `N건 더 보기`), 최근 회의 20개, 이전 회의(달별)로 묶이고 오른쪽에 바로가기가 있다. 갈래 칩(전체·확인 완료·확인할 회의·녹음만 · 실패)과 검색으로 거르고, 줄을 누르면 회의가 열린다.

## Sub-features

- `list-filter` 갈래 칩, 칩 숫자 = 그 갈래 회의 수.
- `list-search` 제목·요약 검색.
- `list-more` 확인할 회의 넘침 → 확인할 회의 갈래.
- `list-rail` 오른쪽 바로가기(확인할 회의·최근 회의·달).
- `list-open` 줄을 눌러 회의 열기.
- `list-stray` 목록에 안 나오는 폴더 → Finder에서 보기·휴지통(하나·모두).
- `list-redo` 실패·녹음만 줄의 `다시 만들기` → 그 회의.
- `list-trash` `녹음만 · 실패` 갈래의 `모두 휴지통으로`(확인 창), 줄마다 `휴지통으로`.
- `list-drop` 녹음 파일을 끌어다 놓으면 가져오기(drive.js로는 못 함 — 단위 시험 `pages/meetings/ui.test.tsx`).

## How to get to it (user POV)

- 사이드바 `회의`.
- 홈 `챙길 일`(그 갈래로), `최근 회의`의 `모두 보기`.

## Driving it with drive.js

Preconditions:

- `"env": { "STUB_MANY": "30" }` (지어낸 회의 30개 + 예시 회의).

- **갈래.** `{ "go": "#meetings" }`, `{ "click": "녹음만 · 실패" }` → 스냅샷. `{ "click": "전체" }`.
- **검색.** `{ "fill": "제목, 요약 검색", "value": "채용" }` → `{ "expect": { "text": "채용 면접" } }`, `{ "expect": { "noText": "배포 점검" } }`.
- **열기.** `{ "click": "채용 면접", "role": "link" }` → 그 회의 화면.
- **증거.** 흐름 `journeys/meetings-list.json`.

## Gotchas

- 실패·녹음만 회의는 `확인할 회의`와 `녹음만 · 실패` 둘 다에 든다. 칩 숫자 합이 전체보다 크다.
- 확인할 회의 카드는 다른 묶음에도 같은 회의가 나올 수 있어 `click`이 첫 번째(카드)를 잡는다.
- 목록에 안 나오는 폴더 상자는 `drive.js`가 기본으로 끈다(`STUB_STRAY: none`) — 흐름의 `env`에 `"STUB_STRAY": "some"`처럼 다른 값을 주면 보인다. 흐름 `meetings-cleanup`.
- `휴지통으로`는 폴더 줄·회의 줄 모두에 있다 — `within: ".stray-row"`처럼 범위를 준다.
