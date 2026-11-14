// 확인 마치기를 비교용 사본에서 다시 돌려 본다 — 확인 마치기 지시문(FINALIZE_SYSTEM)을 바꿨을 때 실제 회의로 결과를 본다.
//   npx electron scripts/dev/try-finalize.js <비교용 회의 폴더>
// 원래 회의를 덮어쓰지 않도록 '.comparison-copy' 표시가 있는 폴더(글 파일만 복사하고 minutes.md를 확인 마치기 전으로 되돌린 것)에만 쓴다.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dir = path.resolve(process.argv.at(-1));
app.setPath('userData', path.join(app.getPath('appData'), 'meeting-recorder')); // 설정·계정을 앱과 같이 (읽기만)
app.dock?.hide();

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(path.join(dir, '.comparison-copy'))) throw new Error('비교용 표시(.comparison-copy)가 없는 폴더입니다 — 원래 회의일 수 있어 쓰지 않습니다');
    const minutes = require('../../src/minutes');
    const t = Date.now();
    const r = await minutes.finalizeReview(dir);
    console.log(`마침 · 다시 씀 ${r.finalize.rewritten} · ${r.finalize.provider} · ${((Date.now() - t) / 1000).toFixed(0)}초 · 회의록 ${fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8').length}자`);
  } catch (err) {
    console.error('마치지 못함:', err.message);
  }
  app.quit();
});
