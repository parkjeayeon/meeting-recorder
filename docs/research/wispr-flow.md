# Wispr Flow 분석 기록

이 앱의 받아쓰기·화면·처음 설정은 Wispr Flow를 참고했다. 설치된 Wispr Flow(macOS, v1.6.x)의 앱 묶음(`app.asar`)을 풀어 **읽기만** 했다 (실행하지 않음). 도구는 REA(역공학 MCP)와 파이썬·grep. 아래는 코드에서 확인한 사실이고, 확인하지 못한 것은 따로 적었다.

조사 대상 파일 (`Wispr Flow.app/Contents/Resources/app.asar` 안):
- `.webpack/main/index.js` — 메인 프로세스
- `.webpack/renderer/hub/index.js` — 허브 창(본 화면·온보딩), 약 5.9MB, CSS 모듈·영어 문구 포함
- `.webpack/renderer/accessibility_drop/` — 손쉬운 사용 권한 안내 패널

## 받아쓰기 단축키 규칙
- 기준값 `DICTATION_DEBOUNCE_DELAY = 500`(ms), 최대 길이 `DICTATION_DURATION_TIMEOUT = 20분`, 경고 `DICTATION_DURATION_WARNING_TIMEOUT = 19분`.
- 누르면 바로 듣기 시작.
- 뗄 때: 시작 후 500ms 이상이면 끝내고 입력. 500ms 안이면 500ms 더 기다렸다가 두 번째 누름이 없으면 버림 ("PTT stopping after timeout waiting for double press").
- 듣는 중 시작 후 500ms 안에 다시 누름: 잠금(손을 떼도 계속 듣기, 내부 이름 "POPO lock"). 같은 녹음을 이어간다.
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

## 확인하지 못한 것
- 허브 기본 크기 상수가 실제로 1350×850인지(가리키는 이름까지 확인 못 함), 화면 크기에 맞춰 줄이는지.
- ⌘K 팔레트를 여는 단축키.
- 새 디자인 연습 페이지(채팅 흉내)의 완료 조건, fn 대체 단축키 값, 언어 페이지 계속 버튼 조건.
- 실험 플래그 기본값(서버에서 내려옴) — 일반 사용자가 실제로 어떤 변형을 보는지.
- Claude 데스크톱·Notion은 화면을 웹에서 불러와 앱 묶음으로는 화면 구조를 알 수 없었다 (창 옵션만 확인: 둘 다 `titleBarStyle: hidden(Inset)`, vibrancy 없음).
