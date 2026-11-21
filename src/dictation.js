// 받아쓰기: fn 꾹 누르기로 녹음한 음성 → 로컬 Whisper → (선택) 다듬기 → 커서 위치에 붙여 넣기
// 구현은 src/dictation (TypeScript, 결정 70) — 이 파일은 Electron·본체 모듈을 이어 주고 예전 이름 19개를 그대로 내보낸다.
// 불러올 때 한 번 만든다(whisper-server 자리 정하기·끝날 때 서버 내리기도 그때 한 번). 다듬기 함수는 scripts/dev 시험이
// cleanup.js 객체의 것을 바꿔 끼우므로 부를 때 그 객체에서 찾는다. 내보내는 것은 바꿀 수 있는 보통 객체다.
const { app, clipboard, ClipboardItem, safeStorage } = require('electron');
const cleanupText = require('./cleanup');
const sandbox = require('./sandbox');
const { createDictation } = require('../lib/dictation/index.mjs');

module.exports = {
  ...createDictation({
    userData: () => app.getPath('userData'),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (encrypted) => safeStorage.decryptString(encrypted),
    clipboard,
    ClipboardItem,
    sandboxWrap: (...args) => sandbox.wrap(...args),
    cleanup: (...args) => cleanupText.cleanup(...args),
    providerStatus: (...args) => cleanupText.providerStatus(...args),
  }),
};
