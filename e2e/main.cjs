// Playwright 시험용 진입점 — 본체(src/main.js) 없이 가짜 API(scripts/dev/stub-preload.js)로 메인 창 하나만 띄운다.
// 설정·기록은 E2E_USER_DATA(시험마다 새 임시 폴더)에만 남아 실제 앱 데이터는 건드리지 않는다. 회의 폴더 등은 STUB_* 환경 변수로.
// E2E_WIDTH·E2E_HEIGHT: 창 크기(기본 1240×860) · E2E_DARK=1: 어두운 모양
const { app, BrowserWindow, nativeTheme } = require('electron');
const path = require('path');

app.setName(`mr-e2e-${process.pid}`);
app.setPath('userData', process.env.E2E_USER_DATA);
nativeTheme.themeSource = process.env.E2E_DARK ? 'dark' : 'light';
app.dock?.hide();

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: Number(process.env.E2E_WIDTH) || 1240, height: Number(process.env.E2E_HEIGHT) || 860, show: false, webPreferences: { preload: path.join(__dirname, '../scripts/dev/stub-preload.js'), sandbox: false } });
  await w.loadFile(path.join(__dirname, '../src/renderer/index.html'));
});
