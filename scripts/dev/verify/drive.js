// 검증 조작 도구: 가짜 API(stub-preload.js)로 메인 창을 숨긴 채 띄우고(Playwright Electron), 단계 목록(JSON)대로 사용자처럼 조작한 뒤
// 증거(단계별 결과, 화면 접근성 스냅샷·캡처, Playwright trace, 본체로 간 호출 기록, 예시 회의 폴더에서 바뀐 파일)를 verify-runs/<실행 id>/에 남긴다.
//   node scripts/dev/verify/drive.js <단계 파일.json> [--keep]
// 단계 파일: { "env": { "STUB_MANY": "30" }, "steps": [ { "go": "#meeting/{id}" }, { "click": "확인 필요", "role": "tab" }, ... ] }
//   {id}·{dir}은 예시 회의 id·폴더로 바뀐다. 단계 종류는 SKILL.md, 실행은 steps.js(npm run verify:journeys와 같은 코드)
// 실제 녹음 폴더·설정·설치된 앱은 건드리지 않는다: 예시 회의·설정 폴더는 임시 폴더.
// 끝나면 앱을 닫고 예시 회의 폴더를 지운다(--keep이면 남김). 증거는 지우지 않는다. 끝 코드: 모든 expect가 맞고 화면 오류가 없으면 0.
const fs = require('fs');
const path = require('path');
const { launch, runSteps, ARIA, ROOT } = require('./steps');

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.json'));
const keep = args.includes('--keep');
if (!file) {
  console.error('단계 파일(.json)을 주세요: node scripts/dev/verify/drive.js <단계.json>');
  process.exit(2);
}
const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${path.basename(file, '.json')}`;
const out = path.join(ROOT, 'verify-runs', runId);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(file, path.join(out, 'steps.json'));
setTimeout(() => {
  console.error('시간 초과 (3분)');
  process.exit(1);
}, 180000).unref();

(async () => {
  const run = await launch(plan);
  const { page, app, meetingDir, id, consoleErrors } = run;
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  const results = await runSteps(page, plan, { id, meetingDir, out, log: console.log });
  // 증거: 끝 상태의 스냅샷, 호출 기록, 바뀐 예시 회의 파일, trace(npx playwright show-trace)
  fs.writeFileSync(path.join(out, 'end.aria.txt'), await ARIA(page));
  fs.writeFileSync(path.join(out, 'stub-log.json'), JSON.stringify(await page.evaluate(() => window.stubLog()), null, 1));
  await app.context().tracing.stop({ path: path.join(out, 'trace.zip') });
  if (meetingDir) {
    fs.mkdirSync(path.join(out, 'meeting-after'), { recursive: true });
    for (const f of fs.readdirSync(meetingDir)) fs.copyFileSync(path.join(meetingDir, f), path.join(out, 'meeting-after', f));
  }
  const failed = results.filter((r) => !r.ok).length;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ runId, file, meetingDir, kept: keep, consoleErrors, failed, results }, null, 1));
  await run.close({ keep });
  if (consoleErrors.length) console.log(`화면 오류 ${consoleErrors.length}건: ${consoleErrors.slice(0, 2).join(' | ')}`);
  console.log(`${failed || consoleErrors.length ? '실패' : '통과'} · 증거: ${path.relative(ROOT, out)}/`);
  process.exit(failed || consoleErrors.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
