// 샌드박스 확인: src/sandbox.js 프로필이 쓰기·네트워크를 실제로 막는지 본다. 결과만 출력하고 아무것도 남기지 않는다.
//   node scripts/dev/sandbox-check.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { profile } = require('../../src/sandbox');

const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-sbcheck-app-'));
const outside = path.join(os.homedir(), 'Documents', `.mr-sandbox-check-${process.pid}`);
const run = (label, opts, cmd, args, expectOk) => {
  let ok;
  try {
    execFileSync('/usr/bin/sandbox-exec', ['-p', profile(opts), cmd, ...args], { stdio: 'pipe', timeout: 20000 });
    ok = true;
  } catch {
    ok = false;
  }
  console.log(`${ok === expectOk ? 'PASS' : 'FAIL'}  ${label}: ${ok ? '허용됨' : '막힘'} (기대: ${expectOk ? '허용' : '막힘'})`);
  return ok === expectOk;
};
const results = [
  run('지정하지 않은 폴더(~/Documents)에 쓰기', { write: [appDir] }, '/bin/sh', ['-c', `echo x > "${outside}"`], false),
  run('지정한 앱 폴더에 쓰기', { write: [appDir] }, '/bin/sh', ['-c', `echo x > "${appDir}/t"`], true),
  run('임시 폴더에 쓰기', { write: [] }, '/bin/sh', ['-c', `echo x > "${os.tmpdir()}/mr-sb-${process.pid}"`], true),
  run('네트워크 차단 상태에서 외부 접속', { network: 'none' }, '/usr/bin/curl', ['-sS', '-m', '8', '-o', '/dev/null', 'https://huggingface.co'], false),
  run('네트워크 허용 상태에서 외부 접속', { network: 'all' }, '/usr/bin/curl', ['-sS', '-m', '8', '-o', '/dev/null', 'https://huggingface.co'], true),
];
fs.rmSync(appDir, { recursive: true, force: true });
fs.rmSync(outside, { force: true });
fs.rmSync(path.join(os.tmpdir(), `mr-sb-${process.pid}`), { force: true });
process.exit(results.every(Boolean) ? 0 : 1);
