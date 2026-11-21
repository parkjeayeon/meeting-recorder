// 본체(메인 프로세스) 진입점. 본문은 src/app (TypeScript, 결정 70) — 여기서는 Electron과 CommonJS 연결 파일을 불러 start()에 넘긴다.
// 연결 파일을 여기서 require하는 까닭: scripts/dev 시험이 그것들을 require·require.cache로 바꿔 끼운다(ESM 내보내기는 못 바꾼다).
// 진입점을 CommonJS로 두는 까닭: require(esm)은 동기라 불러올 때 하던 일(Chromium 스위치·IPC 처리기·rec:// 등록·whenReady)이
// 예전과 같은 때에 끝난다. 불러오는 차례(dictation → minutes → usage → ask → compress → setup)도 예전 그대로다.
const electron = require('electron');
const dictation = require('./dictation');
const minutes = require('./minutes');
const usage = require('./usage');
const ask = require('./ask');
const compress = require('./compress');
const setup = require('./setup');

require('../lib/app/main.mjs').start({
  electron,
  dictation,
  minutes,
  usage,
  ask,
  compress,
  setup,
  srcDir: __dirname,
  anthropic: () => require('@anthropic-ai/sdk').default,
});
