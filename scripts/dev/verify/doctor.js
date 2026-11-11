// 검증 전 점검 (읽기만 한다): 이 체크아웃으로 검증 조작 도구를 돌릴 만한가.
//   node scripts/dev/verify/doctor.js        → 항목별 ✓/✗ 와 끝 코드(문제 있으면 1)
// 보는 것: Electron 실행 파일, 코어 빌드(lib/)가 src/core보다 새로운지, 가짜 API가 preload의 함수를 다 덮는지,
// 화면 파일, 증거 폴더 쓰기, 그리고 설치된 앱이 켜져 있는지(켜져 있어도 검증은 따로 돈다 — 실제 데이터를 건드리지 않는다는 확인용).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../../..');
const rows = [];
const row = (name, ok, detail = '') => rows.push([name, ok, detail]);
const newest = (dir, ext) => {
  let t = 0;
  for (const f of fs.readdirSync(dir, { recursive: true })) if (String(f).endsWith(ext)) t = Math.max(t, fs.statSync(path.join(dir, String(f))).mtimeMs);
  return t;
};

let electron = null;
try { electron = require(path.join(ROOT, 'node_modules/electron')); } catch {}
row('Electron', Boolean(electron && fs.existsSync(electron)), electron ?? 'npm install 필요');
const core = path.join(ROOT, 'lib/core/index.mjs');
const built = fs.existsSync(core) ? newest(path.join(ROOT, 'lib/core'), '.mjs') : 0;
const src = newest(path.join(ROOT, 'src/core'), '.mts');
row('코어 빌드(lib/)가 최신', built >= src, built ? (built >= src ? '' : 'src/core가 더 새로움 → npm run build:ts') : '없음 → npm run build:ts');
const preloadKeys = [...fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8').matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
row('가짜 API가 preload 함수를 모두 가짐', preloadKeys.length > 50, `${preloadKeys.length}개 (stub-preload.js가 이름을 그대로 읽어 만든다)`);
row('화면 파일', fs.existsSync(path.join(ROOT, 'src/renderer/index.html')), 'src/renderer/index.html');
// 화면은 Vite로 묶은 lib/renderer/main.js를 불러온다 — 없거나 원본보다 오래됐으면 옛 화면으로 시험하게 된다
const bundle = path.join(ROOT, 'lib/renderer/main.js');
const bundled = fs.existsSync(bundle) ? fs.statSync(bundle).mtimeMs : 0;
const rsrc = Math.max(newest(path.join(ROOT, 'src/renderer'), '.js'), newest(path.join(ROOT, 'src/renderer'), '.ts'), newest(path.join(ROOT, 'src/renderer'), '.tsx'), newest(path.join(ROOT, 'src/renderer'), '.css'), src);
row('화면 묶음(lib/renderer)이 최신', bundled >= rsrc, bundled ? (bundled >= rsrc ? '' : '원본이 더 새로움 → npm run build:renderer') : '없음 → npm run build:renderer');
try {
  fs.mkdirSync(path.join(ROOT, 'verify-runs'), { recursive: true });
  fs.accessSync(path.join(ROOT, 'verify-runs'), fs.constants.W_OK);
  row('증거 폴더 verify-runs/ 쓰기', true);
} catch (err) { row('증거 폴더 verify-runs/ 쓰기', false, err.message); }
let running = false;
try { running = execFileSync('/usr/bin/pgrep', ['-f', '/Applications/Meeting Recorder.app/Contents/MacOS/Meeting Recorder'], { encoding: 'utf8' }).trim().length > 0; } catch {}
row('설치된 앱', true, running ? '켜져 있음 — 검증 도구는 다른 앱 이름·임시 폴더로 따로 돈다. 설치된 앱을 끄거나 조작하지 말 것' : '꺼져 있음');
let rev = '';
try { rev = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const dirty = (() => { try { return execFileSync('git', ['-C', ROOT, 'status', '--porcelain', 'src'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length; } catch { return 0; } })();
row('코드 판', true, `${rev}${dirty ? ` + src 변경 ${dirty}개` : ''}`);

let bad = 0;
for (const [name, ok, detail] of rows) {
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(bad ? `점검 실패 ${bad}건` : '점검 통과');
process.exit(bad ? 1 : 0);
