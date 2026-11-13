# 화면을 TypeScript + React로 옮기는 계획

## 현재 상태 (2026-11-14)

TS + React 전환과 `legacy/` 삭제 완료. `app/`이 조립을 맡고 `app/boot.ts`의 `startRenderer()`가 시작 순서를 관리한다.

- 녹음 위 막대·회의 시작 창 마크업도 React로 옮겨, index.html에는 빈 자리(호스트)만 남았다.
- 다음 단계: E2E 시험을 Playwright로 전환.

## 조건 (사용자 결정, 2026-11-11)
- **동작은 그대로, 안쪽만 바꾼다.** 사용자가 보는 화면 글자·버튼 이름(aria)·흐름·결과가 같아야 한다. 동작을 바꾸고 싶어지면 옮기는 일과 따로, 먼저 묻는다.
- **Electron은 유지한다.** 메인 프로세스(`src/main.js` 등), preload의 `api.*`, 회의 폴더 파일 형식, `src/core`는 그대로 둔다. 바꾸는 것은 화면(`src/renderer`)뿐.
- 구조는 FSD(Feature-Sliced Design): app · pages · widgets · features · entities · shared, 조각마다 ui/model/api와 시험.

## 합격 기준
화면 하나를 옮길 때마다 아래가 **시험을 고치지 않고** 통과해야 한다.
- `npm run test:ui` (화면 시험 48건: 입력칸 진짜 키, 진행 중 표시, 툴팁 …)
- `npm run test:feature` (기능 시험 46건: 사용자가 하는 일마다 화면 결과와 본체 호출)
- `npm run verify:journeys` (검증 스킬의 흐름, 지금 10개, `.claude/skills/verify-meeting-recorder/`)
- 화면 캡처 픽셀과 `#view` HTML이 main과 같음 (가짜 데이터로 모든 갈래를 그려서, [testing.md](testing.md))
- `npm test`, `npm run typecheck`, 화면 오류 0, 설치해서 하루 써 보기

시험을 고쳐야 통과한다면 동작이 바뀐 것이다. 기능 시험·흐름은 글자·역할·aria로 찾지만, 화면 시험(`ui-test.js`)은 클래스 이름도 약 70개(`.add-row input` 등) 쓴다 — 옮긴 화면도 그 클래스를 그대로 둔다(Playwright로 바꿀 때까지).

## 순서
0. **안전망** (끝남, 2026-11-11): 기능 시험 45건, 검증 스킬과 흐름 7개(처음 설정·가져오기처럼 시험이 없던 곳 포함).
1. **도구와 이음새** (끝남, 2026-11-12, [renderer-architecture.md](renderer-architecture.md)): 화면을 Vite + React + TypeScript로 묶는다(`lib/renderer/`, 문서는 그대로 `src/renderer/index.html`). 개발 서버는 쓰지 않고 지켜보며 묶기 + 창 새로 고침(`npm run dev`) — 처음 계획의 "개발은 Vite 서버"를 바꿨다(출처가 둘이 되고 시험이 안 도는 경로가 생겨서). preload 객체에서 API 타입을 끌어냄, 화면이 `src/core` 원본을 가져다 씀, 옛 코드는 `legacy/`에 격리, 이음새 `reactPage`, 경계 검사. 시험 고치지 않고 통과, 화면 캡처 40장 픽셀까지 같음.
   - **회의 페이지** (끝남, 2026-11-12) — 한 함수(`pageMeeting`, 약 1,950줄)에 모여 있던 기능 15개를 계산·잎 부품·껍데기 순서로 나눠 옮겼다. 단계마다 같은 합격 기준을 적용했다.
     1. **계산 먼저** (끝남, 2026-11-12): 스크립트 읽기·화자별 시간은 코어(`src/core/script.mts`)를 그대로(옛 화면의 사본 삭제), 화자 순서·용어 밑줄 자리·회의록 마크다운 덩어리와 줄 안 조각(`entities/minutes`), 흐름도 순서·띠 칸·줄 나누기(`entities/flow`), 다시 받아쓸 구간·항목 종류(`entities/review`). 옛 코드는 이 결과를 그리기만. `#view` HTML이 탭 여섯·용어 카드·처리함·구간 고르기에서 main과 같음.
     2. **잎부터 하나씩** — 옛 페이지가 이미 만드는 뿌리 요소 안을 React가 그린다(`createIslands`, 감싸는 상자 없이 — `.flow-row + .glossary` 같은 형제 선택자 때문). 3단계에서 뿌리를 부품 안으로 옮긴다.
        - **용어·액션** (끝남, 2026-11-12): 용어 칸·설명 카드·드래그하면 뜨는 '설명 추가'(`features/meeting-terms`), 액션 탭·'액션 찾기' 줄(`features/meeting-actions`). 오래 걸리는 작업 목록(`jobs`)을 `shared/lib`의 구독할 수 있는 store로 — React 버튼이 '찾는 중'을 그린다. `#view`·카드 HTML이 13가지 상태에서 main과 같음.
        - **흐름도** (끝남, 2026-11-12): 그림 한 장의 자리 계산(상자·줄·칸·화살표·바뀐 경위·메모, 좁으면 여러 줄로 접기)을 `entities/flow`의 `flowGeometry`·`foldFlow`로, 그리기는 `features/meeting-flow`(그림·카드·인수인계·만들기 줄·흐름도 채팅·SVG 저장). 옛 그리기 코드 약 400줄 삭제. `#view` HTML이 12가지 상태(띠 셋·접기·띠 없는 흐름·만드는 중 둘·채팅)와 저장한 SVG 파일까지 main과 같음.
        - **확인 필요** (끝남, 2026-11-12): 탭(항목 처리·여러 개 고르기·직접 추가·확인 마치기·처리한 항목 고치기·되돌리기·다시 열기·구간 다시 받아쓰기와 구간 고르기)과 확인 필요 채팅(`features/meeting-review`). 상태와 파일을 바꾸는 명령은 옛 페이지에 두고, 다시 그리는 명령은 한 박자 뒤(마이크로태스크)에. `#view` HTML이 18가지 상태에서 main과 같음. 기능 시험 한 줄을 사용자 승인으로 고침(결정 64).
        - **재생 막대·스크립트·화자** (끝남, 2026-11-12): 재생 상태(`createPlayback` — 앱에 하나인 audio 요소·따라가기)를 store로, 재생 막대·정리본/원본 스크립트(재생 중인 줄·따라가기)·화자 줄·화자 탭·그 자리 이름 바꾸기를 `features/meeting-player`로. 옛 `lineEls`·`syncPlaying` 장부 삭제. 용어 밑줄 글은 `entities/minutes`의 `TermText`. `#view` HTML이 11가지 상태에서 main과 같음. 실제 재생(움직이는 줄·따라가기)은 가짜 화면에 소리가 없어 단위 시험과 설치본에서 확인.
        - **회의록 본문** (끝남, 2026-11-12): `widgets/meeting-minutes`(`MinutesBody`) — 덩어리·줄 안 조각(entities/minutes)을 그리고, 흐름도·액션 찾기·흐름도 만들기·용어 칸을 자식 부품으로 같이 그린다(기능끼리는 서로 가져올 수 없어 위젯 층). 옛 페이지의 흐름도·액션·용어 섬은 값을 만드는 함수로 바뀜. `#view` HTML이 7가지 상태에서 main과 같음.
        - 2단계 끝.
     3. **페이지 껍데기**
        - **3a** (끝남, 2026-11-12): 페이지 전체를 React(`pages/meeting`의 `MeetingPage`)가 그린다 — 머리·메타·오른쪽 위 메뉴·화자 줄·재생 막대·압축 안내·상태 카드·탭·탭 본문·채팅. 옛 `pageMeeting`은 주인(controller)으로 남아 `draw()`가 무엇을 보일지(view)만 만든다. 주인이 다시 그릴 때마다 React가 안을 새로 만든다(`key={version}`) — 옛 화면처럼 열어 둔 고치기 줄·메뉴가 다시 그릴 때 닫힌다. 페이지 안의 섬은 없어지고 body에 붙는 용어 카드·설명 추가만 남음. `#view` HTML이 28가지 상태에서 main과 같음.
        - **3b** (끝남, 2026-11-12): 주인(페이지 상태·파일을 바꾸는 명령·⌘F·스페이스 재생·body에 붙는 용어 카드·설명 추가)을 `pages/meeting/controller.ts`(`meetingPage`)로 옮기고 옛 `pageMeeting`(약 950줄) 삭제. 기록 목록·회의 문서 캐시·알림·확인 창·라우터처럼 앱 전체의 것은 옛 코드가 `meetingDeps`로 넘긴다. `#view` HTML이 37가지 상태에서 main과 같음(`scripts/dev/view-parity.js`). 회의 페이지 끝.
   - **설정·처음 설정** (끝남, 2026-11-13, [결정 65](decisions.md)·[66](decisions.md)): 알림·확인 창·툴팁·로컬 저장 → `shared`, 문제 알림 → `entities/issue`, 저장된 설정·엔진·계정 → `entities/settings`, 설정 창 → `features/configuration`(TS 주인 `mountSettings` + React 뼈대·다시 그리는 칸), 처음 설정 → 같은 조각의 `onboarding`(TS 주인 + React, `legacy/onboarding.js` 삭제), ⌘K 빠른 검색 → `features/palette`. 손으로 쓴 index.html 마크업을 React로 옮기며 HTML 비교에서 줄바꿈이 든 공백만 무시(결정 66). 옮기며 찾은 옛 버그 다섯은 사용자 승인으로 고침(#26).
   - **앱 껍데기** (끝남, 2026-11-13): Opus·Codex 두 설계가 같은 순서로 수렴. 끝남 — 녹음기 → `features/recording/capture.ts`(`legacy/recorder.js` 삭제), 기록 목록 주인 → `app/history.ts`, 라우터 → `app/router.ts`, 녹음 주인(명령 줄·라이브 표시·회의 시작 창) → `features/recording`(`mountRecording`), 가져오기 창 → `features/import-meeting`(TS 주인 + React). 위 막대·회의 시작 창 마크업도 React로(`features/recording/ui.tsx`, 2026-11-14). 화면 엮기(창구·명령·회의 페이지 deps·질문)는 `app/pages.ts`·`app/meeting.ts`·`app/session.ts`로, 시작 순서는 `app/boot.ts`의 `startRenderer()`로 옮겼고 `legacy/`를 삭제했다. `main.ts`가 모듈 평가 때 호출하며 동기 초기화·구독·비동기 시작 순서를 유지한다. 녹음의 위 막대·라이브 표시·회의 시작 창 HTML은 고정 스냅샷으로, 호출 순서는 명시적 단언으로 검사한다. 설치본의 실제 녹음 확인은 별도다.
   - **질문으로 찾기** (끝남, 2026-11-12): 둥근 버튼·질문 창·알림(`features/ask`의 `AskWidget`, 옛 코드가 만든 `.ask-root`에 `mountReact`)과 질문 탭 본문(`AskTab`). **처음으로 상태를 옛 코드에서 옮겼다**: 질문 목록·창 열림·쓰던 질문·범위·알림과 본체 소식(`onAsk`)·5초 맞추기를 `createAskStore`가 든다(결정 63). 옛 코드는 화면 이동(`openTab`)·설정 같은 바깥 일만 넘긴다. 장부 줄·달별 묶음은 `entities/meeting`으로, 스크롤 감시는 `shared/ui`로 내렸다(질문 탭 기능이 위젯을 가져올 수 없어서). 옛 질문 코드 약 400줄 삭제. `#view`·`.ask-root` HTML이 20가지 상태에서 main과 같음.
   - **회의 목록** (끝남, 2026-11-12): `pages/meetings` + 창구 `meetingsSource`·명령 `meetingsActions`. 갈래(`meetFilter`)를 주인의 상태로 올렸다 — 옛 질문 코드가 화면 객체의 `setFilter`·`filter()`를 부르던 것을 대신. 장부 줄·달별 묶음·바로가기 해 묶음(`widgets/meeting-ledger`)과 스크롤 감시(`scrollSpy`·`glide`, 화면을 재는 코드라 그린 뒤 붙임)는 질문 탭도 같이 쓴다. 당시 질문 탭 본문은 `askView`의 DOM을 넣었고, 이후 `features/ask`의 `AskTab`으로 옮겼다. `#view` HTML이 13가지 상태(회의 420개·해 넘김·스크롤·바로가기 누름·질문 탭 포함)에서 main과 같음.
   - **받아쓰기** (끝남, 2026-11-12): `pages/dictations` — 목록은 화면이 본체(`dictPage`)에서 30개씩 이어 받고(옛 화면과 같은 차례표로 늦게 온 답을 버림), 기록이 바뀌면(창구의 `version`) 보던 만큼 다시 받는다. 고친 곳 표시·원문 펼침·지우기(확인 창)는 주인의 상태·명령(`dictationsActions`). 받아쓰기 한 줄(`widgets/dictation-item`)이 짧은 꼴과 전체 꼴을 모두 맡아 옛 `dictItem`·`copyButton`·`markedText`를 지웠다. `SearchBox`(`shared/ui`), 녹음 폴더 빈 화면(`entities/issue`). `#view` HTML이 10가지 상태(이어 받기 끝·검색·원문·표시 끔·폴더 막힘 등)에서 main과 같음.
   - **홈** (끝남, 2026-11-12): `pages/home`(계산 `model.ts`와 그리기 나눔) + 창구 `homeSource`(주인은 `app/history`·`entities/issue`·`app/session`: 기록·문제 알림·받아쓰기 표시 상태) + 명령 `homeActions`(설정 열기·회의 갈래·복사·다시 붙여넣기 — API 호출과 알림은 주인 쪽). 회의 상태·말(`entities/meeting`: `meetState`·`meetTitle`·`statusText`… 와 `RowState`·`JobCard`), 교정 부호 계산(`entities/dictation`의 `markParts`), 받아쓰기 한 줄(`widgets/dictation-item`, 지금은 홈의 짧은 꼴), `CopyButton`. 계산은 공통 entities에서 읽는다. `#view` HTML까지 main과 같음.
   - **통계** (끝남, 2026-11-12): `pages/stats`(막대 그래프 포함) + 읽기 창구 `createSource`(주인은 `app/history`, 기록 구독에서 `changed()`). 받아쓰기 요약 계산(`entities/dictation`)과 숫자·시간 표시(`shared/lib`: fmt·clock·seconds·DAY·PROVIDER_NAME)는 화면들이 같이 쓴다.
   - **사전** (끝남, 2026-11-12): 첫 React 화면. `ROUTES`의 한 줄 + 단어 목록 창구(`entities/vocabulary`, 상태 주인은 `entities/settings`) + 아이콘 부품(`shared/ui`). 시험 고치지 않고 통과, 화면 캡처 같음.
2. **공통 부품**: 버튼·알림·툴팁·확인 창·아이콘, 전역 상태(회의 목록·진행 중 작업·질문 작업·문서 캐시)를 한곳에, IPC 소식도 한곳에서. CSS는 조각마다(CSS Modules) — 클래스 이름이 겹쳐 모양이 깨진 일(`.ghost`, `.todo`)을 구조로 막는다. 색·간격 변수는 공용.
3. **화면을 작은 것부터** (끝남): 사전·통계 → 홈 → 받아쓰기 → 회의 목록 → 질문으로 찾기(전역) → **회의 페이지**(재생 막대·탭·확인 필요·채팅·흐름도·용어·액션·⌘F를 조각으로) → 설정·처음 설정 → 옛 `app.js` 지우기.
   - `app/router.ts`가 화면마다 `{ el, update?, leave?, reload? }`를 받고 `reactPage(Page, props)`가 React 화면을 감싼다(`src/renderer/shared/page-host`).
   - 옮기는 화면이 읽는 상태는 창구(읽기 스냅샷 + 명령)로 열고, 상태 한 칸을 옮길 땐 그 칸의 쓰기와 IPC 구독을 한 번에 옮긴다. 입력칸은 uncontrolled, 시험이 찾는 클래스는 그대로.
   - 녹음 처리는 `features/recording/capture.ts`로 옮겼다. 오디오 워크릿(`recorder-worklet.js`)은 그대로다.

## 시험 도구 전환
**다음 단계는 E2E 시험의 Playwright 전환.** 화면 전환은 끝났고, 기존 E2E 시험은 유지한다. 시험 도구와 제품 동작은 동시에 바꾸지 않는다.

| 층 | 지금 | 옮긴 뒤 | 언제 |
|---|---|---|---|
| 코어·로직 | Vitest | 그대로 (+ `@vitest/coverage-v8`) | — |
| 컴포넌트 | Vitest + jsdom, FSD 조각 옆에 | 필요하면 `@testing-library/react` + `@testing-library/user-event` 추가 | 시험 도구 전환 때 |
| 기능(E2E) | `feature-test.js`·`ui-test.js`·`verify/drive.js` (직접 만든 Electron 도구 + 가짜 API) | Playwright Electron(`_electron.launch`), `getByRole`·자동 대기·trace | 다음 단계: 묶음마다 옮기고 두 시험을 함께 돌리다가 같아지면 옛 도구 삭제 |
| 화면 비교 | `screens.js` 캡처를 눈으로 | Playwright `toHaveScreenshot()` | Playwright로 옮길 때 |

가짜 API(`scripts/dev/stub-preload.js`)는 계속 쓴다. 화면과 본체가 HTTP가 아니라 IPC로 이야기하므로 MSW 같은 네트워크 흉내는 필요 없다. Playwright에는 가짜 API를 쓰는 작은 시험용 진입점(메인 창 하나만 띄움)을 준다.

## 도구 (pstack)
구조·타입은 `/pstack:architect`로 먼저 잡고, 화면 하나씩 옮긴 뒤 `verify-meeting-recorder` 스킬로 증명한다. 공통 부품과 회의 페이지는 한 흐름에서(나눠 맡기지 않는다).
