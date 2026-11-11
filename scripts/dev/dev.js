// 개발 실행: 화면을 지켜보며 다시 묶고(vite build --watch, 개발 모드), 첫 빌드가 끝나면 앱을 띄운다.
//   npm run dev
// 화면을 고치면 다시 묶이고, 창에서 ⌘R(보기 › 새로 고침)로 반영한다 — 자동으로 새로 고치지 않는다(녹음 중일 수 있다).
// 앱을 끄면 지켜보기도 끝난다. 개발 서버(HMR)는 쓰지 않는다: 앱·시험·설치본이 같은 문서·같은 경로를 쓰게 (결정 61).
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const vite = spawn(process.execPath, [require.resolve('vite/bin/vite.js'), 'build', '-c', 'vite.renderer.config.mts', '--watch', '--mode', 'development'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
let app = null;
vite.stdout.on('data', (b) => {
  process.stdout.write(b);
  if (!app && /built in|watching for file changes/i.test(String(b))) {
    app = spawn(require(path.join(ROOT, 'node_modules/electron')), ['.'], { cwd: ROOT, stdio: 'inherit' });
    app.on('exit', (code) => {
      vite.kill();
      process.exit(code ?? 0);
    });
  }
});
vite.on('exit', (code) => {
  if (!app) process.exit(code ?? 1);
});
