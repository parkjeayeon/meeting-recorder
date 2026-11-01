---
version: 1
slug: "src-renderer-index-html"
primary_target: "src/renderer/index.html"
related_targets: ["src/overlay/index.html"]
---

# Surface: 메인 창 (Operate) + 플로팅 독

범위: src/renderer (홈 · 받아쓰기 · 회의 · 회의 상세 · 사전 · 통계 · 설정 모달 · ⌘K), src/overlay(독)는 새 토큰만 따른다.
사용자: 한국어 지식 노동자 한 명. 창은 하루 몇 번 연다: 회의록 읽기·공유, 받아쓴 글 다시 쓰기, 숫자 확인, 설정.
과제: 회의 결과를 읽고 녹음을 다시 들으며 확인, 받아쓰기 기록 찾기, 사전 관리, 계정·권한 문제 해결.
제약: macOS Electron, 오프라인(외부 폰트·CDN 없음), 녹음은 숨은 창에서도 계속된다, 다른 앱 위 독은 포커스를 뺏지 않는다.

## Direction contract

THESIS: 사용자가 고정한 방향 — Wispr Flow·Notion·Linear·Claude 같은 Electron 웹 앱 문법. 첫 화면은 "오늘"이 보이는 홈, 회의는 녹음과 함께 읽는 문서 페이지. 거부하는 것: 시스템 설정식 폼 나열, 한 장짜리 평평한 macOS 목록 창.

OWN-WORLD: 옅은 회청 셸(#eceef1, 사이드바 바탕) 위에 떠 있는 흰 본문 판(16px 둥근 모서리, 1px 선, 아주 옅은 그림자, 오른쪽·아래 8px 여백 — Wispr Flow 허브 실측을 따른 수정). Pretendard 한 서체, 숫자는 SF Mono tabular. 본문 안 주요 버튼은 잉크 채움, 주홍(#d9431f)은 녹음 중·라이브 상태·회의 녹음 버튼·재생 중인 줄·교정 부호에만. 카드(14px)는 홈과 회의 목록, 통계 패널에만. 화자 색은 검증된 6색 범주 팔레트. 다듬기 교정 부호(취소선/밑줄)와 스크립트 시각은 그대로 잇는다.

STORY: 창을 열면 인사와 오늘 숫자, 진행 중인 회의록 작업, 최근 회의 카드와 최근 받아쓰기가 보인다. 회의 카드를 누르면 회의 페이지: 제목·메타, 재생 막대, 회의록/정리본/원본/화자 탭; 스크립트 줄을 누르면 그 시각부터 재생되고 재생 중인 줄이 따라간다. 설정은 어디서든 ⌘, 모달.

FIRST VIEWPORT: 1200×800. 왼쪽 232px 셸: 신호등 아래 앱 이름, ⌘K 검색 칸, 목차(홈·받아쓰기·회의·사전·통계), 맨 아래 엔진 상태 점 세 개와 설정. 셸 위 44px 상단 막대(신호등, 현재 위치, 받아쓰기·회의 녹음 버튼 — 회의 녹음은 주홍 채움; Wispr Flow처럼 판 밖 셸에 둔다), 그 아래 본문 판, 그 아래 홈: 큰 인사(28px) + fn 안내, 숫자 4칸 줄, "진행 중" 작업 카드, 최근 회의 카드 그리드(2열), 최근 받아쓰기 목록.

FORM: 사용자가 고정한 Electron 앱 표준(canon, 사용자 지정). 기준 앱: Wispr Flow, Notion, Linear, Claude 데스크톱. 시그니처 상호작용: 스크립트 줄 클릭 → 그 시각부터 재생 + 재생 위치 따라가기. seed key e02d965c (surface 라운드에서 사용자가 재굴림 후 방향 고정).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
