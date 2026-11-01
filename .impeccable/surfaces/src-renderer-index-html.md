---
version: 1
slug: "src-renderer-index-html"
primary_target: "src/renderer/index.html"
related_targets: ["src/overlay/index.html"]
---

# Surface: 메인 창 + 플로팅 독 (Operate)

범위: src/renderer (기록 · 회의 · 설정 창), src/overlay (화면 왼쪽 플로팅 독과 받아쓰기 진행 표시).
사용자: 한국어 지식 노동자. 창은 가끔 연다(기록 확인, 설정, 권한). 핵심 경험은 fn + 플로팅 독.
과제: 방금 받아쓴 글 확인·복사·다시 입력, 다듬기가 무엇을 고쳤는지 보기, 권한·엔진·다듬기 계정 상태 파악, 회의 녹음 찾기.
제약: macOS Electron, 시스템 한글 서체, 다른 앱 위의 독은 포커스를 뺏지 않는다. 회의 전사 기능은 아직 없다(만들어진 척 금지).

## Direction contract

THESIS: 이 앱의 산출물은 속기록이다. 창은 설정 화면이 아니라 법원 속기록 한 장처럼 읽힌다: 줄 번호, 시각, 발언, 교정 부호. 카드 그리드·통계 히어로·대시보드 타일을 거부한다.

OWN-WORLD: 차가운 흰 기록 용지(#fbfcfd), 쇠먹 검정 잉크, 왼쪽 여백의 겹 세로 괘선과 줄 번호, 1px 청회색 가로 괘선. 색은 교정용 주홍 하나뿐이며 교정 부호(지운 군말 취소선, 고친 말)와 "지금 녹음 중" 상태만 칠한다. 시각·길이·줄 번호는 고정폭 숫자(데이터). 버튼은 테두리 없는 잉크 글자, 선택은 괘선 사이를 채운 연한 잉크.

STORY: 창을 열면 오늘 받아쓴 기록이 최신순으로 줄 번호와 함께 보이고, 각 줄에서 다듬기가 지운 말과 고친 말이 교정 부호로 드러난다. 한 번에 복사/다시 입력. 권한이나 엔진에 문제가 있으면 기록 맨 위에 "정정 사항"처럼 한 줄로 끼어든다.

FIRST VIEWPORT: 왼쪽 152px 여백 = 앱 이름, 세 개의 목차(기록·회의·설정)와 엔진/다듬기 상태 두 줄. 본문 = 상단 한 줄 상태 띠(대기/녹음 중 + 타이머 + 레벨 괘선), 그 아래 줄 번호 붙은 기록 목록. 주요 행동(복사)은 각 기록 줄 오른쪽 끝.

FORM: 속기록(재판 기록 용지), 내 목록 6번, seed 9d37f81f. 라이즈: [Metro 타일에서] 주홍 하나가 모든 살아있는 상태를 소유한다. [Transit 다이어그램에서] 받아쓰기 파이프라인을 역(듣기→인식→다듬기→입력)이 찍힌 한 줄 노선으로 독에 그린다. [Ikeda에서] 레벨은 장식 없는 수직 괘선 막대로만 그린다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
