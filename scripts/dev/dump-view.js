// 화면 하나의 #view HTML을 찍는다 — React로 옮긴 화면이 옛 화면과 같은 마크업인지 main과 비교할 때 (docs/testing.md).
//   [ROOT=다른 작업 폴더] [STUB_…=…] [DUMP_JS='…'] npx electron scripts/dev/dump-view.js '#home' /tmp/home.html
// DUMP_JS: 화면을 연 뒤 찍기 전에 돌릴 코드 (원문 펼치기·검색 등 누른 뒤의 모습). 돌린 뒤 0.8초 기다린다
// DUMP_SEL: 찍을 곳 (기본 #view). 질문 창·둥근 버튼은 '.ask-root'
// DUMP_MEETING=1: 예시 회의(verify/fixture, 흐름도·액션 포함)를 임시 폴더에 만들어 쓴다. 주소의 {id}가 그 회의 id (끝나면 지움)
// 가짜 API(stub-preload)로 띄우고, 태그마다 줄을 나눠 저장한다. ROOT를 주면 그 폴더의 화면 묶음·가짜 API로 (main을 꺼낸 작업 폴더 등)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.ROOT ?? path.join(__dirname, '../..'));
const [hashArg, out] = process.argv.slice(-2);
let meetingDir = null;
if (process.env.DUMP_MEETING) {
  meetingDir = require(path.join(root, 'scripts/dev/verify/fixture.js')).makeMeeting('mr-dump-', { flowAndActions: true });
  process.env.STUB_MEETING_DIR = meetingDir;
}
const hash = hashArg.replaceAll('{id}', meetingDir ? path.basename(meetingDir) : '');
const cleanup = () => meetingDir && fs.rmSync(path.dirname(meetingDir), { recursive: true, force: true });
app.setName(`mr-dump-${process.pid}`); // 설치된 앱과 단일 실행 잠금이 겹치지 않게
app.dock?.hide();
setTimeout(() => process.exit(1), 60000);
app.whenReady().then(async () => {
  try {
    const w = new BrowserWindow({ width: 1240, height: 820, show: false, webPreferences: { preload: path.join(root, 'scripts/dev/stub-preload.js'), sandbox: false } });
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
