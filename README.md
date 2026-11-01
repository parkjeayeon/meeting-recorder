# Meeting Recorder (프로토타입)

fn 키로 제어하는 Electron 회의 녹음기 겸 받아쓰기 도구. 회의는 마이크와 시스템 소리를 48kHz/16bit WAV 트랙으로 따로 저장하고,
fn 꾹 누르기는 Wispr Flow처럼 말한 내용을 지금 커서 위치에 입력한다.

```bash
brew install whisper-cpp   # 로컬 음성 인식 엔진 (whisper-server)
npm install
npm start            # 개발 모드 실행 (fn 감지 헬퍼 빌드 포함)
npm run selftest     # fn 이벤트를 흉내 내 꾹 누르기/탭 버림/회의 중 fn 무시를 검증
npm run install-app  # .app 빌드 → ad-hoc 서명 → /Applications 설치
```

| 조작 | 동작 |
|---|---|
| `fn` 꾹 누르기 | 누르는 동안 녹음, 떼면 받아써서 커서 위치에 입력 (Wispr Flow와 동일) |
| `fn` 짧게 (0.3초 미만) / `fn`+다른 키 | 녹음 버림 |
| 창·독·메뉴바의 회의 녹음 | 회의 녹음 시작/정지 (fn은 회의에 쓰지 않는다) |

창의 X는 창만 숨긴다. 앱은 메뉴바(🎙)와 화면 왼쪽 플로팅 독으로 계속 실행되고, 종료는 메뉴바 › 종료 또는 ⌘Q.
패키징된 앱은 첫 실행 때 로그인 항목에 등록된다 (메뉴바에서 끌 수 있음).
ad-hoc 서명이라 다시 빌드할 때마다 macOS 권한을 다시 허용해야 한다.

저장 위치 `~/Documents/MeetingRecorder/`
- 회의: `<날짜>_meeting/` 안에 `mic.wav`(+ 화상 회의 설정 시 `system.wav`), `meta.json`, `transcript.txt`(원본 대화 스크립트), `script-clean.txt`(대화 흐름과 무관한 말을 쳐낸 정리본), `minutes.md`(회의록), `minutes.json`(상태), `segments.json`·`diarization.json`(녹취·화자 구분 중간 결과)
- 받아쓰기: 음성은 임시 폴더에 녹음해 변환 후 바로 지운다. 한 건마다 `dictations.jsonl`에 한 줄씩 데이터만 남긴다
  (시각, 길이, 입력한 앱, 정리 전/후 글, 글자·단어 수, WPM, 다듬기 계정, 단계별 소요 시간) → 나중에 통계·분석용

## 받아쓰기
1. 녹음한 `mic.wav`를 로컬 Whisper(large-v3-turbo q8_0, 약 0.9GB)로 텍스트 변환. `whisper-server`를 앱이 띄워 모델을 메모리에 올려 두므로 짧은 문장은 0.3초 안팎
2. (선택) 다듬기: 군말·자기 정정·띄어쓰기 정리. 이미 로그인된 CLI 구독을 그대로 쓴다 (`src/cleanup.js`)
   - 자동: Claude Code(`claude -p`, 약 2.5초) → Codex(`codex exec`, 약 3.5~5초) → Anthropic API 키(`claude-opus-5-5`, safeStorage 암호화 저장) 순으로 로그인된 것
   - 600자가 넘으면 문장 단위로 나눠 최대 4개를 동시에 다듬고 다시 잇는다. 실패한 조각은 원문 그대로 둔다
3. 클립보드에 넣고 ⌘V 입력 후 0.6초 뒤 원래 클립보드 복원

- 모델 위치: `~/Library/Application Support/meeting-recorder/models/` (없으면 앱 화면의 "받기" 버튼)
- 결과는 녹음 폴더의 `transcript.json`에 정리 전/후 글과 소요 시간으로 남는다
- 거의 무음이거나 Whisper가 무음에서 자주 지어내는 문장("시청해 주셔서 감사합니다" 등)은 입력하지 않는다

## 회의록
회의 녹음을 멈추면 자동으로 만든다 (설정 › 회의에서 끌 수 있음, 지난 회의는 "회의록 만들기"/"다시 만들기").
1. 48kHz WAV를 16kHz로 줄이고, 약 10분마다 조용한 지점에서 잘라 **Whisper large-v3**(회의 전용으로 따로 띄움)로 녹취
2. 같은 시간에 **pyannote speaker-diarization-community-1**로 화자 구분 (파일 전체를 한 번에, Mac GPU)
3. 녹취 구간마다 가장 많이 겹치는(없으면 2초 안 가장 가까운) 화자를 붙이고, 같은 사람의 같은 말 반복은 합친다
4. 다듬기와 같은 계정으로 회의록 작성 + 대화 흐름과 무관한 말을 쳐낸 정리본을 동시에 만든다
5. 스크립트에서 "화자 1"을 누르면 이름을 바꿀 수 있고, 스크립트·정리본·회의록 전체에 반영된다

실측 (2시간 5분 1:1 면담, M5 Pro): 녹취+화자 구분 18분 30초, 회의록 45초, 정리본 1분 46초 → 약 20분. 2명으로 구분됨.

화자 구분 설치 (한 번만):
```bash
uv venv --python 3.12 ~/Library/Application\ Support/meeting-recorder/diarize-env
uv pip install --python ~/Library/Application\ Support/meeting-recorder/diarize-env/bin/python pyannote.audio==4.0.7
~/Library/Application\ Support/meeting-recorder/diarize-env/bin/hf auth login   # 모델 약관 동의한 계정의 Read 토큰
```
Whisper large-v3 모델(`ggml-large-v3.bin`, 3.1GB)은 `~/Library/Application Support/meeting-recorder/models/`에 둔다. 없으면 turbo로 녹취한다.

## 필요한 macOS 권한 (설치한 앱은 Meeting Recorder에, 개발 모드는 터미널 앱에 부여)
- 마이크
- 입력 모니터링: fn 키 감지 (`native/fn-listener`)
- 손쉬운 사용: 받아쓴 글을 ⌘V로 입력 (`native/permissions paste`)
- 화면 및 시스템 오디오 녹음 › 시스템 오디오 녹음 전용: 화상 회의 설정을 켠 경우에만
- 키보드 설정 "🌐 키를 누르면" → "아무것도 안 함"

## 구조
- `native/fn-listener.swift`: CGEventTap으로 fn down/up을 stdout으로 출력
- `src/dictation.js`: whisper-server 관리, 모델 다운로드, 붙여 넣기
- `src/cleanup.js`: 다듬기·회의록 작성 호출 (Claude Code / Codex / API, 긴 글 나누기)
- `src/minutes.js`: 회의 녹취(16kHz 변환 → 10분 조각 → Whisper large-v3) + 화자 구분 → 스크립트·정리본·회의록
- `native/diarize.py`: pyannote 화자 구분 (앱 전용 파이썬 환경에서 실행)
- `src/renderer/`: 메인 창 (기록 · 회의 · 설정). 다듬기 전/후를 단어 단위로 비교해 교정 부호로 표시
- `src/main.js`: fn 상태 머신(꾹 누르기 받아쓰기 전용), 시스템 오디오 루프백, WAV 저장, 메뉴바·플로팅 독
- `src/overlay/`: 화면 가장자리 플로팅 독 (hover 시 메모/회의/목록 버튼)
- `src/renderer/recorder.js`: getUserMedia + getDisplayMedia → AudioContext(48kHz) → AudioWorklet
- `src/renderer/recorder-worklet.js`: 트랙별 100ms 청크, 빈 입력은 0으로 채워 동기 유지
- `src/wav-writer.js`: 스트리밍 기록, 5초마다 헤더 갱신(크래시 대비)
