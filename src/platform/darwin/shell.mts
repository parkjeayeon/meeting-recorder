// macOS: 본체(src/main.js)가 `process.platform === 'darwin'`으로 가르던 Electron 일 — 하느냐 마느냐만 여기 둔다 (결정 78).
// Electron 호출(app.hide·app.dock·systemPreferences·BrowserWindow 옵션)은 main.js에 그대로 있다.
import type { Shell } from '../types.mjs';

export const shell: Shell = {
  selftestSound: ['afplay', ['/System/Library/Sounds/Submarine.aiff']],
  hideAppBeforeRepaste: true,
  // 앱을 깨우지 않는 패널(NSPanel). 일반 창이면 막대를 마우스로 누를 때 앱 전체가 활성화되며 메인 창까지 올라온다
  overlayWindow: { type: 'panel' },
  devDockIcon: true,
  askMicAtLaunch: true,
  micAccessFromSystem: true,
};
