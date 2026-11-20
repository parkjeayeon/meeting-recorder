# Wispr Flow 분석 기록

이 앱의 받아쓰기·화면·처음 설정은 Wispr Flow를 참고했다. 설치된 Wispr Flow(macOS, v1.6.x)의 앱 묶음(`app.asar`)을 풀어 **읽기만** 했다 (실행하지 않음). 도구는 REA(역공학 MCP)와 파이썬·grep. 아래는 코드에서 확인한 사실이고, 확인하지 못한 것은 따로 적었다.

조사 대상 파일 (`Wispr Flow.app/Contents/Resources/app.asar` 안):
- `.webpack/main/index.js` — 메인 프로세스
- `.webpack/renderer/hub/index.js` — 허브 창(본 화면·온보딩), 약 5.9MB, CSS 모듈·영어 문구 포함
- `.webpack/renderer/accessibility_drop/` — 손쉬운 사용 권한 안내 패널

## 받아쓰기 단축키 규칙
- 기준값 `DICTATION_DEBOUNCE_DELAY = 500`(ms), 최대 길이 `DICTATION_DURATION_TIMEOUT = 20분`, 경고 `DICTATION_DURATION_WARNING_TIMEOUT = 19분`.
- 누르면 바로 듣기 시작.
- 뗄 때: 시작 후 500ms 이상이면 끝내고 입력. 500ms 안이면 500ms 더 기다렸다가 두 번째 누름이 없으면 버림 ("PTT stopping after timeout waiting for double press"). 이 기다림은 *뗀 때부터* 잰다 — 타이머가 울릴 때 키를 누르고 있는지는 보지 않는다.
- 듣는 중 시작 후 500ms 안에 다시 누름: 잠금(손을 떼도 계속 듣기, 내부 이름 "POPO lock"). 같은 녹음을 이어간다. 이 창은 *처음 누른 때부터* 잰다 ("Action down twice in quick succession --> lock").
- 두 기준이 달라 생기는 틈(예: 0에 누르고 400ms에 떼면 900ms까지 기다리는데 600ms에 다시 누름): 늦은 누름은 아무 일도 하지 않고(잠그지도 끝내지도 않음), 그 누름을 기다림 안에 떼면 잠기지 않은 듣는 중의 뗌이고 시작 후 500ms 이상이라 처음 누른 때부터의 녹음을 끝내고 입력 ("key_release"). 그대로 누르고 있다가 타이머가 울리면 버림. v1.6.1483 메인 프로세스 묶음(`.webpack/main/index.js`)을 읽어서 본 것이고, 실행해서 확인한 것은 아니다 → 이 앱도 같게 ([결정 76](../decisions.md)).
- 잠긴 상태에서 다시 누름: 끝내고 입력 ("re_press"). 시작 후 500ms 안에 세 번째로 누르면 취소 ("Action dismiss on quick triple action press").
- 앞 받아쓰기를 처리하는 중 누르면 무시하고 "처리 중" 알림 (알림은 500ms에 한 번).
- 온보딩 중에는 연습 단계가 아니면 단축키를 무시 ("Action down but onboarding not complete").
- → 이 앱에 그대로 적용 ([결정 11](../decisions.md)).

## 받아쓰기 데이터·음성 보관
- 기록 SQLite 열: `asrText`, `formattedText`, `pastedText`, 음성 BLOB, `duration`, `numWords`, `app`, `url` 등.
- 오래된 음성은 업로드 후 지우고 VACUUM. "NeverStore" 모드에서는 사용 통계만 남김.
- 통계 항목: 총 단어 수, 오늘·이번 주 단어 수, 평균 WPM, 연속 사용일(일·주), 사용한 앱 수.
- 회의 녹음 로컬 보관 기본 7일, 처리 안 된 음성 30일.
- 받아쓰기 인식은 gRPC `inference.wisprflow.com`(Baseten/Modal) 서버, 서식 정리는 Llama 계열, 자체 인식 모델 "Canto" (자세한 내용은 아래 "서버 API로 하는 일").
- → 이 앱은 인식을 로컬에서 하고, 음성은 바로 지우고 통계용 데이터만 남김 ([결정 1·5](../decisions.md)).

## 서버 API로 하는 일 (2026-11-05, v1.6.1337 메인 프로세스 코드)
- **앱 안에 음성 인식 모델이 없다**: 묶음에 `.onnx`·`.gguf`·`.bin`(모델)·`.mlmodelc` 파일이 없다. 로컬에서 도는 모델·Hugging Face 내려받기 코드도 찾지 못했다.
- **받아쓰기 = gRPC `flow_api.v1.TranscriptionService`** (`Transcribe`, 양방향 스트리밍 `TranscribeStream`). 서버 이름 `inference.wisprflow.com`, 같은 목록에 `model-v31pl413.grpc.api.baseten.co`(Baseten)·`…modal.direct`(Modal) — 둘 다 GPU 모델 호스팅 서비스. 주소는 `inference-info.wisprflow.com/dictation_url.txt`에서 받아 오기도 한다.
  - 보내는 것(`Request`): 음성 조각(`audio_packets`)과 함께 `Context` — 앞에 있는 앱(이름·번들 ID·URL), 입력칸 글(커서 앞·뒤·선택한 글), 화면 내용(`screen_content_ax` 손쉬운 사용 트리·`screen_content_ocr`), 변수·파일 이름, 대화(참여자·메시지), 스크린샷 칸, 사전·바꿔 쓰기·스니펫(개인·팀), 글쓰기 스타일.
  - 받는 것(`Result`): 서식 정리한 글(HTML·평문), 단어 시각, 신뢰도, 진행 단계(`transcriber` → `formatter` → 후처리).
  - 인식기 종류 열거형: `MIXTURE · WHISPER · SCRIBE · VOXTRAL · QWEN`. 이름으로 보아 여러 인식 모델(OpenAI Whisper, ElevenLabs Scribe, Mistral Voxtral, Qwen 계열 — 추정)을 서버에서 섞거나 고르는 것 같다. 어느 것을 언제 쓰는지는 서버 쪽이라 모른다.
- **나머지는 REST `api.wisprflow.ai/api/v1/…`** (실시간은 `wss://api.wisprflow.ai`, `/api/v1/sync/ws`):
  - 회의(Notetaker): 녹음 올리기(`meetings/{id}/upload-url`·`audio-uploads`·`live-transcript/upload-url`), 다듬은 녹취·화자 나누기(`refined-transcript`, `transcript-speakers/split`), 요약(`quick-summary`, `candidate-summary`, 피드백), 폴더 자동 분류, 공유, Zoom·Fireflies 가져오기, 회의 채팅(`notetaker-chats`), 주간 사용량(`meetings/weekly-quota`)
  - 글 바꾸기·명령: `transform/apply/stream`, `voice-actions/realtime`, 할 일 `todos/sync`, 메모 `notes/sync`
  - 개인화: 사전(개인·팀·공유), `wispr-memory`, `memory/context`, `learned-preferences/generate`, 목소리 설정 올리기, 문체 다듬기 기록(`polish/upload`, `instruct_history/upload`)
  - 연동: 캘린더(회의 전 자료 `preread`), 커넥터, MCP 연결, LinkedIn
  - 계정·결제·팀: 구독·결제, 기업·팀 초대, 추천·프로모션, 알림, 데이터 내보내기·삭제, 기기 등록
  - 수집: PostHog·Segment(사용 통계), Sentry·Datadog(오류·로그)
- → 이 앱과 다른 점: Wispr Flow는 인식·서식·요약을 모두 자기 서버에서 하고 화면 내용까지 문맥으로 보낸다. 이 앱은 Hugging Face에서 받은 모델(Whisper·pyannote)을 이 Mac에서 돌리고, 다듬기·회의록 글만 로그인된 Claude Code·Codex로 보낸다 ([결정 1](../decisions.md)).

## 회의 노트테이커 동작 (2026-11-05, v1.6.1337 메인 프로세스 코드·로그 문구)
- **봇이 회의에 들어가지 않는다**: 회의 참여 봇 관련 코드가 없다. Mac에서 마이크와 **시스템 소리**(상대방 목소리)를 함께 녹음한다 — `MacCatapSystemAudioLoopbackCapture`(Core Audio 탭), `MacSckSystemAudioLoopbackOverride`(ScreenCaptureKit). 시스템 오디오 권한이 없으면 녹음 대신 설정 안내를 연다 ("StartHeadlessSession: system audio not granted…"). 대면 회의(마이크만)도 되는지는 확인 못 함.
- **회의 자동 감지** (`[MeetingAutoDetect]`): 어떤 앱이 마이크를 쓰고 있는지(mic holder), 캘린더 일정, 브라우저 탭(손쉬운 사용으로 Meet 탭 확인)을 함께 보고 "Meeting detected" 카드를 띄운다(20초 뒤 사라짐). 회의 앱이 마이크를 놓거나 탭이 닫히면 자동으로 끝낸다. 대상 플랫폼: Zoom·Google Meet·Teams·Webex·Slack·Discord·FaceTime 등. 회의를 바꾸면 이전 녹음을 끝내고 새로 시작, 잠자기·사용자 전환 때 그 시점에서 마무리.
- **녹음 중 실시간 녹취**: 소리 조각을 서버로 계속 보내 받아쓴다 (`[MeetingTranscription] Failed to send audio chunk`, 보내지 못하면 버퍼에 쌓다가 가득 차면 오래된 것부터 버림). 실시간 녹취는 `live-transcript/upload-url`로 NDJSON 파일로 올린다.
- **누가 말하는지 = 회의 앱 화면을 읽는다**: `StartSpeakerPolling`으로 회의 앱 창(메인 창·작은 창·옆 창·앱 트리)을 손쉬운 사용으로 주기적으로 읽어 지금 말하는 사람 이름, 참여자 이름, 음소거한 사람, 내 이름을 뽑는다 (`MeetingSpeakerChange`: speakerName·participantNames·mutedNames·selfName, 맞춤 상태 matched·ambiguous·unknown). 이 기록을 `speaker-observations`로 올린다. 목소리로 화자를 나누는 코드는 앱에 없다 (서버에서 하는지는 모름).
- **녹음 파일**: Opus(`audio/ogg`)로 압축해 `meetings/{id}/audio-uploads`로 올린다. Opus가 실패하면 WAV로, 크기 제한(upload cap)이 있다.
- **회의 뒤 서버에서 다듬기(refine)**: 서버가 다듬은 녹취(`refined-transcript`)를 만들면 앱이 받아 바꿔 넣는다 ("RefinedTranscriptLanded"). 화자 이름 고치기·나누기(`transcript-speakers/split`), 화자를 연락처에 연결, 요약(`quick-summary`, `candidate-summary`), 폴더 추천, 회의 채팅(Claude Agent SDK 문구도 있음).
- **그 밖**: 캘린더 알림·회의 창 옆에 붙이기, 주간 녹음 한도("Weekly meeting recording limit reached")·회의당 최대 길이, 참석자 안내 문구("I'm using Wispr Notetaker to transcribe this meeting…"), 로컬 보관 기한(앞 절의 7일·30일).
- → 이 앱과 다른 점: 이 앱은 회의가 끝난 뒤 이 Mac에서 녹취(Whisper)와 목소리 기반 화자 구분(pyannote)을 하고, 대면 회의를 기본으로 본다. Wispr Flow는 화상 회의 중심이고, 녹취·요약은 서버, 화자는 회의 앱 화면에 뜬 이름으로 붙인다.

## 허브 창(본 화면) 구조
- 창 이름 "Flow Hub". 크기 상수 1350×850, 최소 1140×750. `frame:false`, `titleBarStyle:"hidden"`, 신호등 위치 `{x:16, y:15}`, 투명 창(macOS)에 CSS로 배경을 그림. 메인 창에 vibrancy 없음.
- 위 막대 44px(`-webkit-app-region: drag`), 본문은 셸 위에 떠 있는 둥근 판: `border-radius: 24px 24px 16px 16px; border: 1px solid; margin: 0 8px 8px 0`.
- 본문 최대 폭 약 1046px, 가운데 정렬, 40px 안쪽 여백, 구역 사이 32px.
- 사이드바 200px(펼치면 260px). 항목: Home, Insights, Notetaker, Scratchpad, Dictionary, Snippets, Style, Memory, My Voice, My Tasks, Transforms, Extensions, Settings, Help. 아래쪽에 추천·팀 초대·업그레이드 카드.
- 설정은 **왼쪽 메뉴가 있는 모달** (Settings 묶음: General, System, Notetaker, Connectors, Extensions, MCP, Vibe coding, Data and Privacy, Experimental / Account 묶음: Account, Team, Plans and Billing). 아래에 업데이트 상태.
- cmdk 라이브러리의 명령 팔레트, 화면마다 검색칸("Search past transcripts" 등), 토스트(보관·삭제 되돌리기).
- 홈: 통계 줄(total words, wpm, day streak, week streak) + 날짜별 기록("Today's dictations"), 줄마다 복사·재생·피드백·삭제(확인 창). 빈 상태 "No dictations yet / Don't type, just speak!".
- 모달 배경 `rgba(26,26,26,.3)`(라이트), `rgba(0,0,0,.55)`(다크).
- → 이 앱의 셸·둥근 판·설정 모달·⌘K·토스트 구조 ([결정 9](../decisions.md)).

## 온보딩(처음 설정)
- **별도 창 없이 허브 창 안**에서 진행. 로그인 → 온보딩 → 본 화면 순으로 허브가 고른다.
- 페이지 목록(`PW` 열거형)은 고정 배열이 아니라 **실행 때 조건으로 만든다**. 맥 기본 받아쓰기 흐름: Welcome → ProductIntent → AboutYourself → SpendTimeTyping → Privacy → **Permissions**(맥에서는 항상) → **MicrophoneTest** → **Shortcut** → Language → **Try it yourself** → (개인화·팀·체험판·추천).
- 진행 저장: `prefs.user.pagesCompleted = [{page, completed}]`. 지금 페이지 = 첫 번째 미완료 페이지 → 다시 열면 거기서 이어짐. 새 페이지가 추가되면 미완료로 끼어든다. 모두 끝나면 `onboardingCompleted: true`.
- 진행 표시 구역: Sign up / Permissions / Set up / Learn / Personalize.
- 뒤로: 이전 페이지를 미완료로 되돌려 지금 페이지로 만든다. 전체 건너뛰기는 없고 페이지별로만 (연습은 15초 뒤).
- **권한 페이지**: 맥은 마이크·손쉬운 사용. 카드 하나씩(지금 카드 = 첫 번째 미허용). 허용 누름 → 처음엔 macOS 요청, 다시 누르면 시스템 설정 열기. 누른 뒤 **1초마다** 상태 확인, **창으로 돌아오면** 확인, 허용되면 창을 앞으로. 요청 10초 시간 초과 알림. 다 허용해야 넘어감 ("Some permissions are not yet granted…").
- **손쉬운 사용 안내 패널**(`accessibility_drop`): 560×144, 테두리 없는 투명 패널, 항상 위, 시스템 설정 창 아래 12px에 500ms마다 위치를 맞춤, 10분 뒤 자동으로 닫힘. "Drag this icon into the Accessibility list" + 앱 아이콘을 끌어다 놓는 줄 (`webContents.startDrag`).
- **마이크 확인**: "Do you see purple bars while you speak?", 13칸 레벨(이전 0.7 + 새 값 0.3로 부드럽게), 마이크 바꾸기. 30초 동안 안 들리면 안내, 60초 뒤엔 그냥 넘어갈 수 있음. 블루투스(AirPods) 경고.
- **단축키 확인**: 눌린 키를 키캡 그림에 표시, 다 눌리면 확인 완료. "Does the button turn purple while pressing it?" fn 키가 없는 키보드면 다른 조합으로 자동 전환.
- **연습(Try it yourself)**: Slack → Gmail → Notion 모양의 가짜 앱 탭, 실제 입력칸. 입력칸에 글이 들어오면 완료. 10초 뒤 "Click on the textbox first!", 톡 누르기만 하면 "Don't tap. Hold down…", 두 번 누르기 연습("Double tap to flow hands-free"). 예문: "Umm Hi Greg. Let's connect soon. Are you available on Friday at 3, no actually 4? …"
- 온보딩을 마치기 전에 다른 앱에서 받아쓰면 "Just a few more steps!" 안내.
- 나중에 권한이 꺼지면 온보딩을 다시 열지 않고, 받아쓰기 시점에 알림 + 시스템 설정 열기.
- → 이 앱의 처음 설정 ([결정 22](../decisions.md)). 설문·체험판·추천·개인화 페이지는 넣지 않았고, 권한·엔진에 "나중에 하기"를 남긴 점이 다르다.

## Windows 판 (2026-11-21, v1.6.1568 배포 패키지 — 실행하지 않고 본체 코드와 도우미 프로그램의 문자열을 읽음)
Windows 지원을 검토하면서 확인했다. 이 앱은 아직 Windows를 지원하지 않는다.
- **도우미 프로그램**: 본체(Electron)와 별개인 네이티브 프로그램 `Wispr Flow Helper.exe`(x64, .NET NativeAOT)가 키 감지와 붙여넣기를 맡는다. 본체는 인자 없이 띄우고 표준 입력으로 요청, 4번째 통로(fd 3)로 응답·이벤트를 주고받는다. 메시지는 JSON에 `|`를 붙여 끊고, macOS 도우미(Swift)와 메시지 종류를 같이 쓴다. 본체가 0.5초마다 살아 있는지 보고 15초 답이 없으면 다시 띄운다(0·1·2·4·8·16초 간격 뒤 포기).
- **키 감지**: 저수준 키보드·마우스 훅(`SetWindowsHookExW`). Electron `globalShortcut`도 `RegisterHotKey`도 쓰지 않는다. 키 코드는 Windows 가상 키 값 그대로, 누름/뗌에 차례 번호를 붙여 보낸다.
- **기본 단축키**: 받아쓰기 Ctrl+Win, 손 떼고 받아쓰기 Ctrl+Win+Space, 취소 Esc, 마지막 글 붙여넣기 Alt+Shift+Z. fn 키는 Windows에서 언급이 없다.
- **두 번 누르기 규칙**: `DICTATION_DEBOUNCE_DELAY=500`. macOS와 같은 본체 코드를 쓰고 OS 분기가 거의 없다 → 이 앱의 `src/app/fn.mts`가 OS와 무관한 것과 같은 구조.
- **Win 키와 Caps Lock**: Win 키를 뗄 때 시작 메뉴가 열리지 않게 가짜 키 입력을 끼워 넣는다("masking sequence"). Caps Lock을 단축키로 쓰면 대문자 고정 상태를 되돌린다.
- **키가 눌린 채 남는 문제**: 본체가 5초마다 도우미에 실제 상태를 묻고 10초 넘은 키는 강제로 지운다. 훅이 떨어지면 감시해서 다시 걸고, 폭주하면 도우미가 종료 코드 86으로 끝난다.
- **붙여넣기**: 원래 클립보드 보관 → 받아쓴 글을 "나중에 내주기"(delayed rendering)로 등록 → Ctrl+V(편집기·터미널은 Shift+Insert) 흉내 → 대상이 가져가면 성공으로 판단 → 그사이 클립보드가 바뀌지 않았을 때만 복원. Windows 클립보드 기록·클라우드 동기화에서 빠지게 표시한다. 글자를 하나씩 치는 방식의 흔적은 없다.
- **관리자 권한 창**: 낮은 권한 프로그램의 입력을 Windows가 막는다. 감지해서 실패로 알릴 뿐 우회하지 않는다(도움말은 "Flow를 관리자로 실행"을 안내).
- **권한**: Windows에서는 권한 확인이 모두 "있음"을 돌려준다. 마이크만 Windows 설정(레지스트리)으로 확인하고 `ms-settings:privacy-microphone`을 연다.
- **시스템 소리**: `setDisplayMediaRequestHandler`에서 Windows면 `{ audio: 'loopback' }` → 이 앱 `main.js`의 `wasapi_loopback` 분기와 같은 방식.
- **로컬에서 도는 모델**: 목소리 특징 모델(26.5MB, ONNX)과 언어 판별 모델뿐이고, Windows에서는 CPU로만 돌린다. 묶음에 DirectML 파일이 있지만 쓰는 코드를 찾지 못했다. 음성 인식·글 다듬기는 서버.
- **설치**: 6MB 내려받기 프로그램이 약 360MB 본 패키지(Squirrel)를 받아 검증 후 사용자별로 설치한다(`%LOCALAPPDATA%\WisprFlow`, 관리자 권한 불필요, x64만). 로그인 때 실행은 시작프로그램 폴더 바로가기.
- **떠 있는 표시줄**: 창 종류 `toolbar`, 포커스 받지 않음, 보일 때마다 "항상 위"를 다시 건다. 클릭 통과는 `setShape`.
- 확인하지 못한 것: 시작 메뉴를 막을 때 끼우는 키, 붙여넣기 대기·복원 시간의 실제 값, Shift+Insert를 쓰는 앱 목록(도우미 안에 있어 문자열로는 보이지 않는다).

## 확인하지 못한 것
- 허브 기본 크기 상수가 실제로 1350×850인지(가리키는 이름까지 확인 못 함), 화면 크기에 맞춰 줄이는지.
- ⌘K 팔레트를 여는 단축키.
- 새 디자인 연습 페이지(채팅 흉내)의 완료 조건, fn 대체 단축키 값, 언어 페이지 계속 버튼 조건.
- 실험 플래그 기본값(서버에서 내려옴) — 일반 사용자가 실제로 어떤 변형을 보는지.
- Claude 데스크톱·Notion은 화면을 웹에서 불러와 앱 묶음으로는 화면 구조를 알 수 없었다 (창 옵션만 확인: 둘 다 `titleBarStyle: hidden(Inset)`, vibrancy 없음).
