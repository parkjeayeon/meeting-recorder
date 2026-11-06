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
process.env.STUB_MANY = process.env.STUB_MANY ?? '2'; // 질문 탭에 '잠깐 언급된 회의'까지 나오게

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
    ['확인 필요 직접 추가', "document.querySelector('.ritem-done input')?.blur(); [...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('남은 것'))?.click()", '.review-add textarea'],
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

  // 회의록에서 글자를 고르면 '확인 필요에 추가' → 확인 필요 탭의 입력칸에 그 말이 들어간다. 보내면 항목이 하나 늘어난다
  await js(`location.hash='#meeting/${id}'`);
  await wait(800);
  await tabClick('회의록');
  await wait(400);
  await js(`(() => { const doc = document.querySelector('.doc'); if (!doc) return 'no doc'; const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !t.textContent.includes('일정')); if (!t) return 'no text'; const i = t.textContent.indexOf('일정'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 2); getSelection().removeAllRanges(); getSelection().addRange(r); t.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return 'ok'; })()`);
  await wait(300);
  const flagBtn = `[...document.querySelectorAll('.term-add button')].find(b=>b.textContent.includes('확인 필요에 추가'))`;
  const offered = await js(`Boolean(${flagBtn})`);
  await js(`${flagBtn}?.click()`);
  await wait(500);
  const draft = await js(`document.querySelector('.review-add textarea')?.value ?? null`);
  results.push(['고른 말을 확인 필요에 추가', offered && draft === '"일정" ', offered ? `입력칸 ${JSON.stringify(draft)}` : '버튼이 뜨지 않음']);
  const before = await js(`document.querySelectorAll('.ritem').length`);
  await js(`(() => { const t = document.querySelector('.review-add textarea'); t.value = '"일정"은 일정표야'; t.dispatchEvent(new Event('input')); [...document.querySelectorAll('.review-add button')][0].click(); })()`);
  await wait(800);
  const asked = await js('window.stubCalls().addReview ?? null');
  const after = await js(`document.querySelectorAll('.ritem').length`);
  const cleared = await js(`document.querySelector('.review-add textarea')?.value`);
  results.push(['확인 필요 직접 추가 보내기', asked === '"일정"은 일정표야' && after === before + 1 && cleared === '', `요청 ${JSON.stringify(asked)} · 항목 ${before}→${after} · 입력칸 ${JSON.stringify(cleared)}`]);

  // 설정 › 다듬기: 로그인된 계정마다 남은 사용량 (15% 사용 → 85% 남음, 15% 남음은 주황), 새로 고침은 force
  await js(`document.getElementById('openSettings')?.click() ?? document.querySelector('[data-sec="cleanup"]')?.click()`);
  await wait(200);
  await js(`document.querySelector('.set-tab[data-sec="cleanup"]')?.click()`);
  await wait(700);
  const usageRows = await js(`[...document.querySelectorAll('.usage-row')].map(r => r.textContent + (r.classList.contains('low') ? ' [low]' : ''))`);
  const okRows = usageRows.length === 4 && usageRows[0].includes('85% 남음') && usageRows[1].includes('15% 남음 ') === false && usageRows[1].includes('[low]') && usageRows[3].includes('84% 남음');
  results.push(['다듬기 계정 남은 사용량', okRows, JSON.stringify(usageRows)]);
  await js(`[...document.querySelectorAll('.usage-foot .link')][0]?.click()`);
  await wait(400);
  const usageCalls = await js('window.stubCalls().usage ?? []');
  results.push(['사용량 새로 고침', JSON.stringify(usageCalls.slice(-1)) === '[true]', `호출 ${JSON.stringify(usageCalls)}`]);
  await js(`document.getElementById('settings')?.close()`);

  // 녹음 가져오기 창: 짐작한 회의 날짜가 채워지고(파일 이름에서), 고친 날짜로 가져온다. 아직 오지 않은 시각은 막는다
  await js(`location.hash='#meetings'`);
  await wait(500);
  await js(`[...document.querySelectorAll('.page-head .btn')].find(b=>b.textContent.includes('파일 가져오기'))?.click()`);
  await wait(500);
  const when = await js(`({ d: document.getElementById('importDate').value, t: document.getElementById('importTime').value, src: document.getElementById('importWhenSrc').textContent })`);
  results.push(['가져오기 날짜 채움', when.d === '2026-11-01' && when.t === '14:00' && when.src.includes('파일 이름'), JSON.stringify(when)]);
  await js(`document.getElementById('importDate').value='2099-01-01'; document.getElementById('importYes').click()`);
  await wait(300);
  const future = await js('window.stubCalls().importMeeting ?? null');
  await js(`document.getElementById('importDate').value='2026-10-20'; document.getElementById('importTime').value='09:30'; document.getElementById('importYes').click()`);
  await wait(500);
  const sent = await js('window.stubCalls().importMeeting ?? null');
  const sentAt = sent?.startedAt ? new Date(sent.startedAt) : null;
  results.push(['가져오기 날짜 고치기', future === null && sentAt && sentAt.getFullYear() === 2026 && sentAt.getMonth() === 9 && sentAt.getDate() === 20 && sentAt.getHours() === 9 && sentAt.getMinutes() === 30, `미래 막음 ${future === null} · 보낸 시각 ${sentAt?.toString().slice(0, 21)}`]);

  // 질문으로 찾기: 둥근 버튼은 어느 화면에서든 보이고, 찾는 동안 다른 화면에 있어도 끝나면 알림·뱃지 → '보기'로 회의 화면의 질문 탭
  await js(`document.getElementById('importSheet')?.close(); location.hash='#home'`);
  await wait(400);
  const fabOn = {};
  for (const r of ['home', 'dictations', 'meetings', 'stats']) {
    await js(`location.hash='#${r}'`);
    await wait(250);
    fabOn[r] = await js(`Boolean(document.querySelector('.fab')) && getComputedStyle(document.querySelector('.fab')).position === 'fixed'`);
  }
  results.push(['둥근 버튼이 모든 화면에', Object.values(fabOn).every(Boolean), JSON.stringify(fabOn)]);
  const openPanel = async () => {
    if (!(await js(`Boolean(document.querySelector('.askpanel'))`))) await js(`document.querySelector('.fab').click()`);
    await wait(200);
  };
  const ask = async (text) => {
    await openPanel();
    await js(`(() => { const t = document.querySelector('.askpanel textarea'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input')); document.querySelector('.ask-send').click(); })()`);
    await wait(150);
  };
  // 질문 입력칸: 진짜 키 입력 (영어·Backspace가 막히지 않는지)
  await js(`location.hash='#home'`);
  await wait(300);
  await openPanel();
  await js(`(() => { const t = document.querySelector('.askpanel textarea'); t.focus(); t.value = ''; t.dispatchEvent(new Event('input')); })()`);
  key('A', 'a');
  key('B', 'b');
  key('Backspace');
  await wait(150);
  const typed = await js(`document.querySelector('.askpanel textarea')?.value`);
  results.push(['질문으로 찾기 입력', typed === 'a', `값 ${JSON.stringify(typed)} (기대 "a")`]);
  // 최근 몇 개: 숫자만 들어간다 (진짜 키로)
  await js(`document.querySelector('.cchip[data-chip="count"]').click()`);
  await wait(200);
  await js(`document.querySelector('.cpop input')?.focus()`);
  key('1', '1');
  key('2', '2');
  key('A', 'a');
  await wait(150);
  const countVal = await js(`({ v: document.querySelector('.cpop input')?.value, chip: document.querySelector('.cchip[data-chip="count"]')?.textContent })`);
  results.push(['최근 몇 개는 숫자만', countVal.v === '12' && countVal.chip.includes('최근 12개'), JSON.stringify(countVal)]);
  await js(`document.querySelector('.cchip[data-chip="count"] .x')?.click()`);
  // 기간: 처음엔 비어 있고, 누르면 최근 7일
  const before7 = await js(`document.querySelector('.cchip[data-chip="range"]').textContent`);
  await js(`document.querySelector('.cchip[data-chip="range"]').click()`);
  await wait(200);
  const after7 = await js(`document.querySelector('.cchip[data-chip="range"]').textContent`);
  results.push(['기간은 누르면 최근 7일', before7 === '기간' && /–/.test(after7) && Boolean(await js(`[...document.querySelectorAll('.cpop .opts button')].find(b=>b.textContent==='최근 7일')?.getAttribute('aria-pressed')==='true'`)), `${JSON.stringify(before7)} → ${JSON.stringify(after7)}`]);
  await js(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); // 팝오버 닫기
  // 질문 속 기간(작년)과 기간 칩(최근 7일)이 겹치지 않으면 찾지 않고 경고, '기간 칩 빼고'로 다시
  await ask('작년 배포 회의');
  await wait(700);
  const warn = await js(`document.querySelector('.bubble.warn')?.textContent ?? null`);
  const chipHidden = await js(`location.hash='#meetings'; new Promise(r=>setTimeout(()=>r(![...document.querySelectorAll('.chip.ask')].length), 300))`);
  results.push(['기간이 안 겹치면 찾지 않음', Boolean(warn?.includes('찾지 않았습니다') && warn.includes('기간 칩 빼고')) && chipHidden, `${JSON.stringify(warn?.slice(0, 40))} · 탭 없음 ${chipHidden}`]);
  await openPanel();
  await js(`[...document.querySelectorAll('.bubble.warn button')].find(b=>b.textContent.includes('기간 칩 빼고'))?.click()`);
  await wait(200);
  const retried = await js('window.stubCalls().askStart?.at(-1) ?? null');
  results.push(['기간 칩 빼고 다시 찾기', retried?.question === '작년 배포 회의' && !retried.scope.from && !retried.scope.to, JSON.stringify(retried)]);
  await wait(1200);
  // 다른 화면에서 찾기 → 끝나면 알림·뱃지 → 보기
  await js(`document.querySelector('.askpanel header .icon-btn')?.click(); location.hash='#home'`);
  await wait(300);
  await ask('배포 관련 회의');
  await js(`document.querySelector('.askpanel header .icon-btn')?.click()`);
  await wait(250);
  const ring = await js(`Boolean(document.querySelector('.fab .fab-ring'))`);
  await wait(1100);
  const done = await js(`({ toast: document.querySelector('.fab-toast')?.textContent ?? null, badge: document.querySelector('.fab-badge')?.textContent ?? null, ring: Boolean(document.querySelector('.fab .fab-ring')) })`);
  results.push(['다른 화면에서 끝나면 알림·뱃지', ring && !done.ring && Boolean(done.toast?.includes('2건을 찾았습니다')) && Number(done.badge) >= 1, `찾는 중 둘레 ${ring} · ${JSON.stringify(done)}`]);
  await js(`document.querySelector('.fab-toast')?.click()`);
  await wait(600);
  const tab = await js(`({ hash: location.hash, pressed: document.querySelector('.chip.ask[aria-pressed="true"]')?.textContent ?? null, groups: [...document.querySelectorAll('.mix-sec .sec-h h2')].map(x=>x.textContent), reasons: [...document.querySelectorAll('.ltitle .reason')].map(x=>x.textContent), badge: document.querySelector('.fab-badge')?.textContent ?? null })`);
  results.push(['질문 탭: 주로 다룸·잠깐 언급과 이유', tab.hash === '#meetings' && Boolean(tab.pressed?.includes('배포')) && JSON.stringify(tab.groups) === '["주제로 다룬 회의","잠깐 언급된 회의"]' && tab.reasons.includes('배포 일정을 정한 회의'), JSON.stringify(tab)]);
  // 실패한 질문은 탭에 표시되고 채팅에서 다시 찾을 수 있다, 탭 닫기는 메인 프로세스에서도 지운다
  await ask('실패하는 질문');
  await wait(1200);
  const bad = await js(`({ chip: Boolean(document.querySelector('.chip.ask.bad')), bubble: document.querySelector('.askpanel .bubble.warn')?.textContent ?? null })`);
  results.push(['찾기 실패 표시', bad.chip && Boolean(bad.bubble?.includes('시간 초과')), JSON.stringify(bad)]);
  await js(`document.querySelector('.askpanel header .icon-btn')?.click(); document.querySelector('.chip.ask.bad .x')?.click()`);
  await wait(300);
  const removed = await js(`({ calls: window.stubCalls().askRemove ?? [], left: document.querySelectorAll('.chip.ask').length })`);
  results.push(['질문 탭 닫기', removed.calls.length >= 2 && removed.left === 2, JSON.stringify(removed)]);

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
