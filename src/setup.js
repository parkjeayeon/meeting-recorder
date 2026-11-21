// 엔진 설치·삭제 (설정 › 엔진, 처음 설정). 구현은 src/setup (TypeScript, 결정 70) — 이 파일은 Electron·받아쓰기·샌드박스를 이어 주고 예전 이름 그대로 내보낸다.
const { app } = require('electron');
const sandbox = require('./sandbox');
const dictation = require('./dictation');
const { createSetup } = require('../lib/setup/index.mjs');

const { init, status, install, remove } = createSetup({
  userData: () => app.getPath('userData'),
  dictation,
  sandbox,
});

module.exports = { init, status, install, remove };
