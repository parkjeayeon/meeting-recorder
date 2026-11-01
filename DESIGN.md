---
name: Meeting Recorder
description: 말로 쓰는 macOS 받아쓰기·회의록 앱. 옅은 회청 셸 위에 흰 본문 판이 떠 있는 Electron 앱 창.
colors:
  shell: "#eceef1"
  shell-hover: "rgba(21, 23, 26, 0.05)"
  shell-on: "rgba(21, 23, 26, 0.08)"
  panel: "#ffffff"
  panel-2: "#f6f7f9"
  panel-3: "#eef0f3"
  line: "#e6e8ec"
  line-2: "#d5d9df"
  ink: "#15171a"
  ink-2: "#4a5059"
  ink-3: "#6b727c"
  accent: "#c83a1a"
  accent-hover: "#b33317"
  accent-ink: "#ffffff"
  accent-wash: "rgba(200, 58, 26, 0.09)"
  accent-wash-2: "rgba(200, 58, 26, 0.16)"
  ok: "#1a7a50"
  focus: "rgba(200, 58, 26, 0.5)"
  backdrop: "rgba(26, 28, 32, 0.3)"
  s1: "#2a78d6"
  s2: "#eda100"
  s3: "#1baf7a"
  s4: "#6250d6"
  s5: "#e87ba4"
  s6: "#008300"
  dark-shell: "#111214"
  dark-shell-hover: "rgba(236, 237, 239, 0.06)"
  dark-shell-on: "rgba(236, 237, 239, 0.1)"
  dark-panel: "#1a1b1e"
  dark-panel-2: "#212226"
  dark-panel-3: "#28292e"
  dark-line: "#2b2d32"
  dark-line-2: "#3a3d43"
  dark-ink: "#ecedef"
  dark-ink-2: "#b6bac1"
  dark-ink-3: "#8d939c"
  dark-accent: "#ff6a4a"
  dark-accent-hover: "#ff8166"
  dark-accent-ink: "#1a0b06"
  dark-accent-wash: "rgba(255, 106, 74, 0.12)"
  dark-accent-wash-2: "rgba(255, 106, 74, 0.2)"
  dark-ok: "#4cc28c"
  dark-focus: "rgba(255, 106, 74, 0.55)"
  dark-backdrop: "rgba(0, 0, 0, 0.55)"
  dark-s1: "#3987e5"
  dark-s2: "#c98500"
  dark-s3: "#199e70"
  dark-s4: "#9085e9"
  dark-s5: "#d55181"
  dark-s6: "#008300"
typography:
  display:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "30px"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "28px"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  page-title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  sheet-title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "20px"
    fontWeight: 720
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "16px"
    fontWeight: 700
    letterSpacing: "-0.015em"
  card-title:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "15.5px"
    fontWeight: 680
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.005em"
    fontFeature: "'ss06'"
  reading:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.7
  control:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "13px"
    fontWeight: 550
  label:
    fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
  numeric:
    fontFamily: "\"SF Mono\", ui-monospace, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0"
    fontFeature: "'tnum'"
  stat:
    fontFamily: "\"SF Mono\", ui-monospace, Menlo, monospace"
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.02em"
rounded:
  xs: "5px"
  sm: "6px"
  md: "8px"
  field: "9px"
  lg: "12px"
  card: "14px"
  panel: "16px"
  sheet: "18px"
  full: "999px"
spacing:
  inset: "8px"
  gap-xs: "6px"
  gap: "12px"
  gap-lg: "16px"
  head: "24px"
  section: "40px"
  page-top: "36px"
  page-x: "44px"
  topbar: "44px"
  sidebar: "236px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-2}"
  button-ghost-hover:
    backgroundColor: "{colors.shell-hover}"
  button-record:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-record-hover:
    backgroundColor: "{colors.accent-hover}"
  button-record-on:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
  button-small:
    height: "28px"
    padding: "0 10px"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    size: "32px"
  play-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.full}"
    size: "38px"
  nav-item:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.shell-on}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.full}"
    padding: "0 11px"
    height: "28px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  tag:
    backgroundColor: "{colors.panel-3}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "22px"
  tag-accent:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
  input-search:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 10px 0 32px"
    height: "34px"
  panel-main:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  card-meeting:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 18px 14px"
  script-line-playing:
    backgroundColor: "{colors.accent-wash}"
    rounded: "{rounded.field}"
    padding: "7px 10px"
  switch-on:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.full}"
    width: "36px"
    height: "21px"
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "11px"
    padding: "8px 8px 8px 16px"
  toast-error:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
---

# Design System: Meeting Recorder

## Overview

**Creative North Star: "셸 위의 한 장"**

창은 Wispr Flow·Notion·Linear·Claude 데스크톱과 같은 Electron 앱 문법을 따른다. 옅은 회청 셸(사이드바 바탕이자 창 바탕) 위에 흰 본문 판 한 장이 오른쪽·아래로 8px 띄워져 떠 있고, 셸 위쪽 44px 막대에 신호등·현재 위치·녹음 버튼이 놓인다. 모든 내용은 그 판 안에서 읽힌다. 판은 16px 둥근 모서리, 1px 선, 거의 보이지 않는 그림자로 셸과 갈라진다.

색은 회청 무채 위에 잉크와 주홍 둘뿐이다. 잉크는 행동(주요 버튼, 선택된 칩, 켜진 스위치, 재생 버튼)을 채우고, 주홍은 "지금 녹음 중이거나 살아 있는 것"과 "손봐야 할 것"을 표시한다. 회의 녹취의 화자만 검증된 6색 범주 팔레트를 쓴다. 서체는 Pretendard 한 벌이고, 시각·길이·개수 같은 숫자만 SF Mono 고정폭으로 맞춘다. 밀도는 지식 노동자용 도구답게 촘촘하되(본문 14px, 컨트롤 32px), 회의 문서와 스크립트는 14.5px·72ch로 읽기 폭을 지킨다.

창은 macOS 숨은 제목 막대(신호등 위치 x16·y15)를 쓰고, 창 바탕색은 셸 색과 같아 열릴 때 번쩍이지 않는다. 기본 1240×820, 최소 960×640. 라이트·다크는 시스템 설정을 따르며 같은 토큰 이름을 다크 값으로 바꿔 끼운다. 다른 앱 위에 뜨는 플로팅 독(src/overlay)은 이번 세계로 옮기지 않았다: 이전 "잉크 독" 스타일과 토큰(#c7361b 계열)을 그대로 쓰는 범위 밖 표면이며, 이 문서의 규칙은 독에 적용된 것으로 보지 않는다.

**Key Characteristics:**
- 회청 셸 + 떠 있는 흰 본문 판(16px, 8px 여백) + 셸 위 44px 상단 막대
- 잉크 채움 주요 행동, 주홍은 녹음·라이브·주의에만
- Pretendard 한 서체, 숫자는 SF Mono tabular
- 그림자는 판과 떠오르는 층(메뉴·모달·토스트)에만, 카드는 선으로 갈린다
- 화자 6색은 고정 순서, 늘 이름과 함께

## Colors

차가운 회청 무채 위에 잉크 하나, 주홍 하나, 그리고 화자용 범주 팔레트.

### Primary
- **주홍 (Live Vermilion)** (`accent`): 회의 녹음 버튼 채움, 녹음 중 상단 알약과 점, 실시간 소리 띠, 재생 중인 스크립트 줄(바탕 `accent-wash`, 시각 글자 주홍), 다듬기 교정 부호(취소선·밑줄 색), 회의록 작업 진행 막대와 퍼센트. 주의가 필요한 것에도 쓴다: 오류 글자, 실패한 엔진 점, 설정 알림 점, 문제 카드 바탕(`accent-wash`), 삭제 확인 버튼, 실패 토스트. 앱 표식(사이드바 마이크 칸)도 주홍이다. 다크에서는 `dark-accent`로 밝아지고 그 위 글자는 `dark-accent-ink`.
- **주홍 물 (Vermilion Wash)** (`accent-wash`, `accent-wash-2`): 주홍 상태의 바탕과 테두리. 켜진 녹음 버튼, 강조 태그, 선택 영역, 입력 칸 포커스 링(3px).

### Neutral
- **잉크 (Ink)** (`ink`): 본문 글자, 주요 버튼·선택 칩·켜진 스위치·재생 버튼·재생 헤드·툴팁·토스트의 채움.
- **잉크 2 / 3** (`ink-2`, `ink-3`): 보조 글과 설명(2), 메타·시각·자리표시(3). 막대 차트 기본 막대도 `ink-2`.
- **셸 (Shell)** (`shell`): 창 바탕, 사이드바, 상단 막대. 셸 위 항목의 hover·선택은 잉크를 옅게 깐 `shell-hover`·`shell-on`.
- **판 (Panel)** (`panel`, `panel-2`, `panel-3`): 본문 판과 카드(1), 행 hover·플레이어 틀·설정 목차(2), 태그·트랙·코드·눌림 바탕(3).
- **선 (Line)** (`line`, `line-2`): 카드·구획 선(1), 버튼·입력·칩 테두리(2).
- **초록 (OK)** (`ok`): 엔진 준비됨 점, 완료된 단계 번호, 성공 결과 글자.

### Speaker Palette
- **화자 1–6** (`s1`–`s6`, 다크 `dark-s1`–`dark-s6`): 파랑·호박·초록·보라·분홍·짙은 초록. dataviz 검증기로 라이트·다크 모두 통과한 고정 순서 범주 팔레트. 스크립트 화자 점, 플레이어 파형 구간과 범례, 화자 탭 사각 표식과 점유율 막대에 쓴다. 일곱 번째 화자부터는 순서를 반복한다.

### Named Rules
**The Ink-Acts Rule.** 주요 행동은 잉크로 채운다: 저장·만들기·추가 버튼, 선택된 칩, 켜진 스위치, 재생 버튼. 주홍 채움은 회의 녹음 버튼, 삭제 확인, 실패 토스트에만 있다.

**The Vermilion-Means-Live Rule.** 주홍은 녹음·라이브·재생 위치·교정 부호·주의 상태를 뜻한다. 장식이나 일반 강조, 링크가 아닌 일반 글에 쓰지 않는다.

**The Labeled Speaker Rule.** 화자 색은 `s1`부터 고정 순서로 배정하고, 언제나 화자 이름 글자와 함께 놓는다. 색만으로 화자를 구별하게 하지 않는다.

## Typography

**Display Font:** Pretendard Variable (앱에 포함한 OFL 파일, `-apple-system`·Apple SD Gothic Neo 대체)
**Body Font:** Pretendard Variable
**Label/Mono Font:** SF Mono (ui-monospace, Menlo 대체), 숫자 전용

**Character:** 한 가족의 굵기 차이만으로 위계를 세운다. 큰 제목은 750 굵기에 자간을 -0.03em까지 조여 단단하게, 본문은 14px에 `ss06`과 `keep-all` 줄바꿈으로 한국어를 단정하게 놓는다. 숫자는 고정폭이라 시각과 길이가 줄마다 정렬된다.

### Hierarchy
- **Display** (750, 30px, 1.2): 홈 인사 한 줄.
- **Headline** (750, 28px, 1.25): 회의 상세 제목.
- **Page Title** (700, 26px, 1.2): 받아쓰기·회의·사전·통계 페이지 머리. 옆 개수는 15px 고정폭 `ink-3`.
- **Sheet Title** (720, 20px): 설정 각 구획 제목.
- **Section Title** (700, 16px): 페이지 안 구획 머리, 모달 제목.
- **Card Title** (680, 15.5px, 1.35): 회의 카드 제목. 회의록 문서의 소제목은 17px/700.
- **Body** (400, 14px, 1.55): 기본 UI 글.
- **Reading** (400, 14.5px, 1.7; 스크립트 1.65): 회의록 문서·받아쓴 글·스크립트 발화, 최대 72–76ch.
- **Control** (550, 13px): 버튼, 메뉴, 빵부스러기.
- **Label** (500–650, 11.5–12.5px): 메타, 태그, 칩, 힌트, 날짜 머리.
- **Numeric** (SF Mono 12px, tabular): 시각, 길이, 개수, 퍼센트, 재생 시간, 키 입력 칸.
- **Stat** (SF Mono 600, 20px): 통계 숫자 칸.

### Named Rules
**The One Face Rule.** 글은 모두 Pretendard다. SF Mono는 숫자와 키 값에만 쓴다. 외부 폰트 CDN은 쓰지 않는다(오프라인 앱, CSP `font-src 'self'`).

**The No-Caps Label Rule.** 작은 라벨도 대문자 변환이나 넓은 자간을 쓰지 않는다. 작은 글은 크기와 `ink-3` 색으로만 물러선다.

## Layout

창은 두 칸 격자다: 왼쪽 236px 셸 사이드바(위 44px는 끌기 영역, 그 아래 앱 이름·⌘K 검색·목차, 맨 아래 엔진 상태 점 세 줄과 설정)와 오른쪽 주 영역. 주 영역은 셸 위 44px 상단 막대와 그 아래 본문 판으로 나뉘며, 판은 오른쪽·아래 8px만 띄운다(왼쪽은 사이드바가 맞닿는다). 판 안 페이지는 최대 1040px(넓은 페이지 1120px) 가운데 정렬, 안쪽 여백 36px·44px·64px.

리듬은 페이지 머리 아래 24px, 구획 사이 40px, 카드 격자 간격 12px, 행 간격 6–12px이다. 회의 카드는 `minmax(300px, 1fr)` 자동 채움 격자, 통계는 4칸 숫자 줄과 2열 카드. 받아쓰기와 스크립트는 카드가 아니라 시각 열(52–60px)을 둔 행 목록이다. 플레이어는 스크롤 시 판 위쪽에 붙고(sticky) 뒤를 12px 흐림으로 가린다.

1100px 아래에서는 페이지 여백이 28px로 줄고, 시작 단계 3칸·2열 카드가 한 열로, 숫자 줄이 2×2로 접힌다. 최소 창 960×640에서도 사이드바 폭은 유지한다.

## Elevation & Depth

깊이는 거의 평평한 층으로 만든다. 셸이 바닥, 본문 판이 한 층 위(1px 선 + 아주 옅은 그림자), 메뉴·모달·⌘K·토스트가 그 위 떠오르는 층이다. 판 안의 카드와 행은 그림자 없이 선과 바탕 단계(`panel` → `panel-2` → `panel-3`)로만 갈린다.

### Shadow Vocabulary
- **판 (panel)** (`box-shadow: 0 1px 2px rgba(16,20,26,.04), 0 2px 10px rgba(16,20,26,.03)`; 다크 `0 1px 2px rgba(0,0,0,.3)`): 본문 판, 상단 라이브 알약.
- **떠오름 (pop)** (`box-shadow: 0 12px 40px rgba(16,20,26,.16), 0 2px 8px rgba(16,20,26,.08)`; 다크 `0 16px 48px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3)`): 메뉴, 모달, ⌘K, 설정, 토스트.
- **카드 들림 (lift)** (`box-shadow: 0 6px 20px rgba(16,20,26,.06)` + 1px 올림): 회의 카드 hover에서만.

### Named Rules
**The Flat-At-Rest Rule.** 판 안의 요소는 쉬고 있을 때 그림자가 없다. 그림자는 판 자체, 떠오르는 층, 회의 카드 hover 반응에만 있다.

## Shapes

모서리는 담는 것이 클수록 둥글다: 키·코드 5px, 태그 6px, 버튼·목차·입력 8px, 검색·추가 입력과 행 9px, 화자·문제 카드 12px, 카드 14px, 본문 판·모달·⌘K 16px, 설정 시트 18px. 칩·라이브 알약·스위치·진행 점은 완전한 알약(999px). 선은 언제나 1px이며 키 표시만 아래 2px로 눌린 모양을 낸다. 아이콘은 20×20 격자 선 아이콘(1.6px 획, 둥근 끝)이고 16px로 그린다.

## Components

### Buttons
도구답게 낮고 단단하다.
- **Shape:** 8px 둥근 모서리, 높이 32px(작은 것 28px).
- **Primary:** 잉크 채움에 판 색 글자, 13px/550. hover는 `ink-2`로 옅어진다.
- **Secondary:** 판 바탕 + `line-2` 테두리, hover는 `panel-2` 바탕 + `ink-3` 테두리.
- **Ghost:** 테두리·바탕 없음, hover는 `shell-hover`. 상단 막대의 받아쓰기 버튼, 플레이어 속도·따라가기.
- **Record:** 주홍 채움, 상단 막대 오른쪽 끝의 회의 녹음 버튼과 회의 없음 상태의 시작 버튼. 녹음 중에는 `accent-wash` 바탕 + 주홍 글자로 바뀐다.
- **Hover / Focus:** 배경·테두리·색 0.12s ease-out, 누르면 1px 내려간다. 포커스는 2px `focus` 윤곽 + 2px 간격.
- **Icon:** 32px 정사각, 바탕 없음, hover는 `panel-3`.

### Chips
- **Style:** 28px 알약, 판 바탕 + `line-2` 테두리, `ink-2` 12.5px/550. 개수는 고정폭 11px.
- **State:** 선택되면 잉크 채움 + 판 색 글자(필터).

### Tags
- **Style:** 22px, 6px 모서리, `panel-3` 바탕, 11.5px/550. 강조 태그는 `accent-wash` + 주홍, 진행 중이면 앞에 맥박 점.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** 판(회의 카드, 작업 카드, 통계 카드) 또는 `panel-2`(시작 단계, 상태 상자).
- **Shadow Strategy:** 쉬는 동안 없음, 회의 카드 hover만 들림(Elevation 참조).
- **Border:** 1px `line`, hover는 `line-2`.
- **Internal Padding:** 16–18px 세로, 18–20px 가로.

### Inputs / Fields
- **Style:** 판 바탕, 1px `line-2`, 8–9px 모서리, 높이 34–38px. 검색은 왼쪽 16px 아이콘 자리 32px.
- **Focus:** 테두리가 `ink-3`로 짙어지고 3px `accent-wash` 링.
- **Switch:** 36×21 알약, 꺼지면 `line-2`, 켜지면 잉크 채움, 흰 손잡이가 15px 미끄러진다(0.18s 튀어나오는 곡선).

### Navigation
- **사이드바 목차:** 32px 행, 8px 모서리, `ink-2` 500. hover는 `shell-hover`, 현재 화면은 `shell-on` 바탕 + 잉크 650. 개수는 오른쪽 고정폭 `ink-3`.
- **상단 막대:** 빵부스러기(13px, 현재 위치는 잉크 600), 녹음·받아쓰기 중에는 가운데에 라이브 알약(주홍 맥박 점, 단계 표시, 소리 띠, 시간).
- **탭:** 38px, `ink-3` 600 글자, 선택되면 잉크 글자 + 아래 2px 잉크 선.
- **⌘K 팔레트:** 620px 폭 16px 모서리, 54px 입력 줄, 40px 항목, 선택 항목은 `panel-3`.

### Script Line (Signature)
회의 스크립트 한 줄은 시각(60px, 고정폭 버튼) · 화자(92px, 색 점 + 이름) · 발화(14.5px/1.65, 76ch) 세 열이다. 시각을 누르면 그 시각부터 재생되고, 재생 중인 줄은 `accent-wash` 바탕에 시각이 주홍으로 바뀌며, "따라가기"가 켜져 있으면 화면이 그 줄을 따라간다. 플레이어는 38px 잉크 원형 재생 버튼, 화자 색으로 칠한 파형 스크러버(잉크 재생 헤드), 고정폭 시간, 화자 범례로 이루어진다.

### Edit Marks
다듬기 결과는 교정 부호로 보인다: 지운 말은 `ink-3` 글자에 1.5px 주홍 취소선, 더한 말은 1.5px 주홍 밑줄(3px 띄움). "깨끗하게 보기"에서는 지운 말을 숨기고 밑줄을 뗀다.

### Toast
화면 아래 가운데, 잉크 채움 11px 모서리, 떠오름 그림자, 0.25s 아래에서 올라오는 등장. 실패 토스트는 주홍 채움.

## Do's and Don'ts

### Do:
- **Do** 모든 화면을 셸 위 본문 판(16px 모서리, 오른쪽·아래 8px 여백) 안에 놓고, 녹음·받아쓰기 버튼은 셸 상단 막대(44px)에 둔다.
- **Do** 저장·만들기·추가 같은 주요 행동과 켜진 스위치, 선택된 칩을 잉크로 채운다.
- **Do** 시각·길이·개수·퍼센트는 SF Mono tabular로 쓴다.
- **Do** 화자 색은 `s1`–`s6` 고정 순서로 쓰고 화자 이름과 함께 놓는다.
- **Do** 새 색이 필요하면 셸·판·선·잉크 단계와 주홍 물 안에서 먼저 찾고, 라이트·다크 두 값을 같은 토큰 이름으로 정의한다.
- **Do** 움직임은 0.12–0.15s ease-out 상태 전환과 떠오르는 층의 `cubic-bezier(.16, 1, .3, 1)` 등장으로 한정하고, `prefers-reduced-motion`에서는 모두 끈다.

### Don't:
- **Don't** 일반 주요 버튼이나 켜진 스위치를 주홍으로 채우지 않는다. 주홍 채움은 회의 녹음·삭제 확인·실패 토스트뿐이다.
- **Don't** 두 번째 강조 색을 들이지 않는다. 초록(`ok`)은 준비·완료 상태 표시에만 쓴다.
- **Don't** 판 안의 카드와 행에 쉬는 상태의 그림자를 주지 않는다.
- **Don't** 받아쓰기 목록이나 스크립트를 카드로 감싸지 않는다. 이들은 선으로 갈린 행 목록이다.
- **Don't** 화자를 색만으로 구별하게 하지 않는다.
- **Don't** 외부 폰트나 CDN 자원을 불러오지 않는다.
