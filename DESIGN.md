---
name: Meeting Recorder
description: 말로 쓰는 macOS 받아쓰기 앱. 창은 법원 속기록 한 장, 독은 쇠먹 잉크 덩어리.
colors:
  paper: "#fbfcfd"
  paper-2: "#f0f2f5"
  ink: "#16181b"
  ink-2: "#464c54"
  ink-3: "#69707a"
  rule: "#e1e5ea"
  rule-2: "#c9d0d8"
  fill: "rgba(22, 24, 27, 0.055)"
  fill-2: "rgba(22, 24, 27, 0.09)"
  vermilion: "#c7361b"
  vermilion-wash: "rgba(199, 54, 27, 0.08)"
  focus: "rgba(22, 24, 27, 0.55)"
  carbon-paper: "#141619"
  carbon-paper-2: "#1b1e22"
  carbon-ink: "#e8ebee"
  carbon-ink-2: "#b3bac3"
  carbon-ink-3: "#8b939d"
  carbon-rule: "#262a30"
  carbon-rule-2: "#353b43"
  carbon-fill: "rgba(232, 235, 238, 0.06)"
  carbon-fill-2: "rgba(232, 235, 238, 0.1)"
  carbon-vermilion: "#ff6b4f"
  carbon-vermilion-wash: "rgba(255, 107, 79, 0.1)"
  carbon-focus: "rgba(232, 235, 238, 0.6)"
  strip-rule: "#d5dbe2"
  dock-glyph: "#eef0f2"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.55
  transcript:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.55
  data:
    fontFamily: "\"SF Mono\", ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "20px"
    fontFeature: "\"tnum\""
  dock-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Apple SD Gothic Neo\", sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
rounded:
  key: "4px"
  control: "6px"
  strip: "8px"
  dock-button: "15px"
spacing:
  margin: "64px"
  gutter: "24px"
  sidebar: "152px"
  timestamp-column: "48px"
  row-y: "8px"
  form-row-y: "12px"
  form-label-column: "150px"
components:
  ink-btn:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 11px 0 9px"
    height: "30px"
  ink-btn-hover:
    backgroundColor: "{colors.fill}"
  ink-btn-on:
    backgroundColor: "{colors.vermilion-wash}"
    textColor: "{colors.vermilion}"
  line-btn:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 9px"
    height: "28px"
  row-btn:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "26px"
  row-btn-hover:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.ink}"
  toc-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    padding: "0 8px"
    height: "32px"
  toc-item-current:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.ink}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "5px 8px"
    width: "min(320px, 100%)"
  dock-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.dock-glyph}"
    rounded: "{rounded.dock-button}"
    size: "30px"
  dock-button-memo:
    backgroundColor: "{colors.vermilion}"
    height: "62px"
  strip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.dock-label}"
    rounded: "{rounded.strip}"
    padding: "0 12px 0 24px"
    height: "34px"
---

# Design System: Meeting Recorder

## Overview

**Creative North Star: "속기록"**

창은 설정 화면이 아니라 법원 속기록 한 장이다. 차가운 흰 기록 용지 위에 쇠먹 잉크로 시각과 발언이 적히고, 왼쪽 여백의 겹 세로 괘선 바깥에 줄 번호가 붙으며, 1px 청회색 가로 괘선이 기록 한 줄 한 줄을 나눈다. 색은 교정용 주홍 하나뿐이다. 다듬기가 지운 군말은 주홍 취소선, 고친 말은 주홍 밑줄로 남고, 같은 주홍이 "지금 녹음 중"과 "문제가 있음"을 칠한다. 나머지는 모두 잉크의 농담이다.

밀도는 서류의 밀도다. 카드, 통계 히어로, 대시보드 타일 없이 괘선과 여백만으로 구획한다. 선택과 hover는 괘선 사이를 연한 잉크로 채울 뿐 테두리를 더하지 않는다. 다크 모드는 별도의 세계가 아니라 같은 용지의 "먹지 사본"이다: 어두운 종이에 밝은 잉크, 주홍은 밝기만 올린다.

화면 왼쪽 가장자리의 플로팅 독은 같은 잉크의 덩어리다. 접혀 있을 때는 8px 잉크 손잡이, 펼치면 잉크 알약 버튼 세 개, 받아쓰기 중에는 손잡이 밑에서 기록 테이프 같은 진행 띠가 빠져나온다. 띠 안에서 받아쓰기 파이프라인은 듣기→인식→다듬기→입력의 네 역이 찍힌 한 줄 노선으로, 소리 크기는 장식 없는 수직 괘선 막대로만 그린다.

**Key Characteristics:**
- 겹 세로 괘선과 고정폭 줄 번호가 있는 한 장의 용지 (왼쪽 여백 64px)
- 주홍 하나가 교정 부호와 모든 살아있는 상태를 소유한다
- 테두리 없는 잉크 글자 버튼, 연한 잉크 채움으로 hover·선택
- 시각·길이·줄 번호·카운트는 SF Mono 고정폭 숫자(데이터)
- 라이트 용지와 "먹지 사본" 다크가 같은 토큰 이름을 공유
- 독은 그림자를 가진 유일한 표면: 다른 앱 위에 떠 있기 때문

## Colors

차가운 청회색 기운의 무채색 잉크 단계 위에 교정용 주홍 하나가 놓인 팔레트.

### Primary
- **교정 주홍** (vermilion / 먹지 사본 carbon-vermilion): 다듬기가 지운 말의 취소선과 고친 말의 밑줄, 녹음 중 표시점·상태 문구·레벨 막대, 노선의 "지금" 역, 정정 사항 앞의 점, 실패·경고 문구, 복사 완료 표시. 장식이나 강조 제목에는 쓰지 않는다.
- **주홍 물** (vermilion-wash): 주홍 상태 버튼(녹음 중인 받아쓰기·회의 녹음 버튼)의 바탕, 새로 적힌 기록 줄의 1.6초 번짐, 텍스트 선택 바탕.

### Neutral
- **기록 용지** (paper): 본문 용지와 입력 필드 바탕.
- **여백 용지** (paper-2): 왼쪽 목차 여백(152px)의 바탕. 먹지 사본에서는 독 진행 띠의 바탕도 이 값이다.
- **쇠먹 잉크** (ink): 발언, 제목, 버튼 글자. 독 버튼과 손잡이의 덩어리 색(독은 다크 모드에서도 쇠먹 그대로).
- **옅은 잉크** (ink-2): 시각, 보조 문장, 폼 라벨, 완료된 노선 역.
- **흐린 잉크** (ink-3): 줄 번호, 메타 정보, 힌트, 기록 줄 행동 버튼의 쉬는 상태, placeholder.
- **가는 괘선** (rule): 기록 줄 사이, 폼 행 사이, 목차 항목 사이의 1px 선.
- **굵은 괘선** (rule-2): 겹 세로 괘선, 상태 띠 위아래, 날짜 머리 밑줄, 폼 블록 제목 밑줄, 입력 필드 테두리, 레벨 기준선.
- **연한 잉크 채움** (fill / fill-2): hover는 fill, 눌림·현재 위치·줄 행동 hover는 fill-2. 테두리를 대신한다.
- **진행 띠 괘선** (strip-rule): 라이트 독 진행 띠의 테두리와 레벨 기준선. 먹지 사본에서는 carbon-rule-2로 바뀐다.
- **독 글자** (dock-glyph): 쇠먹 독 버튼과 툴팁 위의 글자·아이콘.

### Named Rules
**The 주홍 하나 Rule.** 색상은 주홍 하나뿐이다. 주홍은 교정 부호, 지금 진행 중인 상태, 문제·실패에만 칠한다. 두 번째 색상이 필요해 보이면 잉크 농담(ink / ink-2 / ink-3)으로 풀어라.

**The 먹지 사본 Rule.** 다크 모드는 같은 토큰 이름의 값만 바꾼다(종이는 #141619, 잉크는 #e8ebee, 주홍은 #ff6b4f). 다크 전용 구성 요소나 색상을 만들지 않는다.

## Typography

**Body Font:** macOS 시스템 서체 (-apple-system, Apple SD Gothic Neo)
**Label/Mono Font:** SF Mono (ui-monospace, Menlo)

**Character:** 한글 시스템 서체가 발언과 화면 문구를 맡고, SF Mono 고정폭 숫자가 기록의 데이터(줄 번호, 시각, 길이, 카운트, 키)를 맡는다. 속기록의 두 목소리: 사람의 말과 기계의 숫자.

### Hierarchy
- **Headline** (650, 20px, 1.2, -0.02em): 창 머리의 페이지 이름(기록·회의·설정) 하나뿐이다.
- **Title** (650, 13px): 앱 이름, 설정 서식의 블록 제목. 크기가 아니라 굵기와 밑줄 괘선으로 구분한다.
- **Transcript** (400, 14px, 20px 줄 높이, 최대 68ch): 받아쓴 발언. 사용자가 선택·복사할 수 있는 유일한 본문. 회의 줄은 13.5px.
- **Body** (400, 13px, 1.55): 창 전체 기본값. 상태 문구, 정정 사항, 폼.
- **Label** (400, 11.5-12px): 메타 정보, 힌트, 줄 행동 버튼, 목차 아래 엔진 상태.
- **Data** (SF Mono 11-12px, tabular-nums): 줄 번호 11px, 시각 12px, 타이머 12px, 목차 카운트 11px. 본문 안 숫자는 0.95em 고정폭으로 섞는다.

### Named Rules
**The 숫자는 데이터 Rule.** 시각, 길이, 줄 번호, 개수는 항상 SF Mono 고정폭 숫자로 적는다. 숫자를 크게 키워 히어로로 만들지 않는다.

**The 어절 줄바꿈 Rule.** 모든 화면(창과 독)은 `word-break: keep-all`로 한글을 어절 단위로 줄바꿈한다.

## Layout

창은 152px 목차 여백 + 본문 용지의 두 열 격자다. 본문 용지 안에서 모든 기록 요소(상태 띠, 정정 사항, 날짜 머리, 기록 줄, 빈 상태, 설정 서식)는 같은 64px 왼쪽 여백에서 글이 시작하고, 오른쪽은 24px에서 멈춘다. 여백 안쪽 52px·55px 위치에 겹 세로 괘선이 용지 전체를 관통해 여러 구역을 한 장으로 묶는다. 줄 번호와 상태 표시점은 이 괘선 바깥(여백 안)에 놓인다.

기록 줄은 [줄 번호 64px | 시각 48px | 발언] 세 열이다. 발언 밑에 메타 한 줄, 그 밑에 줄 행동 버튼(복사·다시 입력·원문)이 이어진다. 기록 줄은 상하 7-8px 패딩과 1px 괘선, 날짜 머리는 위 22px 여백과 굵은 괘선으로 묶음을 끊는다. 설정 서식은 [라벨 150px | 컨트롤] 두 열, 행마다 12px 패딩과 가는 괘선. 최소 창 너비 640px에서도 열 구조는 유지된다.

독은 화면 왼쪽 가장자리에서 6px 떨어져 세로 가운데에 붙고, 진행 띠는 화면 가장자리(left 0)에서 최대 290px까지 빠져나온다.

### Named Rules
**The 한 장의 용지 Rule.** 본문의 새 구역은 카드나 박스로 감싸지 않고 64px 여백 정렬과 괘선으로만 구획한다. 새 구역도 겹 세로 괘선 위에 놓여야 한다.

## Elevation & Depth

창은 완전히 평평하다. 깊이는 그림자가 아니라 용지 농도(paper / paper-2), 괘선의 굵기(rule / rule-2), 연한 잉크 채움으로 표현한다. 그림자는 다른 앱 위에 떠 있는 플로팅 독에만 있다: 손잡이, 독 버튼, 툴팁, 진행 띠. 모두 아래로 퍼지는 부드러운 검정 그림자이며 오프셋된 딱딱한 그림자는 없다.

### Shadow Vocabulary
- **독 손잡이** (`box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35)`): 접힌 8px 손잡이를 어떤 바탕 위에서도 떼어 낸다.
- **독 버튼** (`box-shadow: 0 2px 7px rgba(0, 0, 0, 0.4)`): 펼친 잉크 알약 버튼.
- **독 툴팁** (`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35)`): 버튼 오른쪽의 잉크 말풍선.
- **진행 띠** (`box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.12)`): 화면 가장자리에서 나온 기록 테이프.

### Named Rules
**The 창은 평평하다 Rule.** 메인 창에는 그림자를 쓰지 않는다. 그림자는 다른 앱 위에 떠야 하는 표면(독)의 권리다.

## Shapes

괘선 세계는 직선이다. 목차 항목과 기록 줄은 모서리가 없는 괘선 띠이고, 손으로 누르는 컨트롤만 살짝 둥글다: 잉크 버튼과 입력 필드 6px, 키캡(kbd)과 코드 조각 4px, 포커스 윤곽 3px. 동그라미는 상태 표시에만 쓴다: 상태 띠의 9px 고리(대기는 빈 고리, 녹음 중은 주홍으로 찬 점, 처리 중은 한쪽이 열린 회전 고리), 정정 사항과 설정 알림의 6px 점, 노선의 7px 역. 독은 예외적으로 알약(30px 버튼, 15px 반경)과 오른쪽만 8px 둥근 진행 띠를 쓴다; 띠의 왼쪽은 화면 가장자리에 붙어 직각이다. 키캡은 아래 테두리가 2px인 실제 키 모양이다.

## Components

### Buttons
테두리 없는 잉크 글자. 바탕 없이 시작하고 손이 닿으면 연한 잉크가 괘선 사이를 채운다.
- **Shape:** 살짝 둥근 모서리 (6px)
- **잉크 버튼(창 머리 행동):** 30px 높이, 쇠먹 글자 550, 16px 아이콘. hover는 fill, 눌림은 fill-2. 녹음 중이면 주홍 글자 + 주홍 물 바탕.
- **괘선 버튼(정정 사항·설정 행동):** 28px, 600. 주요 행동은 바탕 대신 1px 밑줄(4px offset)로 표시한다.
- **줄 행동 버튼:** 26px, 12px, 쉬는 상태는 흐린 잉크. 기록 줄에 hover하면 옅은 잉크로, 버튼 hover는 fill-2 + 쇠먹. 복사 완료는 주홍 글자.
- **Hover / Focus:** 배경·글자색 0.15s ease-out. 포커스는 1.5px 잉크(focus) 윤곽, 2px offset.

### Navigation
- **목차:** 32px 높이 괘선 띠 세 개(기록·회의·설정). [16px 아이콘 | 이름 | 고정폭 카운트] 격자. 쉬는 상태 옅은 잉크, hover fill, 현재 위치 fill-2 + 쇠먹 600. 설정에 문제가 있으면 카운트 자리에 6px 잉크 점.
- **엔진 상태:** 목차 여백 맨 아래, 괘선 위에 두 줄(음성 인식·다듬기) 정의 목록. 문제가 있으면 값만 주홍.

### Inputs / Fields
- **Style:** 기록 용지 바탕, 1px 굵은 괘선 테두리, 6px, 5px 8px 패딩, 최대 320px(textarea 420px).
- **Hover:** 테두리가 흐린 잉크로 진해진다. 포커스는 공통 잉크 윤곽.
- **Checkbox / Radio:** 14px, accent-color 쇠먹.
- **선택지 목록:** 괘선 띠 목록(최대 440px), 쓸 수 없는 항목은 흐린 잉크.

### 상태 띠 (Signature)
본문 머리 바로 밑, 굵은 괘선 두 줄 사이의 44px 띠. 여백 안의 9px 고리, 상태 문구 600, 보조 문구(흐린 잉크), 오른쪽 끝 고정폭 타이머. 녹음 중에는 고리와 문구가 주홍이 되고 1.1s 박동하며, 오른쪽에 최대 360px 레벨 테이프(굵은 괘선 기준선 + 1.5px 폭 주홍 수직 막대, 4px 간격)가 흐른다. 처리 중에는 노선(듣기→인식→다듬기→입력: 7px 역, 22px 연결선, 완료 역은 옅은 잉크로 채움, 지금 역은 주홍, 건너뛴 역은 취소선)이 나타난다.

### 정정 사항 (Signature)
권한·엔진 문제는 상태 띠 밑에 기록 줄과 같은 괘선 한 줄로 끼어든다: 여백 안의 6px 주홍 점, 굵은 요지 + 옅은 잉크 설명, 오른쪽 끝 괘선 버튼. 배너, 경고 상자, 아이콘 박스로 만들지 않는다.

### 기록 줄과 교정 부호 (Signature)
[줄 번호 | 시각 | 발언] 한 줄. 지운 말은 주홍 1.5px 취소선, 넣은 말은 쇠먹 글자에 주홍 1.5px 밑줄(3px offset). 원문 보기는 발언 밑 12.5px 옅은 잉크 줄 앞에 "원문 "을 붙인다. 받아쓴 글이 없는 줄은 발언을 흐린 잉크로 적는다. 새 줄은 주홍 물에서 1.6s 동안 빠진다. 빈 상태는 64px 여백에서 시작하는 두 문장과 그 밑 32px 간격 빈 괘선들.

### 플로팅 독 (Signature)
- **손잡이:** 8×40px 쇠먹 막대, 4px, 반투명 흰 1px 테두리. 녹음 중 주홍, 처리 중 용지색 + 흐린 잉크 테두리.
- **펼친 버튼:** 쇠먹 알약 30px(받아쓰기는 62px로 길고, 기록 열기는 24px로 작다), 반투명 흰 테두리, 2.1 획 14px 아이콘. hover는 한 단계 밝은 잉크. 받아쓰기 중 마이크 버튼은 주홍, 회의 녹음 중에는 고리 속 점이 주홍 사각(정지)으로 바뀐다. 펼침은 0.6배에서 1배로 0.2s cubic-bezier(0.16, 1, 0.3, 1).
- **진행 띠:** 34px, 용지색 바탕, 왼쪽에서 clip-path로 0.26s 빠져나온다. 듣기: 8px 주홍 박동점 + 120px 레벨 막대(띠 글자색) + 고정폭 타이머. 처리 중: 네 역 노선, 지금 역은 주홍 + 퍼지는 고리. 완료: 굵은 결과어 + 입력된 문장. 실패: 결과어만 주홍.

## Do's and Don'ts

### Do:
- **Do** 새 본문 구역을 64px 여백에서 시작하고 겹 세로 괘선 위에 놓아라.
- **Do** 구획은 1px 괘선(rule / rule-2)으로, hover와 선택은 fill / fill-2 채움으로 하라.
- **Do** 시각·길이·줄 번호·개수는 SF Mono tabular-nums로 적어라.
- **Do** 주홍은 교정 부호, 녹음·진행 중, 문제·실패에만 칠하라.
- **Do** 새 색상·표면은 라이트 값과 먹지 사본 값을 같은 토큰 이름으로 함께 정의하라.
- **Do** 박동·회전·번짐 애니메이션은 prefers-reduced-motion에서 끄라.
- **Do** 아이콘은 1.5px 획의 인라인 SVG(창 16px, 독 14px 2.1 획)로 그려라.

### Don't:
- **Don't** 카드 그리드, 통계 히어로, 대시보드 타일을 만들지 마라.
- **Don't** 주홍 외의 색상(성공 초록, 정보 파랑 등)을 더하지 마라. 완료·정상 상태는 흐린 잉크로 표시한다.
- **Don't** 메인 창 표면에 그림자를 쓰지 마라.
- **Don't** 버튼에 테두리나 채운 바탕을 기본값으로 주지 마라. 주요 행동은 밑줄로 구분한다.
- **Don't** 문제를 배너나 경고 상자로 띄우지 마라. 정정 사항 한 줄로 끼워 넣어라.
- **Don't** 레벨 표시를 그라데이션·파형 장식으로 꾸미지 마라. 1.5px 수직 막대와 기준선뿐이다.
- **Don't** 시스템 서체를 20px를 넘는 디스플레이 크기로 키우지 마라. 이 세계에는 디스플레이 서체가 없고, 제목은 굵기로 구분한다.
