// .app을 묶고 서명한다. 이름은 늘 Meeting Recorder.app — 설치는 같은 자리의 앱을 갈아끼운다 (사용자 결정, 2026-11-14).
//   node scripts/build-app.mjs            → dist/mac-arm64/Meeting Recorder.app
//   INSTALL=1 node scripts/build-app.mjs  → 위에 더해 (npm run install-app) /Applications의 Meeting Recorder*.app(예전 버전 붙은 이름 포함)을 지우고 복사
// 앱 id(local.meetingrecorder)와 데이터 폴더(meeting-recorder)는 그대로라 설정은 같은 앱으로 이어진다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const name = 'Meeting Recorder';
const out = path.join(root, 'dist/mac-arm64');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

for (const f of fs.existsSync(out) ? fs.readdirSync(out) : []) if (/^Meeting Recorder.*\.app$/.test(f)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
run('npx', ['electron-builder', '--mac', 'dir']);
const app = path.join(out, `${name}.app`);
run('sh', ['scripts/sign-app.sh', app]);
console.log(`만듦: ${app}`);

if (process.env.INSTALL) {
  for (const f of fs.readdirSync('/Applications')) if (/^Meeting Recorder.*\.app$/.test(f)) fs.rmSync(path.join('/Applications', f), { recursive: true, force: true });
  run('cp', ['-R', app, '/Applications/']);
  console.log(`설치함: /Applications/${name}.app`);
}
