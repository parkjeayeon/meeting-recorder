// 검증 스킬의 흐름(.claude/skills/verify-meeting-recorder/journeys/*.json)을 모두 차례로 돌린다.
//   node scripts/dev/verify/run-all.js [이름 일부]     (npm run verify:journeys, npm run dist가 돌림)
// 흐름마다 drive.js를 새 Electron으로 띄운다. 통과한 흐름의 증거는 남기지 않고, 실패한 흐름만 verify-runs/에 남긴다.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const dir = path.join(ROOT, '.claude/skills/verify-meeting-recorder/journeys');
const only = process.argv[2];
const electron = require(path.join(ROOT, 'node_modules/electron'));
let fail = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && (!only || x.includes(only))).sort()) {
  const r = spawnSync(electron, [path.join(__dirname, 'drive.js'), path.join(dir, f), '--drop-on-pass'], { cwd: ROOT, encoding: 'utf8', timeout: 200000 });
  const out = `${r.stdout ?? ''}`.split('\n').filter((l) => /^✗|^통과|^실패|^화면 오류/.test(l));
  const ok = r.status === 0;
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${f.replace('.json', '')}${ok ? '' : `\n    ${out.join('\n    ')}${r.error ? `\n    ${r.error.message}` : ''}`}`);
}
console.log(fail ? `흐름 검증 실패 ${fail}건` : '흐름 검증 통과');
process.exit(fail ? 1 : 0);
