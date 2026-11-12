# 화면 구조 — React 전환 1단계 (도구와 이음새)

pstack `architect`로 설계했다(2026-11-12): 같은 문제를 Opus·Codex가 따로 설계하고, Codex가 채점하고, 하나로 합쳤다. 계획 전체는 [react-migration.md](react-migration.md), 결정은 [결정 61](decisions.md).

## 문제
화면(`src/renderer`)은 4,655줄짜리 `app.js` 하나에 모듈 전역 상태와 IPC 구독 16개, 직접 만든 라우터(`ROUTES` → `{ el, update, leave, reload }`)가 있다. 동작을 그대로 둔 채 안쪽만 TypeScript + React로 바꾸려면, 먼저 "화면 하나를 React로 옮기는 일"이 작고 분명해야 한다. 지켜야 할 것:
- 시험(화면 48·기능 46·흐름 7)은 단언을 고치지 않고 통과. 시험은 `src/renderer/index.html`을 직접 띄우고, 글자·역할·aria와 **클래스 약 70개**(`.add-row input` 등)로 찾는다.
- 가짜 API(`stub-preload.js`)·점검은 `src/preload.js`의 두 칸 들여쓴 `이름:` 줄을 읽어 함수 목록을 만든다.
- preload의 `on…` 구독은 해제 함수를 돌려주지 않는다 — React 효과에서 구독하면 화면을 열 때마다 쌓인다. 가짜 API의 `onMeetingChanged`는 마지막 콜백 하나만 쥔다.
- 시험은 `el.value = …` + `input` 이벤트로 입력한다 — 값을 쥐는(controlled) React 입력칸은 이걸 놓친다.
- 루트에 `vite.config.*`를 두면 vitest가 그 설정을 집어 `src/core` 시험을 놓친다.

## 쓰는 쪽에서 본 모습
```sh
npm start                 # build:fn + build:ts + build:renderer + electron .
npm run dev               # 화면을 지켜보며 다시 묶고(개발 모드) 앱을 띄움 — 고친 뒤 창에서 ⌘R
npm run build:renderer    # vite build -c vite.renderer.config.mts → lib/renderer/main.js, main.css, assets/
npm run test:ui | test:feature | verify:journeys | dist     # 화면을 먼저 묶고 시험
npm run typecheck         # 코어 + 화면(tsconfig.renderer) + preload(tsconfig.preload) + 경계 검사
```
화면 하나를 옮기기 (예: 사전) — `src/renderer/legacy/app.js`의 `ROUTES` 한 줄과, 그 화면이 읽는 상태의 창구:
```js
import { reactPage } from '../shared/page-host/index.tsx'; // (legacy는 무엇이든 가져올 수 있다 — 반대는 안 됨)
const ROUTES = { …, dictionary: () => reactPage(DictionaryPage, { model: dictionaryModel }), … };
```
```tsx
// pages/dictionary/ui.tsx — 상태는 주인이 준 model로만 읽고 바꾼다. 입력칸은 uncontrolled, 시험이 찾는 클래스는 그대로
const words = useSyncExternalStore(model.subscribe, model.getSnapshot);
<div className="page"><div className="add-row"><input ref={input} placeholder="단어나 이름 (예: PJY, Whisper, 김신우)" onKeyDown={…} /></div></div>
```
API 타입: `src/preload.js`에 함수를 더하면 그것만 고친다. 화면 TS의 `window.recorderApi` 타입은 그 객체에서 끌어낸다.

## 구조
- **문서 하나, 묶음 하나.** 앱·시험·설치본 모두 `src/renderer/index.html`을 띄우고, 이 문서가 `../../lib/renderer/main.css`·`main.js`를 정해진 이름으로 불러온다(전에 `lib/core`를 불러오던 방식 그대로). 문서 주소가 같으니 `localStorage`·오디오 워크릿 상대 경로(`recorder-worklet.js`)·CSP가 그대로이고, 시험 파일은 손대지 않았다. `main.js`도 그대로.
- **개발 서버(HMR)는 쓰지 않는다.** `vite build --watch` + 창 새로 고침. 개발·시험·설치본이 한 경로. 자동 새로 고침은 하지 않는다(녹음 중일 수 있다).
- **옛 화면 코드는 `legacy/`에 격리.** `app.js`·`onboarding.js`·`recorder.js`를 `git mv`. `main.ts`만 가져오고(`style.css`, `legacy/app.js`), 새 코드가 옛 전역 상태에 기대면 빌드 전 검사가 막는다.
- **API 타입의 원천은 preload 하나.** `const recorderApi = {…}` + `/** @typedef {typeof recorderApi} RecorderApi */` → `shared/api`가 `import('../../../preload.js').RecorderApi`로 끌어낸다(`Window.recorderApi` 선언 포함). 없는 함수를 부르면 타입 오류. 인자·결과 모양은 아직 any/unknown — 화면에서 처음 쓸 때 그 함수에 JSDoc으로 적는다.
- **상태 주인은 1단계 동안 옛 코드.** 화면을 옮길 때 그 화면이 읽는 상태만 창구(domain model: 읽기 스냅샷 + 명령)로 연다. 상태 한 칸을 옮길 땐 그 칸의 모든 쓰기와 IPC 구독을 한 번에 주인(entities/…)으로 옮긴다 — 옛 변수에 사본을 남기지 않는다.
- **이음새 `reactPage`** (`shared/page-host`): 첫 그리기 동기(flushSync), `display: contents` 껍데기라 `#view` 아래 상자 구조가 같음, `update()`는 같은 뿌리를 다시 그려 입력·포커스 유지, `leave()` 한 번만, `reload`는 넘겨줄 때만.
- **경계 검사** (`scripts/dev/check-boundaries.js`, typecheck·dist): ① `legacy/`는 `main.ts`만 ② FSD 층 순서(app > pages > widgets > features > entities > shared), 같은 층 다른 조각 금지 ③ 다른 조각은 `index`로만 ④ `node:`·Electron 금지, 화면 밖은 `src/core` 순수 모듈과 preload 타입만 ⑤ 문자열이 아닌 동적 import 금지. 일부러 어긴 다섯 경우를 모두 잡는 것을 확인.
- **코어는 원본에서.** 화면이 `../../core/*.mts`를 바로 가져오고 Vite가 묶는다(`lib/core`는 본체·명령줄 도구용).
- **설치본**: `lib/**`(묶음 포함)는 그대로 들어가고, 화면 원본(`*.ts(x)`, `legacy/`, `style.css`, `fonts/`)은 뺀다. `index.html`·`recorder-worklet.js`는 들어간다.

## 합성 결정
- **기준: Codex 안.** API 타입을 preload 객체에서 끌어내 두 번째 목록이 없고(Opus 안은 99개짜리 `preload-api.d.ts`를 따로 두고 타입 검사로 묶었다), 1단계 동안 옛 코드가 상태 주인이라 첫 화면 옮기기가 작다(Opus 안은 사전 화면을 옮기면서 설정 상태를 통째로 옮겨 옛 코드 약 25곳을 고친다). 교차 심사(Codex)도 이 안을 골랐다(21 : 18) — 심사자가 작성자와 같은 계열이라 근거를 따로 확인했다.
- **Opus 안에서 옮겨 붙임:** ① 화면 문서를 그대로 두고 묶음만 불러오기(Codex 안은 `lib/renderer/index.html`로 옮겨 시험의 여는 코드를 고치고 `localStorage` 유지가 불확실했다) ② 설정 이름 `vite.renderer.config.mts`(Codex 안의 루트 `vite.config.mts`는 vitest를 깨뜨린다) ③ 시험하는 묶음 = 설치하는 묶음(`dist`가 한 번 묶어 둘 다 씀) ④ uncontrolled 입력칸·시험이 찾는 클래스 유지라는 함정 기록 ⑤ `check-handlers.js`를 하위 폴더·.ts(x)까지(안 그러면 옮긴 `app.js`를 조용히 안 본다).
- **버린 것:** Opus 안의 IPC 다리(모든 `on…`을 한 곳에서 받아 나눠 줌, 해제 가능)와 상태를 첫 화면에서 최종 주인으로 옮기기 — 방향은 맞지만 1단계에 16개 구독을 모두 바꾸는 위험이 크다. 상태를 옮기는 화면에서 그 구독부터 옮긴다. Codex 안의 시험마다 따로 묶는 임시 빌드 — 시험하는 묶음과 설치 묶음이 달라진다. 두 안 모두의 "빌드가 바뀌면 자동 새로 고침" — 녹음을 끊을 수 있다.

## 감수한 것
- 고친 뒤 바로 반영(HMR)이 없는 대신 경로가 하나다(개발·시험·설치본). 필요해지면 개발 전용으로 약 30줄이면 붙는다.
- 시험 전에 화면을 묶는다(`npm run test:*`가 묶음). 시험 스크립트를 `electron …`으로 바로 돌리면 이미 있는 묶음을 쓴다 — 오래됐으면 `doctor.js`가 알려 주고, 없으면 가짜 API가 크게 알린다(자동으로 묶지는 않음).
- API 함수의 인자·결과 타입은 처음엔 any/unknown. 99개를 미리 지어내지 않고 쓰는 곳이 생길 때 적는다. 인자 개수도 그때부터 검사된다.
- 옮긴 화면도 시험이 찾는 클래스 이름을 전역 그대로 둔다(Playwright로 바꿀 때까지). 스타일은 조각별로 옮긴다.
- 묶음을 줄이지 않는다(minify 끔) — 오류 위치를 읽을 수 있게.

## 버린 대안
- **Vite 개발 서버 + HMR** (`loadURL`): 출처가 둘(별도 `localStorage`), 개발용 CSP(ws·inline), `main.js` 분기, 시험 5곳의 여는 코드 수정, 시험이 안 도는 개발 경로. 겉은 빠르지만 창이 코드를 받는 길이 늘어난다.
- **preload를 스키마에서 만들어 내기**: 샌드박스 preload는 로컬 파일을 require할 수 없어 preload를 묶어야 하고, 가짜 API·점검의 함수 목록 읽기를 다시 짜야 한다.
- **React 뿌리 하나 + 옛 칸에 포털**: 첫날부터 React가 라우팅·트리를 가져야 해 마지막 단계의 재작성을 1단계로 당겨 온다.

## 열린 질문과 위험
- 화면 코드의 `clock()`은 음수 초를 0으로 막고 코어의 `clock()`은 안 막는다 — 회의 페이지를 옮길 때 코어에 막기를 넣을지(명령줄 출력은 음수일 때만 바뀜) 정해야 한다.
- 시험의 고정 대기(600~1,500ms)에 React 파싱이 더해진다 — 첫 화면을 옮길 때 기능 시험이 흔들리는지 본다.
- 오디오 워크릿·`rec://` 재생·글꼴이 설치본(asar)에서 그대로인지는 설치해서 확인한다(묶음은 `lib/`로 들어간다).

## 다음 단계
- 첫 화면(사전)은 옮겼다(2026-11-12): `pages/dictionary` + `entities/vocabulary`(주인이 준 read·save, settings가 바뀌면 주인이 `changed()`) + `shared/ui`의 `Icon`. 옛 `pageDictionary`와 단어 나누기 코드는 지웠다(`vocabWords`는 창구를 읽음).
- 통계도 옮겼다(2026-11-12): 읽기 창구 `shared/lib`의 `createSource(read, deps)` — 주인의 값 참조가 그대로면 같은 스냅샷. 표시 함수·받아쓰기 요약은 옛 코드와 한 벌.
- 다음: 홈. 공통 부품(알림·확인 창)은 필요한 화면을 옮길 때 만든다.
