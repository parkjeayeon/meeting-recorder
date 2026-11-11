// 검증이 남긴 임시 예시 회의 폴더를 지운다 (증거 verify-runs/는 그대로 둔다).
//   node scripts/dev/verify/cleanup.js            → drive.js 실행 기록(result.json)에 적힌 예시 회의 폴더 중 남은 것
//   node scripts/dev/verify/cleanup.js --runs     → 증거까지 지운다 (다 본 뒤에만)
// 이름으로 찾아 지우지 않는다: 실행 기록에 적힌 경로만, 그것도 임시 폴더 안의 mr-verify-* 만.
const fs = require('fs');
const os = require('os');
const path = require('path');

const runs = path.join(__dirname, '../../../verify-runs');
const tmp = fs.realpathSync(os.tmpdir());
let removed = 0;
for (const r of fs.existsSync(runs) ? fs.readdirSync(runs) : []) {
  const res = path.join(runs, r, 'result.json');
  if (!fs.existsSync(res)) continue;
  const dir = JSON.parse(fs.readFileSync(res, 'utf8')).meetingDir;
  if (!dir) continue;
  const root = path.dirname(dir);
  const real = fs.existsSync(root) ? fs.realpathSync(root) : null;
  if (real && real.startsWith(tmp) && path.basename(real).startsWith('mr-verify-')) {
    fs.rmSync(real, { recursive: true, force: true });
    removed++;
  }
}
if (process.argv.includes('--runs') && fs.existsSync(runs)) fs.rmSync(runs, { recursive: true, force: true });
console.log(`예시 회의 폴더 ${removed}개 지움${process.argv.includes('--runs') ? ' · 증거 verify-runs/ 지움' : ' · 증거는 verify-runs/에 그대로'}`);
