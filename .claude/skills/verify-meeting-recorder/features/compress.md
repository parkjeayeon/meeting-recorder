# 녹음 압축

확인을 마친 회의(48kHz WAV)는 재생 막대 아래 한 줄로 압축을 묻는다(모달 아님): 줄어드는 크기와 `압축하기`·`그대로 두기`. 압축하면 메타에 `압축함`, 안내는 사라진다. 그대로 두면 숨기고 `더 보기` 메뉴의 `녹음 압축하기`로 남긴다. 16kHz 녹음은 묻지 않는다.

## Sub-features

- `compress-offer` 안내(크기 `689MB → 약 86MB`, AAC 96kbps).
- `compress-run` 압축하기 → 본체 압축 → `녹음 86MB · 압축함`.
- `compress-decline` 그대로 두기 → 숨김, 메뉴에 남음.
- `compress-home` 홈 녹음 공간·챙길 일의 압축할 수 있는 녹음.

## How to get to it (user POV)

- 확인을 마친 회의의 회의 화면.
- 홈 `챙길 일`의 `압축할 수 있는 녹음` → 그 회의.
- 회의 화면 `더 보기` → `녹음 압축하기`.

## Driving it with drive.js

Preconditions:

- `"noMeeting": true, "env": { "STUB_MANY": "2" }` — 지어낸 첫 회의 `주간 회의 1차`가 확정·689MB WAV.

- **안내.** `{ "go": "#meetings" }`, `{ "click": "주간 회의 1차", "role": "link" }` → `확인을 마쳤으니 녹음을 압축할까요?`, `689MB → 약 86MB`.
- **압축.** `{ "click": "압축하기", "role": "button", "wait": 800 }` → `{ "expect": { "called": "compressMeeting" } }`, `압축함`이 보이고 안내가 없음.
- **증거.** 흐름 `journeys/compress.json`.

## Gotchas

- 예시 회의(기본)는 확인을 마치지 않아 안내가 없다. 지어낸 회의를 쓴다.
- 실제 변환(afconvert·길이 확인·WAV 지우기·끊긴 뒤 정리)은 `compress-check.js`로.
