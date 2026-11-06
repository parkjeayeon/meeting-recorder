# 테스트 방법

자동 시험과 손으로 확인하는 방법, 그리고 주의할 점.

## 빌드 전 자동 검사 — `npm run dist`
`npm run dist`(`npm run install-app`도)는 빌드 전에 아래를 차례로 돌리고, 실패하면 빌드하지 않는다.
1. 타입 검사 `npm run typecheck` (`src/core`·`src/cli`의 TypeScript)
2. 단위 테스트 `npm test` (컴파일 후 Vitest, 1초 안팎)
3. 키보드 처리기 검사 `node scripts/dev/check-handlers.js` (1초 미만)
4. 화면 테스트 `npm run test:ui` (약 20초)
5. 끊김 시험 `npm run test:crash` (약 30초, 아래)

3·4는 아래 "주의할 점"의 두 항목.

## 끊김 시험 — `npm run test:crash`, `npm run test:diskfull`
파일을 쓰는 도중 끊겼을 때(디스크 가득 참·강제 종료·전원) 데이터가 남는지 본다 ([결정 45](decisions.md)).
- `npm test`의 `src/core/write.test.mts`: 쓰기·기록(fsync)·이름 바꾸기 단계마다 실패를 흉내 내 원래 파일이 남고 임시 파일이 지워지는지. 다른 프로세스(Electron의 Node)가 읽는 동안 바꿔 쓰기를 150번 해 반쯤 쓴 파일을 한 번도 보지 않는지, 쓰는 도중 강제 종료 40번 뒤에도 파일이 이전 전체 또는 새 전체인지. 비교용으로 예전 방식(덮어쓰기)의 숫자도 출력한다 (드물어서 매번 걸리지는 않는다).
- `npm run test:crash` (`scripts/dev/review-crash-check.js`, 빌드 전에 자동): 가짜 회의 폴더에서 확인 필요 적용·되돌리기·구간 다시 받아쓰기 반영이 끊긴 지점을 하나씩 만들고, 다시 누르면 끝나는지와 되돌리면 처음과 바이트까지 같은지. 자식 프로세스가 적용하는 도중 아무 때나 강제 종료 40번.
- `npm run test:diskfull` (`scripts/dev/disk-full-check.js`, 손으로): 2MB RAM 디스크를 만들어 채운 뒤 바꿔 쓰기. 관리자 권한은 필요 없고 끝나면 디스크를 뗀다 (도는 몇 초 동안 Finder에 `mrfull…` 디스크가 잠깐 보인다).

## 단위 테스트 — `npm test`
`src/core`(회의 데이터 읽기)와 `src/cli`(명령줄 도구 `mr`)를 Vitest로 시험한다. 가짜 녹음 폴더(`src/test/fixture.mts`, 지어낸 예시)를 임시 폴더에 만들어 쓴다.
- 화자 이름 바꿔 끼우기(조사 맞추기, '화자 1'과 '화자 10', '나'가 낱말 속에서 안 바뀜, 맞바꾸기), 스크립트 해석·말한 시간
- 녹음 폴더 찾기 순서, 목록(받아쓰기·녹음 중 폴더 제외, 최근부터, `--limit`·`--since`), id 고르기(`latest`·앞부분·여럿이면 오류·폴더 밖 경로 거부)
- 명령마다 출력이 `src/core/schema.mts`의 스키마에 맞는지, 오류 형식·종료 코드, 설치
- 빌드한 `lib/cli/bin.mjs`를 Electron의 Node(`ELECTRON_RUN_AS_NODE=1`)로 실제 실행 — 앱 안의 `mr`과 같은 방식

출력 모양을 바꾸면 스키마도 같이 바꾼다 (에이전트가 기대어 쓰는 약속이라서).

## 셀프테스트 — `npm run selftest`
fn 이벤트를 흉내 내 실제 녹음 흐름을 시험한다 (`src/main.js`의 `runFnSimulation`). 창을 띄우지 않고 결과를 `SELFTEST …` 줄로 출력한다.

| 시나리오 | 기대 결과 |
|---|---|
| 1.5초 꾹 누르기 | `saved …_memo` → `dictation {"status":"silent"}` (마이크가 조용하면 무음) |
| 떼자마자 다시 누름 | `busy-ignored` (앞 받아쓰기 처리 중) |
| 짧게 톡 | `discarded` |
| 빠르게 두 번 → 1.4초 뒤 한 번 | 녹음 **하나**가 이어지다 `saved` |
| 빠르게 세 번 | `discarded` |
| 회의 녹음 중 fn | 무시 (새 녹음 없음) |
| 회의 녹음 2.8초 | `saved …_meeting`, 회의록을 만들지 않음(`minutes.json`의 `status: short`) |

셀프테스트는 임시 녹음 폴더(`SELFTEST recordings …`로 출력)에 녹음·받아쓰기 기록을 남겨 실제 녹음 폴더와 `dictations.jsonl`은 건드리지 않는다 (2026-11-05부터. 예전에는 실제 폴더에 써서 손으로 지웠고, `dictations.jsonl`을 통째로 되돌리다 실제 기록을 지운 적이 있다). 다만 앱 데이터(설정·모델·whisper-server 번호 파일)는 같이 쓰므로 설치된 앱은 먼저 끈다 — 켜 둔 채 돌리면 설치된 앱의 whisper-server를 고아로 보고 정리한다.

## 화면 캡처 — `scripts/dev/screens.js`
가짜 데이터(`scripts/dev/stub-preload.js`)로 메인 창을 **숨긴 채** 띄워 화면별 PNG를 남긴다. 메인 프로세스를 띄우지 않으므로 녹음·fn·권한·실제 기록에 영향이 없고, 설치된 앱이 켜져 있어도 된다.

```bash
npx electron scripts/dev/screens.js /tmp/mr-screens            # 홈·회의·가져오기 확인 창·회의 페이지·액션 탭·본문 찾기·확인 필요·구간 다시 받아쓰기(반영 전·후)·처리한 항목(고치기·되돌리기)·채팅(적용 전·후)·용어 카드·용어 칸·사전·통계·설정·엔진
DARK=1 npx electron scripts/dev/screens.js /tmp/mr-screens     # 다크 모드
OB_STEP=permissions npx electron scripts/dev/screens.js /tmp/mr-screens   # 처음 설정 단계 (welcome·permissions·token·engine·account·practice·done)
W=960 H=640 npx electron scripts/dev/screens.js /tmp/mr-screens  # 최소 창 크기
STUB_FOLDER=denied npx electron scripts/dev/screens.js /tmp/mr-screens   # macOS가 녹음 폴더 접근을 막은 상태 (홈 경고·빈 목록 안내)
STUB_MINUTES=offline npx electron scripts/dev/screens.js /tmp/mr-screens # 인터넷이 끊겨 회의록 쓰기에서 멈춘 회의 (이어서 쓰기 버튼)
```
예시 회의는 임시 폴더에 만들어 쓴다 (실제 회의 내용이 찍히지 않음). 실제 데이터로 찍은 캡처는 공개 저장소에 올리지 않는다.

가짜 API는 `src/preload.js`의 함수 이름을 읽어 같은 모양을 만들므로, 새 IPC를 추가하면 자동으로 따라온다. 예시 값이 필요한 함수만 `stub-preload.js`의 `impl`에 넣는다.

## 샌드박스 — `node scripts/dev/sandbox-check.js`
`src/sandbox.js` 프로필이 실제로 막는지 본다: 지정하지 않은 폴더 쓰기(막힘), 앱 폴더·임시 폴더 쓰기(허용), 네트워크 차단·허용. 모두 `PASS`여야 한다.

화자 구분·whisper-server가 샌드박스 안에서 실제로 동작하는지는 프로필을 바꿨을 때 따로 확인한다:
- 화자 구분: 16kHz 모노 WAV로 `diarize-env/bin/python -I native/diarize.py <wav>`를 `HF_HUB_OFFLINE=1`, `network: 'none'` 프로필로 실행 → 화자 구간 JSON
- whisper-server: `network: 'local'` 프로필로 띄워 `/inference`에 WAV를 보내 200 응답

## 회의록 다시 돌리기 — `scripts/dev/rerun-meeting.js`
회의 폴더 **사본**에 녹취부터 회의록까지 전체 파이프라인을 다시 돌린다. 녹취 규칙(반복 감지 등)을 바꿨을 때 실제 녹음으로 확인하는 용도. 실제 녹음 폴더를 지정하면 거부한다.
```bash
mkdir /tmp/m && cp -c ~/Documents/MeetingRecorder/<회의>/{mic.wav,meta.json} /tmp/m/
npx electron scripts/dev/rerun-meeting.js /tmp/m
```
결과의 `segments.json`의 `redo`에 다시 받아쓴 구간(시작·끝, 걸린 시간, 그래도 반복이 남았는지)이 남는다. 결과를 실제 회의에 넣을 때는 기존 파일을 회의 폴더 안 `이전 결과 (…)` 폴더로 옮겨 두고 복사한다.

## 고아 프로세스 — `node scripts/dev/orphans.js [--app]`
부모가 사라져 PID 1에 입양된 도우미 프로세스를 찾는다. `--app`은 이 앱의 whisper-server·fn-listener만. 크래시 리포터(`chrome_crashpad_handler`)나 의도된 데몬도 목록에 나올 수 있으니 하나씩 확인한다.

강제 종료 시험: 개발 모드에서 서버를 띄운 뒤 `process.exit`로 끝내고 `--app` 결과가 0개인지 본다.

## 손으로 확인할 것 (자동 시험이 못 하는 것)
- 실제 fn 받아쓰기가 **다른 앱**(메모·Slack 등) 커서 위치에 입력되는지
- 처음 설정의 마이크 레벨 막대, fn 키 반응, 연습 단계
- 회의 녹음 → 회의록 초안 → 확인 필요 처리 → 확인 마치기 (실제 회의 녹음으로)
- 회의 페이지 재생: 스크립트 줄을 누르면 그 시각부터, 따라가기
- 화자 이름 바꾸기: 막대·스크립트에서 바꾼 뒤 회의록의 다른 낱말("나눈", "나머지" 등)이 그대로인지, 되돌리기·두 화자 맞바꾸기
- 권한을 껐다 켰을 때 홈의 "확인할 문제"와 설정 › 권한

## 주의할 점
- **설치된 앱과 개발 실행은 동시에 안 된다**: 같은 앱 데이터 폴더를 쓰는 단일 실행 잠금 때문에, 메인 프로세스(`src/main.js`)를 띄우는 테스트는 설치된 앱을 먼저 끄고(`osascript -e 'quit app "Meeting Recorder"'`) 한다. 화면 캡처(`screens.js`)는 상관없다.
- **사용자가 쓰는 창을 조작하지 않는다**: 화면이 보이는 테스트 창을 사용자가 실제로 쓰다가 자동 조작과 겹친 적이 있다. 화면 확인은 숨긴 창으로.
- **운영체제 수준 키 입력(System Events)은 쓰지 않는다**: macOS 제어 허용 창이 뜬다.
- **실제 회의를 바꾸는 시험은 복사본으로**: 확인 필요 적용·확인 마치기는 녹취·회의록을 고쳐 쓰므로 회의 폴더를 복사해서 시험하고 끝나면 지운다.
- **실제 회의 결과를 바꿔 넣기 전에**: 화자 이름(`meta.json`의 `speakerNames`, 예전 회의는 스크립트의 `[이름]`)과 확인 필요 처리 상태를 먼저 확인한다. 새 결과로 바꿔 넣으면서 바꿔 둔 화자 이름을 잃은 적이 있다. 기존 결과는 회의 폴더 안 `이전 결과 (…)` 폴더로 옮겨 둔다.
- **키보드 처리기 검사**: `node scripts/dev/check-handlers.js` (`npm run dist`가 먼저 돌린다). `onkeydown = (e) => 조건 && 동작`처럼 값을 돌려주는 처리기는 영어·Backspace 입력을 막는다.
- **화면 테스트**: `npm run test:ui` (`npm run dist`가 키보드 처리기 검사 다음에 돌린다, 약 15초). 가짜 데이터로 메인 창을 숨긴 채 띄워 입력칸마다(회의 검색·사전 추가·⌘K·가져오기 메모·흐름도 입력·⌘F·확인 필요 고칠 말·채팅·처리함 고치기) 진짜 키(`sendInputEvent`로 a·b·Backspace)를 보내 값이 `a`인지, 오류 알림 글자색이 배경색과 다른지 본다. 오래 걸리는 작업(액션 찾기, 가짜 API가 2.5초 기다림)을 누르고 탭을 옮겼다 돌아와 "찾는 중" 표시와 비활성이 남는지, 다시 눌러도 한 번만 불리는지도 본다. "정리본 복사"·"회의록 복사"를 눌러 복사된 글(정리본은 마크다운 목록)과 화면 오류가 없는지도 본다. 회의 목록 위 "목록에 보이지 않는 폴더"(가짜 세 개)가 이유와 함께 보이고 하나를 휴지통으로 옮기면 그것만 빠지는지도 본다. JS로 value를 넣는 시험은 키 처리기 버그를 못 잡는다. 새 입력칸을 만들면 `scripts/dev/ui-test.js`의 `cases`에 한 줄 더한다.
- **진단 로그**: 테스트 창에서 재현되지 않는 문제는 설치본에 임시 로그를 넣어 확인한다 (영문 입력 버그를 이렇게 찾음). 원인을 찾으면 바로 뺀다.
