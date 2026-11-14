// 실제 본체 없이 overlay-check.js와 같은 숨긴 막대 창만 띄운다.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setName(`mr-e2e-overlay-${process.pid}`);
app.setPath('userData', process.env.E2E_USER_DATA);
app.dock?.hide();

app.whenReady().then(async () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const size = /const OVERLAY_SIZE = \{ width: (\d+), height: (\d+) \}/.exec(mainSrc);
  if (!size) throw new Error('src/main.js의 OVERLAY_SIZE를 찾지 못했습니다');
  const w = new BrowserWindow({
    width: Number(size[1]), height: Number(size[2]), show: false,
    webPreferences: { preload: path.join(__dirname, '../../scripts/dev/overlay-stub-preload.js'), sandbox: false },
  });
  await w.loadFile(path.join(__dirname, '../../src/overlay/index.html'));
});
