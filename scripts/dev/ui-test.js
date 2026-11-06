// 화면 테스트: 입력칸마다 실제 키 입력(영어 a·b + Backspace)을 보내 값이 'a'가 되는지, 오류 알림 글자가 배경과 구분되는지,
// 오래 걸리는 작업이 탭을 옮겨도 진행 중으로 보이고 한 번만 도는지.
//   npx electron scripts/dev/ui-test.js     (npm run dist가 빌드 전에 돌린다)
// 가짜 데이터(stub-preload.js)로 메인 창을 숨긴 채 띄운다. 실제 기록·설정·녹음은 건드리지 않는다.
// 왜: 키 처리기가 값을 돌려주면(`onkeydown = (e) => 조건 && 동작`) 영어·Backspace가 막히고 한글만 써지는 버그를 두 번 겪었다.
//     JS로 value를 넣는 시험은 이 버그를 못 잡으므로 sendInputEvent로 진짜 키를 보낸다.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setName(`mr-ui-test-${process.pid}`); // 설치된 앱과 단일 실행 잠금이 겹치지 않게
nativeTheme.themeSource = process.env.DARK ? 'dark' : 'light';
app.dock?.hide();

// 예시 회의 (실제 회의 내용 대신)
const meeting = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ui-')) + '/2026-11-01_23-00-00_meeting';
fs.mkdirSync(meeting, { recursive: true });
const lines = ['[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?', '[00:06] [화자 2] 네, 화요일 오전이 좋을 것 같아요.', '[00:15] [화자 2] 랩캐시도 쪽 확인만 하면 됩니다.'];
fs.writeFileSync(path.join(meeting, 'transcript.txt'), `${lines.join('\n')}\n`);
fs.writeFileSync(path.join(meeting, 'script-clean.txt'), `${lines.join('\n')}\n`);
fs.writeFileSync(path.join(meeting, 'minutes.md'), '# 예시 회의\n\n## 요약\n배포 일정을 정리함.\n\n## 할 일\n- [ ] QA 마치기 — 담당: 화자 2\n\n## 확인 필요\n- "랩캐시도"(00:15)\n');
fs.writeFileSync(path.join(meeting, 'review.json'), JSON.stringify({ items: [
  { id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '오인식', status: 'open' },
  { id: 'r2', kind: 'word', at: '00:06', heard: '화요일', applied: '수요일', count: 1, note: '요일', status: 'applied', undo: { 'transcript.txt': { changed: [], inserted: [] } } },
] }));
process.env.STUB_MEETING_DIR = meeting;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  console.error('화면 테스트 시간 초과');
  process.exit(1);
}, 90000);

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1240, height: 860, show: false, webPreferences: { preload: path.join(__dirname, 'stub-preload.js'), sandbox: false } });
  const errors = [];
  w.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message));
  await w.loadFile(path.join(__dirname, '../../src/renderer/index.html'));
  await wait(1500);
  const js = (c) => w.webContents.executeJavaScript(c);
  const id = path.basename(meeting);
  const key = (k, char) => {
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
    if (char) w.webContents.sendInputEvent({ type: 'char', keyCode: char });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
  };

  // [이름, 화면 준비(JS), 입력칸 선택자]
  const cases = [
    ['회의 목록 검색', "location.hash='#meetings'", '.page-head input'],
    ['사전 단어 추가', "location.hash='#dictionary'", '.add-row input'],
    ['명령 팔레트(⌘K)', "location.hash='#home'; document.getElementById('openPalette').click()", '#paletteInput'],
    ['가져오기 메모', "document.querySelector('#palette')?.close?.(); location.hash='#meetings'; setTimeout(()=>[...document.querySelectorAll('.page-head .btn')].find(b=>b.textContent.includes('파일 가져오기'))?.click(), 200)", '#importNotes'],
    ['흐름도 그릴 흐름', `document.getElementById('importSheet')?.close(); location.hash='#meeting/${id}'`, '.flow-focus'],
    ['본문 찾기(⌘F)', "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',metaKey:true,bubbles:true}))", '.find-bar input'],
    ['확인 필요 고칠 말', "document.querySelector('.find-bar input')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); [...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith('확인 필요'))?.click()", '.ritem-fix input'],
    ['확인 필요 채팅', "[...document.querySelectorAll('.ritem button')].find(b=>b.textContent.includes('채팅'))?.click()", '.chat textarea'],
    ['처리함 고치기', "document.querySelector('.chat-head .icon-btn')?.click(); setTimeout(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('처리함'))?.click(); setTimeout(()=>[...document.querySelectorAll('.ritem-done button')].find(b=>b.textContent.includes('고치기'))?.click(), 200)}, 200)", '.ritem-done input'],
  ];

  const results = [];
  for (const [name, prep, sel] of cases) {
    await js(prep);
    await wait(900);
    const found = await js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); el.value = ''; el.dispatchEvent(new Event('input')); return document.activeElement === el; })()`);
    if (!found) {
      results.push([name, false, `입력칸을 찾지 못함 (${sel})`]);
      continue;
    }
    key('A', 'a');
    key('B', 'b');
    key('Backspace');
    await wait(150);
    const value = await js(`document.querySelector(${JSON.stringify(sel)})?.value`);
    results.push([name, value === 'a', `값 ${JSON.stringify(value)} (기대 "a")`]);
  }

  // 오래 걸리는 작업(액션 찾기): 탭을 옮겼다 돌아와도 '찾는 중'이 남고 누를 수 없어야, 다시 눌러도 한 번만 돌아야 한다
  fs.writeFileSync(path.join(meeting, 'actions.json'), JSON.stringify({ kind: 'work', adviceTitle: '알아 둘 것', actions: [{ id: 'a1', owner: '화자 2', task: 'QA 마치기', due: null, kind: 'assigned', at: '00:06', quote: 'x', done: false }], advice: [] }));
  const tabClick = (t) => js(`[...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith(${JSON.stringify(t)}))?.click()`);
  await js(`document.querySelector('.ritem-done button')?.click()`); // 고치기 입력 닫기 (취소)
  await js(`location.hash='#meetings'`);
  await wait(400);
  await js(`location.hash='#meeting/${id}'`);
  await wait(900);
  await tabClick('액션');
  await wait(500);
  const again = `[...document.querySelectorAll('.acts .tab-bar button')].find(b=>b.textContent.includes('찾'))`;
  await js(`${again}?.click()`);
  await wait(200);
  await tabClick('회의록');
  await wait(400);
  await tabClick('액션');
  await wait(400);
  const busy = await js(`(() => { const b = ${again}; return b ? { busy: b.classList.contains('busy'), disabled: b.disabled, text: b.textContent } : null; })()`);
  await js(`${again}?.click()`);
  await wait(3200);
  const calls = await js('window.stubCalls().makeActions ?? 0');
  results.push(['진행 중 표시 유지 (탭 옮긴 뒤)', Boolean(busy?.busy && busy.disabled), busy ? `busy ${busy.busy} · disabled ${busy.disabled} · "${busy.text}"` : '버튼을 찾지 못함']);
  results.push(['같은 작업 한 번만', calls === 1, `액션 찾기 ${calls}번 호출`]);

  // 처리함 되돌리기 버튼을 다시 띄운다
  await tabClick('확인 필요');
  await wait(400);
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('처리함'))?.click()`);
  await wait(400);

  // 오류 알림: 글자색이 배경색과 달라야 한다 (전역 '.bad { color … !important }'가 글자를 배경색으로 칠해 빈 막대로 보인 적이 있다)
  await js(`[...document.querySelectorAll('.ritem-done button')].find(b=>b.textContent.includes('되돌리기'))?.click()`); // 가짜 API가 아무것도 돌려주지 않아 오류 알림이 뜬다
  await wait(600);
  const toast = await js(`(() => { const t = document.querySelector('#toasts .toast.bad'); if (!t) return null; const b = t.querySelector('b'); return { bg: getComputedStyle(t).backgroundColor, fg: getComputedStyle(b).color, text: t.textContent }; })()`);
  results.push(['오류 알림 글자', Boolean(toast && toast.text && toast.fg !== toast.bg), toast ? `글자 ${toast.fg} · 배경 ${toast.bg}` : '오류 알림이 뜨지 않음']);

  // 정리본 복사: 글자 있는 버튼으로 보이고, 마크다운 목록으로 복사된다 (화면이 lib/core 모듈을 불러온다)
  await tabClick('정리본');
  await wait(400);
  const copyBtn = `[...document.querySelectorAll('.tab-bar button')].find(b=>b.textContent.trim()==='정리본 복사')`;
  const shown = await js(`Boolean(${copyBtn})`);
  await js(`${copyBtn}?.click()`);
  await wait(300);
  const copied = await js('window.stubCalls().copied ?? null');
  const wantMd = '- **00:02 화자 1** 다음 주 배포 일정 얘기해 볼까요?\n- **00:06 화자 2** 네, 화요일 오전이 좋을 것 같아요.\n- **00:15 화자 2** 랩캐시도 쪽 확인만 하면 됩니다.';
  results.push(['정리본 복사 (마크다운)', shown && copied === wantMd, shown ? `복사한 글 ${JSON.stringify(copied)}` : '정리본 복사 버튼을 찾지 못함']);
  await js(`[...document.querySelectorAll('.meet-acts .btn')].find(b=>b.textContent.includes('회의록 복사'))?.click()`);
  await wait(300);
  const copiedMinutes = await js('window.stubCalls().copied ?? null');
  results.push(['회의록 복사', typeof copiedMinutes === 'string' && copiedMinutes.startsWith('# 예시 회의'), `복사한 글 앞부분 ${JSON.stringify(String(copiedMinutes).slice(0, 12))}`]);

  // 목록에 안 나오는 폴더: 이유와 함께 보이고, 휴지통 → 확인 → 그 폴더만 옮긴 뒤 목록에서 빠진다
  await js(`location.hash='#meetings'`);
  await wait(600);
  const strayRows = await js(`[...document.querySelectorAll('.stray-row')].map(r=>r.textContent)`);
  results.push(['목록에 안 나오는 폴더 표시', strayRows.length === 3 && strayRows[0].includes('날짜를 읽지 못함') && strayRows[2].includes('meta.json'), `${strayRows.length}줄 · ${JSON.stringify(strayRows[0] ?? '')}`]);
  await js(`document.querySelectorAll('.stray-row .icon-btn[aria-label="휴지통으로"]')[0]?.click()`);
  await wait(300);
  await js(`document.getElementById('confirmYes')?.click()`);
  await wait(600);
  const trashed = await js('window.stubCalls().trashed ?? []');
  const left = await js(`document.querySelectorAll('.stray-row').length`);
  results.push(['폴더 휴지통으로', trashed.length === 1 && trashed[0].endsWith('112-06-26_02-26-26_meeting') && left === 2, `옮김 ${JSON.stringify(trashed)} · 남은 줄 ${left}`]);

  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  }
  const jsErrors = errors.filter((e) => !/Cannot read properties of null \(reading 'removedWord'\)/.test(e)); // 위에서 일부러 낸 오류
  for (const e of jsErrors) console.log(`✗ 화면 오류: ${e}`);
  console.log(failed || jsErrors.length ? `화면 테스트 실패 ${failed + jsErrors.length}건` : `화면 테스트 통과 (${results.length}건)`);
  fs.rmSync(path.dirname(meeting), { recursive: true, force: true });
  app.exit(failed || jsErrors.length ? 1 : 0);
});
