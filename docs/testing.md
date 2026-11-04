# 테스트 방법

자동 시험과 손으로 확인하는 방법, 그리고 주의할 점.

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

**주의:** 셀프테스트는 실제 녹음 폴더에 쓴다. 끝나면 `…_meeting` 테스트 폴더를 휴지통으로 옮기고, `dictations.jsonl`에 추가된 줄만 지운다 (**파일을 통째로 되돌리지 않는다** — 그 사이 실제 받아쓰기 기록이 지워진 적이 있다).

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
- **화면 테스트**: `npm run test:ui` (`npm run dist`가 키보드 처리기 검사 다음에 돌린다, 약 15초). 가짜 데이터로 메인 창을 숨긴 채 띄워 입력칸마다(회의 검색·사전 추가·⌘K·가져오기 메모·흐름도 입력·⌘F·확인 필요 고칠 말·채팅·처리함 고치기) 진짜 키(`sendInputEvent`로 a·b·Backspace)를 보내 값이 `a`인지, 오류 알림 글자색이 배경색과 다른지 본다. JS로 value를 넣는 시험은 키 처리기 버그를 못 잡는다. 새 입력칸을 만들면 `scripts/dev/ui-test.js`의 `cases`에 한 줄 더한다.
- **진단 로그**: 테스트 창에서 재현되지 않는 문제는 설치본에 임시 로그를 넣어 확인한다 (영문 입력 버그를 이렇게 찾음). 원인을 찾으면 바로 뺀다.
