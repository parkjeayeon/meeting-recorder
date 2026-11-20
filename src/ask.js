// 질문으로 회의 찾기 (결정 51). 구현은 src/ask (TypeScript, 결정 70) — 이 파일은 Electron·본체 모듈을 이어 주고 예전 이름 그대로 내보낸다.
// 시험(scripts/dev/ask-engine-check.js)은 cleanup.js의 complete를 바꿔 끼우고 dictation.js를 가짜로 둔 뒤 이 파일을 불러오므로,
// 예전처럼 불러올 때의 complete와 dictation을 넘기고, 불러올 때마다 엔진(질문 목록·색인 연결)을 새로 만든다.
const { app } = require('electron');
const { complete } = require('./cleanup');
const dictation = require('./dictation');
const { createAsk } = require('../lib/ask/index.mjs');

const { init, start, list, stop, remove, seen } = createAsk({
  userData: () => app.getPath('userData'),
  complete,
  apiKey: () => dictation.apiKey(),
});

module.exports = { init, start, list, stop, remove, seen };
