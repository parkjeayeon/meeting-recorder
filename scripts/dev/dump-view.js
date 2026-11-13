// 화면 하나의 #view HTML을 찍는다 — React로 옮긴 화면이 옛 화면과 같은 마크업인지 main과 비교할 때 (docs/testing.md).
//   [ROOT=다른 작업 폴더] [STUB_…=…] [DUMP_JS='…'] npx electron scripts/dev/dump-view.js '#home' /tmp/home.html
// DUMP_JS: 화면을 연 뒤 찍기 전에 돌릴 코드 (원문 펼치기·검색 등 누른 뒤의 모습). 돌린 뒤 0.8초 기다린다
// DUMP_SEL: 찍을 곳 (기본 #view). 질문 창·둥근 버튼은 '.ask-root'
// DUMP_NO_REVIEW=1: 예시 회의에서 review.json을 뺀다 ('정리하기' 상태) · DUMP_FLOW=<flow.json>: 예시 회의의 흐름도를 이 파일로 · W·H: 창 크기 (기본 1240×820, 좁히면 흐름도가 접힌다)
// DUMP_NO_MIC=1: 마이크 권한 거절 (처음 설정 마이크 단계를 소리와 상관없이 같게)
// DUMP_MEETING=1: 예시 회의(verify/fixture, 흐름도·액션 포함)를 임시 폴더에 만들어 쓴다(plain이면 흐름도·액션 없이). 주소의 {id}가 그 회의 id (끝나면 지움)
// 가짜 API(stub-preload)로 띄우고, 태그마다 줄을 나눠 저장한다. ROOT를 주면 그 폴더의 화면 묶음·가짜 API로 (main을 꺼낸 작업 폴더 등)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.ROOT ?? path.join(__dirname, '../..'));
// 기준 폴더가 없거나(재시작하면 /tmp가 비워진다) 파일을 못 찾으면 Electron이 화면에 에러 창을 띄운다 — 창 없이 이유만 찍고 끝낸다
process.on('uncaughtException', (e) => {
  console.error('찍지 못함:', e.message);
  process.exit(1);
});
if (!fs.existsSync(path.join(root, 'scripts/dev/stub-preload.js'))) {
  console.error(`찍지 못함: 기준 폴더가 없습니다 (${root})`);
  process.exit(1);
}
const [hashArg, out] = process.argv.slice(-2);
let meetingDir = null;
if (process.env.DUMP_MEETING) {
  meetingDir = require(path.join(root, 'scripts/dev/verify/fixture.js')).makeMeeting('mr-dump-', { flowAndActions: process.env.DUMP_MEETING !== 'plain' });
  if (process.env.DUMP_FLOW) fs.copyFileSync(process.env.DUMP_FLOW, path.join(meetingDir, 'flow.json'));
  if (process.env.DUMP_NO_REVIEW) fs.rmSync(path.join(meetingDir, 'review.json')); // 확인 필요를 아직 항목으로 나누지 않은 회의록
  process.env.STUB_MEETING_DIR = meetingDir;
}
const hash = hashArg.replaceAll('{id}', meetingDir ? path.basename(meetingDir) : '');
const cleanup = () => meetingDir && fs.rmSync(path.dirname(meetingDir), { recursive: true, force: true });
app.setName(`mr-dump-${process.pid}`); // 설치된 앱과 단일 실행 잠금이 겹치지 않게
app.dock?.hide();
setTimeout(() => process.exit(1), 60000);
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ width: +(process.env.W || 1240), height: +(process.env.H || 820), show: false, webPreferences: { preload: path.join(root, 'scripts/dev/stub-preload.js'), sandbox: false } });
    // DUMP_NO_MIC=1: 마이크 권한을 거절한다 — 처음 설정 마이크 단계가 실제 주변 소리에 따라 갈리지 않게(늘 '쓸 수 없음' 갈래)
    if (process.env.DUMP_NO_MIC) {
      w.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm !== 'media'));
      w.webContents.session.setPermissionCheckHandler((_wc, perm) => perm !== 'media');
    }
    w.webContents.on('console-message', (e) => e.level === 'error' && console.log('CONSOLE', e.message));
    await w.loadFile(path.join(root, 'src/renderer/index.html'));
    await new Promise((r) => setTimeout(r, 1500));
    await w.webContents.executeJavaScript(`location.hash=${JSON.stringify(hash)}; new Promise((r) => setTimeout(r, 600))`);
    if (process.env.DUMP_JS) await w.webContents.executeJavaScript(`(async () => { ${process.env.DUMP_JS} })().then(() => new Promise((r) => setTimeout(r, 800)))`);
    const html = await w.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(process.env.DUMP_SEL ?? '#view')}).innerHTML`);
    fs.writeFileSync(out, html.replace(/></g, '>\n<'));
    cleanup();
    app.exit(0);
  } catch (e) {
    console.error('찍지 못함:', e.message); // DUMP_JS가 던진 오류 등 — 조용히 60초를 기다리지 않게
    cleanup();
    app.exit(1);
  }
});
