// 떠 있는 막대 시험: 언어 버튼이 지금 언어를 보이고 누를 때마다 한국어 → English → 日本語 → 자동으로 바뀌는지, 툴팁, 버튼이 막대 창 안에 다 들어가는지.
//   npx electron scripts/dev/overlay-check.js     (npm run dist가 빌드 전에 돌린다)
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.setName(`mr-overlay-check-${process.pid}`);
app.dock?.hide();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  console.error('막대 시험 시간 초과');
  process.exit(1);
}, 30000);

app.whenReady().then(async () => {
  const mainSrc = require('fs').readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const height = Number(/const OVERLAY_SIZE = \{ width: \d+, height: (\d+) \}/.exec(mainSrc)?.[1]);
  const w = new BrowserWindow({ width: 320, height, show: false, webPreferences: { preload: path.join(__dirname, 'overlay-stub-preload.js'), sandbox: false } });
  await w.loadFile(path.join(__dirname, '../../src/overlay/index.html'));
  await wait(300);
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`document.getElementById('dock').classList.add('open')`);
  await wait(300);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(await js(`document.getElementById('langCode').textContent`));
    await js(`document.querySelector('.btn.lang').click()`);
    await wait(60);
  }
  await js(`document.querySelector('.btn.lang').dispatchEvent(new MouseEvent('mouseenter'))`);
  await wait(200);
  const tip = await js(`document.getElementById('tip').textContent`);
  const [top, bottom] = await js(`(() => { const r = document.querySelector('.buttons').getBoundingClientRect(); return [r.top, r.bottom]; })()`);
  const results = [
    ['언어 버튼이 지금 언어를 보이고 누르면 바뀜', JSON.stringify(seen) === '["KO","EN","JA","자동","KO"]', JSON.stringify(seen)],
    ['언어 툴팁', tip.startsWith('받아쓰기 언어 · English'), JSON.stringify(tip)],
    ['버튼이 막대 창 안에', top >= 0 && bottom <= height, `${Math.round(top)}~${Math.round(bottom)} / 창 높이 ${height}`],
  ];
  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  }
  console.log(failed ? `막대 시험 실패 ${failed}건` : `막대 시험 통과 (${results.length}건)`);
  app.exit(failed ? 1 : 0);
});
