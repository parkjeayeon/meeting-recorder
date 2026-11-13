// .app을 묶고 서명한다. 이름 뒤에 버전과 빌드 시각을 붙여 어떤 빌드가 깔렸는지 Finder·Dock·메뉴에서 바로 보이게 한다.
//   node scripts/build-app.mjs            → dist/mac-arm64/Meeting Recorder 0.1.0 (11.13 1020).app
//   INSTALL=1 node scripts/build-app.mjs  → 위에 더해 (npm run install-app) /Applications의 예전 Meeting Recorder*.app을 지우고 복사
// macOS 파일 이름에는 ':'를 못 쓰므로 시각은 1020처럼 붙인다. 앱 id(local.meetingrecorder)와 데이터 폴더(meeting-recorder)는 그대로라
// 이름이 바뀌어도 권한·설정은 같은 앱으로 이어진다.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const name = `Meeting Recorder ${version} (${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())})`;
const out = path.join(root, 'dist/mac-arm64');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

for (const f of fs.existsSync(out) ? fs.readdirSync(out) : []) if (/^Meeting Recorder.*\.app$/.test(f)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
run('npx', ['electron-builder', '--mac', 'dir', `-c.productName=${name}`]);
const app = path.join(out, `${name}.app`);
run('sh', ['scripts/sign-app.sh', app]);
console.log(`만듦: ${app}`);

if (process.env.INSTALL) {
  for (const f of fs.readdirSync('/Applications')) if (/^Meeting Recorder.*\.app$/.test(f)) fs.rmSync(path.join('/Applications', f), { recursive: true, force: true });
  run('cp', ['-R', app, '/Applications/']);
  console.log(`설치함: /Applications/${name}.app`);
}
