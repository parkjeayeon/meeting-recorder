---
name: verify-meeting-recorder
description: Meeting Recorder(macOS Electron 받아쓰기·회의록 앱)의 화면을 사용자처럼 조작해 바꾼 동작이 맞는지 증명한다 — 가짜 API로 메인 창을 띄워 단계 목록대로 누르고 입력하고, 화면 접근성 스냅샷·캡처·본체 호출 기록·바뀐 파일을 증거로 남긴다. 화면(src/renderer)을 고친 뒤, React 전환 중 한 화면을 옮긴 뒤, "이거 실제로 되나?"를 확인할 때 쓴다.
---

# Meeting Recorder 검증

화면을 고쳤으면 **사용자가 하는 길 그대로** 해 보고 증거를 남긴다. 실제 녹음 폴더·설정·설치된 앱은 절대 건드리지 않는다 — 이 도구는 가짜 API(`scripts/dev/stub-preload.js`)와 임시 예시 회의로만 돈다.

## 무엇을 검증하나 (면)

| 면 | 어떻게 | 이 스킬에서 |
|---|---|---|
| **메인 창 화면** (주된 면) | 가짜 API로 `src/renderer/index.html`을 숨긴 창에 띄워 조작 | `drive.js` + 기능 지도 |
| 본체 작업 (녹음·회의록·질문 엔진·압축·확인 필요 파일 쓰기) | 임시 폴더에서 도는 점검 스크립트 | 아래 "다른 면" |
| 떠 있는 받아쓰기 막대 | `npx electron scripts/dev/overlay-check.js` | 아래 "다른 면" |
| 명령줄 도구 `mr` (읽기 전용) | `npm test`의 `src/cli/mr.test.mts` (가짜 녹음 폴더, `--dir`) | 아래 "다른 면" |

`npm start`는 **쓰지 않는다**: 실제 녹음 폴더(`~/Documents/MeetingRecorder`)와 설정을 쓰고, 설치된 앱과 단일 실행 잠금이 겹친다. 설치된 앱(`/Applications/Meeting Recorder.app`)이 켜져 있어도 끄거나 조작하지 않는다 — 사용자가 녹음 중일 수 있다.

## 1. 점검 (Doctor) — 먼저, 그리고 뭔가 이상하면 언제든

```bash
node scripts/dev/verify/doctor.js
```
읽기만 한다. Electron, 코어 빌드(`lib/`가 `src/core`보다 새로운지 — 아니면 `npm run build:ts`), 화면 묶음(`lib/renderer/main.js`가 화면 원본보다 새로운지 — 아니면 `npm run build:renderer`, 화면은 이 묶음으로 뜬다), 가짜 API가 preload 함수를 다 덮는지, 증거 폴더, 설치된 앱이 켜져 있는지(정보), 코드 판(git)을 본다. `점검 통과`가 아니면 조작하지 말고 그 줄부터 고친다.

## 2. 띄우고 조작 (Launch + Drive)

```bash
npx electron scripts/dev/verify/drive.js <흐름.json> [--keep]
```
한 번 실행이 띄우기 → 조작 → 증거 → 정리까지 한다(서버를 따로 띄워 두지 않는다). 준비 기준: 화면 첫 그리기(`#view`에 내용)가 끝나고 도우미를 넣은 뒤 첫 단계를 한다. 회의 화면으로 가면 선택된 탭이 생길 때까지 기다린다.

흐름 파일 (기능 지도의 `journeys/*.json`이 실제 예):
```json
{ "about": "무엇을 증명하나", "env": { "STUB_MANY": "30" }, "noMeeting": false, "dark": false,
  "steps": [ { "go": "#meeting/{id}" }, { "click": "확인 필요", "role": "tab" }, { "fill": "고칠 말", "value": "Memcached", "enter": true },
             { "expect": { "called": "applyReview", "args": ["{dir}", [{ "id": "r1", "guess": "Memcached" }]] } }, { "snapshot": "after" } ] }
```

| 단계 | 하는 일 |
|---|---|
| `go` | 주소(`#home` `#dictations` `#meetings` `#meeting/{id}` `#dictionary` `#stats`)로. `{id}`·`{dir}`은 예시 회의 id·폴더 |
| `click` (+`role`: tab·button·link, `within`: 선택자, `exact`) | 이름(aria-label → 글자 → title)으로 찾아 누름. 정확히 같은 이름 → 앞부분 → 포함 순 |
| `fill` (+`value`, `enter`) | 입력칸을 aria-label, placeholder 앞부분, 감싼 label 글자로 찾아 값 넣기 |
| `key` (+`mods`: `["meta"]` 등) | **진짜 키 입력**(sendInputEvent). ⌘F·Esc·Enter, 키 처리기 버그까지 드러난다 |
| `confirm` (true/false) | 앱 확인 창(휴지통·지우기)의 예/아니오 |
| `until` (+`ms`) | 그 글자가 보일 때까지 기다림 |
| `expect` | `text` 보임 · `noText` 안 보임 · `tab` 선택된 탭(앞부분) · `hash` · `toast` · `called`+`args`(부분 일치)/`times` 본체 호출 · `file`+`includes`/`excludes` 예시 회의 파일 |
| `snapshot` / `screenshot` | 화면 접근성 스냅샷(역할·이름·상태) / PNG |
| `js` | 마지막 수단. 화면에 길이 없는 것만(예: 지금 포커스된 입력칸에 쓰기). **사용자 경로의 증거로 쓰지 않는다** |

가짜 데이터 바꾸기(`env`): `STUB_MANY=N` 지어낸 회의 N개(넷째마다 16kHz, 셋째마다 확정, 아홉째마다 실패·짧은 녹음) · `STUB_DICTS=N` 받아쓰기 N개 · `STUB_HISTORY_DICTS=1` 홈에 받아쓰기 · `STUB_STRAY=none` 목록에 없는 폴더 없음 · `STUB_FOLDER=denied` 녹음 폴더 막힘 · `STUB_MINUTES=offline` 회의록 쓰기에서 멈춤 · `OB_STEP=welcome` 처음 설정 · `STUB_ASK_MS`·`STUB_JOB_MS` 가짜 작업 시간. 예시 회의 내용(확인 필요 6항목·용어 2개·할 일 2개)은 `scripts/dev/verify/fixture.js`.

질문으로 찾기의 "실패" 경우: 질문에 `실패`가 들면 시간 초과, `로그인`이 들면 로그인 풀림, `소식없음`이면 끝난 소식을 안 보냄, `느린`이면 10배 느림.

## 3. 증거 (Evidence)

`verify-runs/<시각>-<흐름>/` (git 제외): `steps.json` · `result.json`(단계별 ✓/✗와 이유, 화면 오류) · `NN-이름.aria.txt` · `NN-이름.png` · `end.aria.txt` · `stub-log.json`(본체로 간 **모든** 호출과 인자, 순서대로) · `meeting-after/`(끝난 뒤 예시 회의 파일). 끝 코드 0 = 모든 `expect` 통과 + 화면 오류 없음.

증명 기준:
- 사용자 경로로 한다: 버튼·탭·입력칸·진짜 키. 함수를 직접 부르거나 상태를 직접 바꾸지 않는다.
- **동작과 그 결과를 둘 다**: 누른 뒤 화면(스냅샷)과 본체로 간 호출(`called`), 파일이 바뀌는 기능은 파일(`file`)까지. 끝 화면 하나로는 증명이 아니다.
- 가짜는 본체 경계(preload `api.*`)에서만 쓴다. 그 너머(Whisper·LLM·파일 쓰기 순서)는 이 도구로 증명되지 않는다 → "다른 면"의 점검을 돌린다.
- 지도에 있는 다른 진입점을 건너뛰었으면 "검증함"이라 하지 말고 건너뛴 것을 적는다.

## 4. 정리 (Cleanup)

`drive.js`는 끝나면 창을 닫고 임시 예시 회의 폴더를 지운다(`--keep`이면 남겨 `result.json`의 `meetingDir`에 적는다). 증거는 지우지 않는다. 남은 예시 폴더만 치우기:
```bash
node scripts/dev/verify/cleanup.js          # 실행 기록에 적힌 임시 폴더(mr-verify-*)만, 증거는 그대로
node scripts/dev/verify/cleanup.js --runs   # 증거까지 (다 본 뒤에만)
```
프로세스를 이름으로 죽이지 않는다 — 이 도구는 스스로 끝난다(3분 넘으면 스스로 끝냄).

## 5. 한꺼번에 / 회귀

```bash
npm run verify:journeys   # 지도의 흐름 전부 (약 20초, 통과한 흐름 증거는 안 남김) — npm run dist가 돌린다
npm run test:feature      # 기능 시험 45건 (scripts/dev/feature-test.js) — 같은 도우미·예시 회의
npm run test:ui           # 입력칸 진짜 키·진행 중 표시·툴팁·질문 엔진 화면 등 48건
```

**React/TypeScript 전환의 합격 기준**: 전환은 동작을 그대로 두고 안쪽만 바꾸는 일이다(Electron 유지). 화면 하나를 옮길 때마다 위 세 가지가 **시험을 고치지 않고** 통과해야 한다. 시험을 고쳐서 통과시켰다면 그건 동작이 바뀐 것이니 사용자에게 먼저 묻는다. 이 시험들이 클래스 이름이 아니라 글자·역할·aria로 찾는 이유다 — 옮기며 aria 이름이나 화면 글자를 바꾸지 않는다.

## 다른 면

```bash
npx electron scripts/dev/ask-engine-check.js     # 질문으로 찾기 본체(색인·조건·추리기, 가짜 LLM)
npx electron scripts/dev/compress-check.js       # 녹음 압축(say로 만든 30초 회의, 끊긴 뒤 정리, 16kHz 제외)
npx electron scripts/dev/review-crash-check.js   # 확인 필요 적용·되돌리기를 강제 종료 40번
npx electron scripts/dev/review-unify-check.js   # 이름 두 가지 통일
npx electron scripts/dev/overlay-check.js        # 떠 있는 받아쓰기 막대
npm test                                          # 코어 단위 시험·명령줄 도구 mr (가짜 녹음 폴더)
```
실제 녹음으로 녹취부터 다시 돌려 봐야 하면 `scripts/dev/rerun-meeting.js`를 **회의 폴더 사본**에(docs/testing.md). 실제 회의 내용은 사용자에게 묻지 않고 읽지 않는다.

## 기능 지도

[`features/README.md`](features/README.md) — 기능마다 사용자 진입점, 이 도구로 조작하는 법, 끝 상태 증거, 함정. 흐름 파일은 `journeys/`. 기능을 고치거나 더하면 그 기능 파일과 흐름을 같이 고친다.
