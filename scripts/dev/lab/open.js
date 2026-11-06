// 실험 페이지를 창으로 띄운다 (앱과 상관없이). npx electron scripts/dev/lab/open.js [meetings] [?v=ledger&n=160]
//   SHOT=폴더 를 주면 창을 띄우지 않고 세 보기 × 라이트·다크를 캡처해 저장한다
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

app.setName(`mr-lab-${process.pid}`);
const page = path.join(__dirname, `${process.argv[2] ?? 'meetings'}.html`);
const shot = process.env.SHOT;

app.whenReady().then(async () => {
  if (!shot) {
    const w = new BrowserWindow({ width: 1320, height: 880, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 }, backgroundColor: '#eceef1' });
    await w.loadFile(page, { search: (process.argv[3] ?? '').replace(/^\?/, '') });
    return;
  }
  app.dock?.hide();
  fs.mkdirSync(shot, { recursive: true });
  const w = new BrowserWindow({ width: 1320, height: 880, show: false });
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme;
    for (const v of ['ledger', 'mix', 'triage']) {
      await w.loadFile(page, { search: `v=${v}&n=160` });
      await new Promise((r) => setTimeout(r, 700));
      fs.writeFileSync(path.join(shot, `${v}-${theme}.png`), (await w.capturePage()).toPNG());
      if (theme === 'light') {
        await w.webContents.executeJavaScript(`document.getElementById('view').scrollTop = 1800; 0`);
        await new Promise((r) => setTimeout(r, 300));
        fs.writeFileSync(path.join(shot, `${v}-scrolled.png`), (await w.capturePage()).toPNG());
      }
    }
  }
  app.exit(0);
});
