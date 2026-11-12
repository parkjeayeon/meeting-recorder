# 홈

앱을 열면 보이는 첫 화면(React). 위에 인사와 오늘 받아쓴 글자 한 줄, 확인해야 할 문제(권한·녹음 폴더 등), 왼쪽은 만드는 중인 회의 카드 → 챙길 일 → 최근 회의 5개 → 최근 받아쓰기 4개, 오른쪽은 시작하기(남은 단계가 있을 때만) → 녹음 공간.

## Sub-features

- `home-line` 오늘 글자·WPM·연속 사용일·오늘 회의 수 (없으면 fn 안내).
- `home-issue` 문제 알림: 버튼(예: `권한 열기`), 닫을 수 있는 알림은 `닫기`.
- `home-jobs` 만드는 중 카드(받아쓰는 중 %·화자 구분 중·쓰는 중·차례 기다림, 진행 막대).
- `home-todo` 챙길 일 → 회의 화면의 그 갈래(확인할 회의·회의록이 없는 녹음·목록에 없는 폴더) 또는 압축할 회의.
- `home-recent` 최근 회의 줄 → 그 회의.
- `home-dicts` 최근 받아쓰기: 교정 부호(지운 말·넣은 말)·`많이 고침`·`다듬기 실패`, `복사`(1.4초 체크)·`다시 붙여넣기` — 둘 다 다듬은 글을 보낸다.
- `home-steps` 시작하기: `권한 보기`·`설정 보기`·`녹음 시작`.
- `home-storage` 녹음 공간 (압축 쪽은 [녹음 압축](./compress.md)).

## How to get to it (user POV)

- 앱을 열 때, 왼쪽 메뉴 `홈`, `#home`.

## Driving it with drive.js

Preconditions:

- `"noMeeting": true, "env": { "STUB_DICTS": "3", "STUB_HISTORY_DICTS": "1", "STUB_MANY": "6", "STUB_BUSY": "1", "STUB_DICT_EDITS": "1", "STUB_FOLDER": "denied" }` — 만드는 중 회의 셋, 다듬기가 고친 받아쓰기 셋, 녹음 폴더 막힘 알림.

- **만드는 중.** `{ "go": "#home" }` → `받아쓰는 중 42% · 화자 구분 중`.
- **문제 알림.** `{ "click": "권한 열기", "role": "button" }` → `{ "expect": { "called": "permOpenSettings", "args": ["files"] } }`.
- **받아쓰기 복사.** `{ "click": "복사", "within": ".dlist", "exact": true }` → `{ "expect": { "called": "copy", "args": ["다음 주에 배포 일정을 잡아 주세요."] } }`. `다시 붙여넣기`도 같은 글로 `repaste`.
- **챙길 일.** `{ "click": "확인할 회의" }` → `{ "expect": { "hash": "#meetings" } }`.
- **증거.** 흐름 `journeys/home.json`.

## Gotchas

- `복사`는 받아쓰기 줄마다 있다 — `within: ".dlist"`와 `exact`로 첫 줄을 누른다.
- 시작하기는 다 끝나면 사라진다(가짜 데이터 기본은 받아쓰기가 없어 `fn으로 받아쓰기`만 남음).
- 홈은 자주 다시 그린다(권한을 3초마다 확인). 단계 사이에 상태를 손으로 바꾸지 않는다.
