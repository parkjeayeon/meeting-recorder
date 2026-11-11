// 기능 시험: 사용자가 하는 일 하나씩(탭 옮기기, 화자 이름 바꾸기, 확인 필요 적용·되돌리기·확인 마치기, 사전 추가…)을
// 가짜 데이터로 앱을 띄워 해 보고, 화면에 보이는 결과와 본체로 간 호출(가짜 API가 남긴 기록)을 본다.
//   npx electron scripts/dev/feature-test.js [묶음 이름 일부]     (npm run test:feature)
// 왜 따로: React로 옮기기 전 지금 동작을 못 박아 두는 안전망이다. 그래서 클래스 이름이 아니라 화면 글자·역할·aria로 찾는다
// (옮기면 클래스는 바뀌어도 사용자가 보는 글자와 동작은 같아야 한다). 키 입력 버그는 scripts/dev/ui-test.js가 따로 본다.
// 묶음마다 새 창과 새 예시 회의 폴더를 써서 앞 묶음이 바꾼 파일이 뒤에 번지지 않는다. 실제 기록·설정은 건드리지 않는다.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setName(`mr-feature-test-${process.pid}`);
nativeTheme.themeSource = 'light';
app.dock?.hide();
app.on('window-all-closed', () => {}); // 묶음마다 창을 닫고 새로 연다 — 창이 0개인 순간에 앱이 끝나지 않게
const only = process.argv.slice(2).find((a) => !a.startsWith('-') && !a.endsWith('.js'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  console.error('기능 시험 시간 초과');
  process.exit(1);
}, 240000);

// ── 예시 회의 (지어낸 내용) ──
const TRANSCRIPT = [
  '[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?',
  '[00:06] [화자 2] 네, 화요일 오전이 좋을 것 같아요.',
  '[00:11] [화자 1] QA는 월요일까지 끝낼 수 있죠?',
  '[00:15] [화자 2] 랩캐시도 쪽 확인만 하면 됩니다.',
  '[00:40] [화자 1] 알림은 다음 배포로 넘기죠.',
];
const MINUTES = `# 예시 회의: 배포 일정 정리

## 요약
배포 일정과 QA 범위를 정리함.

## 논의 내용
### 배포
- 배포는 화요일 오전으로 함 (00:06)

## 결정 사항
- 알림은 다음 배포로 넘김 (00:40)

## 할 일
- [ ] QA 마치기 — 담당: 화자 2, 기한: 월요일
- [ ] 배포 공지 쓰기 — 담당: 화자 1

## 확인 필요
- "랩캐시도"(00:15): Memcached로 추정됨
`;
const REVIEW = { items: [
  { id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 관련 용어가 잘못 인식된 것으로 보임', status: 'open' },
  { id: 'r2', kind: 'word', at: '00:06', heard: '화요일', guess: null, note: '요일이 맞는지', status: 'open' },
  { id: 'r3', kind: 'name', at: null, heard: null, heardNote: '도윤님', note: "'도윤님'이 누구인지 확인이 필요함", status: 'open' },
  { id: 'r4', kind: 'meaning', at: '00:40', heard: null, heardNote: null, note: '회의록의 이 문장에 붙은 시각 앞뒤 녹취에서 관련된 말을 찾지 못했습니다: "예시"', status: 'open', source: 'check', check: 'ungrounded' },
  { id: 'r5', kind: 'word', at: '00:11', heard: '큐에이', applied: 'QA', count: 1, note: '약어', status: 'applied', undo: { 'transcript.txt': { changed: [], inserted: [] } } },
  { id: 'r6', kind: 'meaning', at: null, heard: null, note: '잠깐 끊긴 말', status: 'kept' },
] };
const GLOSSARY = { terms: [
  { id: 'g1', term: 'QA', note: '출시 전에 기능이 제대로 동작하는지 확인하는 품질 검사', basis: 'general', status: 'confirmed', source: 'llm', at: ['00:11'] },
  { id: 'g2', term: '알림', note: '앱 푸시 알림 기능', basis: 'meeting', status: 'suggested', source: 'llm', at: ['00:40'] },
] };
function makeMeeting() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-feature-')) + '/2026-11-01_23-00-00_meeting';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'transcript.txt'), `${TRANSCRIPT.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'script-clean.txt'), `${TRANSCRIPT.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'minutes.md'), MINUTES);
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(REVIEW));
  fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify(GLOSSARY));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ startedAt: '2026-11-01T14:00:00Z', files: { mic: { file: 'mic.wav', durationSec: 1800 } } }));
  return dir;
}

// ── 화면 안에서 쓰는 도우미: 이름(aria-label·글자·title)으로 버튼·탭·칩을 찾는다 ──
const HELPERS = `window.__t = (() => {
  const vis = (e) => e && e.isConnected && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
  const CLICKABLE = 'button, a[href], [role=tab], [role=button], summary, label, input[type=checkbox], input[type=radio]';
  const find = (text, { within = document, sel = CLICKABLE, exact = false } = {}) => {
    const all = [...(typeof within === 'string' ? document.querySelector(within) : within).querySelectorAll(sel)].filter(vis);
    return all.find((e) => name(e) === text) || (!exact && all.find((e) => name(e).startsWith(text))) || (!exact && all.find((e) => name(e).includes(text))) || null;
  };
  const click = (text, opts) => { const e = find(text, opts); if (!e) return false; e.click(); return true; };
  const field = (label) => [...document.querySelectorAll('input, textarea, select')].filter(vis).find((e) => e.getAttribute('aria-label') === label || e.placeholder?.startsWith(label) || e.closest('label')?.textContent.trim().startsWith(label)) || null;
  const type = (label, value, { enter = false } = {}) => {
    const e = field(label); if (!e) return false;
    e.focus(); e.value = value; e.dispatchEvent(new Event('input', { bubbles: true }));
    if (enter) e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  };
  const has = (text, within = document.body) => vis((typeof within === 'string' ? document.querySelector(within) : within)) && (typeof within === 'string' ? document.querySelector(within) : within).innerText.includes(text);
  const toasts = () => [...document.querySelectorAll('[role=status]')].map((e) => e.innerText.replace(/\\s+/g, ' '));
  const tab = () => document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim() ?? null;
  return { find, click, field, type, has, toasts, tab, name };
})();`;

const results = [];
const suites = [];
const suite = (name, env, run) => suites.push({ name, env, run });
const check = (name, ok, detail) => results.push([name, Boolean(ok), typeof detail === 'string' ? detail : JSON.stringify(detail)]);

async function open(env) {
  const dir = makeMeeting();
  // 묶음이 켠 상태(폴더 막힘·회의록 멈춤 등)가 다음 묶음에 남지 않게 모두 기본값으로 되돌린 뒤 이 묶음 것만 켠다
  const base = { STUB_MEETING_DIR: dir, STUB_MANY: '0', STUB_DICTS: '0', STUB_STRAY: 'none', STUB_HISTORY_DICTS: '', STUB_JOB_MS: '300', STUB_ASK_MS: '100', STUB_FOLDER: '', STUB_MINUTES: '', STUB_GUESS: '' };
  for (const [k, v] of Object.entries({ ...base, ...env })) if (v === '') delete process.env[k]; else process.env[k] = v;
  const w = new BrowserWindow({ width: 1240, height: 860, show: false, webPreferences: { preload: path.join(__dirname, 'stub-preload.js'), sandbox: false } });
  const errors = [];
  w.webContents.on('console-message', (e) => e.level === 'error' && errors.push(e.message));
  // 앞 창을 막 닫은 직후엔 불러오기가 ERR_FAILED로 끝나는 일이 있어 한 번 더
  await w.loadFile(path.join(__dirname, '../../src/renderer/index.html')).catch(async () => { await wait(500); await w.loadFile(path.join(__dirname, '../../src/renderer/index.html')); });
  await wait(1200);
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`${HELPERS}; true`);
  const id = path.basename(dir);
  const p = {
    w, js, dir, id, errors, wait,
    // 화면을 옮기고, 회의 화면이면 탭이 그려질 때까지 기다린다 (정해진 시간만 기다리면 느린 순간에 흔들린다)
    go: async (hash, ms = 600) => {
      await js(`location.hash=${JSON.stringify(hash)}`);
      await wait(ms);
      if (hash.startsWith('#meeting/')) await p.until(`document.querySelector('[role=tab][aria-selected=true]') || document.querySelector('.page')?.innerText.includes('다시 쓰기')`);
    },
    until: async (expr, ms = 4000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(100)) if (await js(`Boolean(${expr})`)) return true;
      return false;
    },
    click: async (text, opts = {}, ms = 350) => { const ok = await js(`__t.click(${JSON.stringify(text)}, ${JSON.stringify(opts)})`); await wait(ms); return ok; },
    type: async (label, value, opts = {}, ms = 300) => { const ok = await js(`__t.type(${JSON.stringify(label)}, ${JSON.stringify(value)}, ${JSON.stringify(opts)})`); await wait(ms); return ok; },
    has: (text, within) => js(`__t.has(${JSON.stringify(text)}${within ? `, ${JSON.stringify(within)}` : ''})`),
    toasts: () => js('__t.toasts()'),
    tab: () => js('__t.tab()'),
    log: () => js('window.stubLog()'),
    called: async (name) => (await js('window.stubLog()')).filter(([n]) => n === name).map(([, a]) => a),
    key: async (key, mods = []) => { w.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods }); await wait(300); },
    review: () => JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')),
    confirm: async (yes = true) => { const ok = await js(`(() => { const d = document.getElementById('confirm'); if (!d?.open) return false; document.getElementById(${JSON.stringify(yes ? 'confirmYes' : 'confirmNo')}).click(); return true; })()`); await wait(400); return ok; },
  };
  return p;
}

// ══════════════════════ 회의 페이지 ══════════════════════
suite('회의 페이지 · 탭과 본문', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  const tabs = await p.js(`[...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim())`);
  check('탭: 회의록·확인 필요·정리본·원본·화자', ['회의록', '확인 필요', '정리본', '원본', '화자'].every((t) => tabs.some((x) => x.startsWith(t))), tabs);
  check('처음 탭은 회의록, 요약이 보임', (await p.tab()) === '회의록' && (await p.has('배포 일정과 QA 범위를 정리함')), await p.tab());
  await p.click('원본', { sel: '[role=tab]' });
  check('원본 탭: 녹취 줄이 보임', (await p.tab()) === '원본' && (await p.has('랩캐시도 쪽 확인만')), await p.tab());
  await p.click('정리본', { sel: '[role=tab]' });
  check('정리본 탭', (await p.tab()) === '정리본' && (await p.has('화요일 오전이 좋을')), await p.tab());
  await p.click('화자', { sel: '[role=tab]' });
  check('화자 탭: 화자 둘', (await p.tab())?.startsWith('화자') && (await p.has('화자 1')) && (await p.has('화자 2')), await p.tab());
  await p.click('확인 필요', { sel: '[role=tab]' });
  check('확인 필요 탭 숫자는 남은 항목 수', (await p.tab()) === '확인 필요4', await p.tab());
  check('회의 제목·메타', (await p.has('예시 회의: 배포 일정 정리')) && (await p.has('화자 2명')), '');
});

suite('회의 페이지 · 할 일 체크', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  const before = await p.js(`[...document.querySelectorAll('input[type=checkbox][aria-label="할 일 완료"]')].map((c) => c.checked)`);
  await p.js(`document.querySelectorAll('input[type=checkbox][aria-label="할 일 완료"]')[1].click()`);
  await p.wait(400);
  const calls = await p.called('toggleTodo');
  const md = fs.readFileSync(path.join(p.dir, 'minutes.md'), 'utf8');
  check('할 일 체크 → 두 번째 할 일만 완료로 저장', JSON.stringify(before) === '[false,false]' && calls.length === 1 && calls[0][1] === 1 && calls[0][2] === true && md.includes('- [x] 배포 공지 쓰기') && md.includes('- [ ] QA 마치기'), { before, calls });
});

suite('회의 페이지 · 화자 이름 바꾸기', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  await p.click('화자 1', { sel: 'button' });
  const input = await p.js(`(() => { const i = document.activeElement; return i && i.tagName === 'INPUT' ? i.value : null; })()`);
  await p.js(`(() => { const i = document.activeElement; i.value = '민준'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await p.wait(500);
  const calls = await p.called('renameSpeaker');
  const toast = (await p.toasts()).find((t) => t.includes('민준'));
  check('화자 칩을 누르면 이름 입력칸(지금 이름), Enter로 저장', input === '화자 1' && calls.length === 1 && calls[0][1] === '화자 1' && calls[0][2] === '민준' && Boolean(toast), { input, calls, toast });
});

suite('회의 페이지 · 본문 찾기(⌘F)', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  await p.js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }))`);
  await p.wait(300);
  await p.js(`(() => { const i = document.querySelector('[role=search] input'); i.value = '배포'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.wait(400);
  const count = await p.js(`document.querySelector('[role=search]')?.innerText.trim() ?? null`);
  const marks = await p.js(`CSS.highlights.get('find')?.size ?? 0`); // 강조는 CSS Highlight API (본문 글자를 감싸지 않는다)
  await p.js(`(() => { const i = document.querySelector('[role=search] input'); i.value = '없는말쓰기'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.wait(300);
  const none = await p.js(`document.querySelector('[role=search]')?.innerText.trim() ?? null`);
  await p.js(`document.querySelector('[role=search] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await p.wait(300);
  const closed = await p.js(`!document.querySelector('[role=search]')`);
  check('⌘F: 찾은 수 "1/N"·강조, 없으면 "없음", Esc로 닫힘', /1\/\d+/.test(count ?? '') && marks > 1 && /없음/.test(none ?? '') && closed, { count, marks, none, closed });
});

suite('회의 페이지 · 용어', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  check('용어 칸: 확인한 것과 추정(점선·"추정")', (await p.has('용어')) && (await p.has('추정')), '');
  await p.click('알림', { sel: 'button' });
  const card = await p.js(`document.querySelector('[role=dialog][aria-label="알림 설명"]')?.innerText ?? null`);
  await p.click('맞아요');
  const confirmCall = (await p.called('updateTerm')).at(-1);
  await p.click('QA', { sel: 'button' });
  const qaCard = await p.js(`document.querySelector('[role=dialog][aria-label="QA 설명"]')?.innerText ?? null`);
  await p.click('지우기', { within: '[role=dialog]' });
  const removeCall = (await p.called('updateTerm')).at(-1);
  check('용어: 추정 카드의 "맞아요" → 확인, 확인한 카드엔 "맞아요" 없음, "지우기"', Boolean(card?.includes('앱 푸시 알림')) && confirmCall?.[1] === 'g2' && confirmCall?.[2]?.status === 'confirmed' && Boolean(qaCard) && !qaCard.includes('맞아요') && removeCall?.[1] === 'g1' && removeCall?.[2]?.remove === true, { card, confirmCall, qaCard, removeCall });
});

suite('회의 페이지 · … 메뉴와 휴지통', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  await p.click('더 보기', { sel: 'button' });
  const menu = await p.js(`[...document.querySelectorAll('[role=menu] button, .menu button')].map((b) => b.textContent.trim())`);
  await p.click('휴지통으로 옮기기');
  const asked = await p.confirm(false);
  const notYet = (await p.called('trashMeeting')).length;
  await p.click('더 보기', { sel: 'button' });
  await p.click('휴지통으로 옮기기');
  await p.confirm(true);
  const trashed = await p.called('trashMeeting');
  check('… 메뉴: 휴지통은 확인 창을 거침(취소하면 안 옮김)', menu.some((t) => t.includes('휴지통')) && asked && notYet === 0 && trashed.length === 1 && trashed[0][0] === p.dir, { menu, asked, notYet, trashed });
});

suite('회의 페이지 · 다시 만들기', {}, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  await p.click('다시 만들기', { sel: 'button' });
  const opts = await p.js(`[...document.querySelectorAll('button')].filter((b) => b.offsetParent && /다시 (만들기|쓰기)/.test(b.textContent)).map((b) => b.textContent.trim())`);
  await p.click('녹취부터 다시 만들기');
  await p.confirm(true);
  const calls = await p.called('makeMinutes');
  check('다시 만들기 → "녹취부터 다시 만들기"가 회의록 만들기를 부름', opts.some((t) => t.includes('녹취부터')) && calls.length === 1 && calls[0][0] === p.dir, { opts, calls });
});

// ══════════════════════ 확인 필요 ══════════════════════
const toReview = async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  await p.click('확인 필요', { sel: '[role=tab]' });
};

suite('확인 필요 · 항목 종류와 모양', {}, async (p) => {
  await toReview(p);
  const tags = await p.js(`[...document.querySelectorAll('input[aria-label="고르기"]')].map((c) => c.closest('div').parentElement.innerText.split('\\n')[0])`);
  check('남은 항목 4개, 종류 표시(오인식·이름·근거 확인)', tags.length === 4 && tags.some((t) => t.includes('오인식')) && tags.some((t) => t.includes('이름')) && tags.some((t) => t.includes('근거 확인')), tags);
  const guess = await p.js(`(() => { const i = [...document.querySelectorAll('input')].find((x) => x.value === 'Memcached'); return Boolean(i); })()`);
  check('추정이 있는 항목은 고칠 말 칸에 추정이 채워짐', guess, '');
  check('녹취에 글자가 없는 이름 항목: "확인한 내용"·"녹취에 적힌 글자"·"고칠 말" 칸', Boolean(await p.js(`__t.field('확인한 내용') && __t.field('녹취에 적힌 글자') && __t.field('고칠 말')`)), '');
});

suite('확인 필요 · 적용(추정·직접 입력)', {}, async (p) => {
  await toReview(p);
  await p.js(`(() => { const i = [...document.querySelectorAll('input')].find((x) => x.value === 'Memcached'); i.closest('div').querySelector('button').click(); })()`);
  await p.wait(500);
  const first = await p.called('applyReview');
  await p.js(`(() => { const i = [...document.querySelectorAll('input[placeholder^="고칠 말"]')].find((x) => !x.value); i.value = '수요일'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  await p.wait(500);
  const second = (await p.called('applyReview'))[1];
  const st = Object.fromEntries(p.review().items.map((it) => [it.id, it.status]));
  check('추정대로 적용 → r1을 Memcached로, Enter로 직접 입력 → r2를 수요일로', first[0]?.[1]?.[0]?.id === 'r1' && first[0][1][0].guess === 'Memcached' && second?.[1]?.[0]?.id === 'r2' && second[1][0].guess === '수요일' && st.r1 === 'applied' && st.r2 === 'applied', { first, second, st });
  check('적용하면 남은 수가 줄어듦', (await p.tab()) === '확인 필요2', await p.tab());
});

suite('확인 필요 · 확인됨·그대로 두기', {}, async (p) => {
  await toReview(p);
  await p.type('확인한 내용', '외부 개발자');
  await p.click('확인됨');
  const resolved = (await p.called('applyReview'))[0]?.[1]?.[0];
  await p.js(`(() => { const card = [...document.querySelectorAll('input[aria-label="고르기"]')].map((c) => c.closest('div').parentElement).find((c) => c.innerText.includes('근거 확인')); [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '그대로 두기').click(); })()`);
  await p.wait(500);
  const kept = (await p.called('setReviewStatus'))[0];
  const st = Object.fromEntries(p.review().items.map((it) => [it.id, it.status]));
  check('이름 항목에 확인한 내용 → 확인됨, 근거 확인 항목 → 그대로 두기', resolved?.id === 'r3' && resolved.resolve === '외부 개발자' && JSON.stringify(kept?.[1]) === '["r4"]' && kept[2] === 'kept' && st.r3 === 'resolved' && st.r4 === 'kept', { resolved, kept, st });
});

suite('확인 필요 · 여러 개 한꺼번에', {}, async (p) => {
  await toReview(p);
  await p.js(`document.querySelector('input[aria-label="모두 고르기"]').click()`);
  await p.wait(300);
  const bar = await p.js(`[...document.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter((t) => /추정대로 적용|채팅으로 확인|그대로 두기/.test(t))`);
  const label = await p.has('4개 선택');
  await p.click('추정대로 적용');
  await p.wait(300);
  const call = (await p.called('applyReview'))[0]?.[1];
  check('모두 고르기 → "4개 선택", 추정대로 적용은 고칠 말이 있는 항목만(r1)', label && bar.some((t) => t.startsWith('추정대로 적용')) && JSON.stringify(call?.map((f) => f.id)) === '["r1"]', { bar, call });
});

suite('확인 필요 · 처리함: 되돌리기·다시 열기', {}, async (p) => {
  await toReview(p);
  await p.click('처리함', { sel: 'button' });
  const rows = await p.js(`document.body.innerText.includes('큐에이') && document.body.innerText.includes('잠깐 끊긴 말')`);
  await p.click('되돌리기');
  await p.wait(300);
  const reverted = await p.called('revertReview');
  await p.click('다시 열기');
  await p.wait(300);
  const reopened = (await p.called('setReviewStatus')).at(-1);
  const st = Object.fromEntries(p.review().items.map((it) => [it.id, it.status]));
  check('처리함: 고친 항목 되돌리기(r5), 그대로 둔 항목 다시 열기(r6)', rows && reverted[0]?.[1] === 'r5' && JSON.stringify(reopened?.[1]) === '["r6"]' && reopened[2] === 'open' && st.r5 === 'open' && st.r6 === 'open', { reverted, reopened, st });
});

suite('확인 필요 · 확인 마치기', {}, async (p) => {
  await toReview(p);
  const label = await p.js(`[...document.querySelectorAll('button')].find((b) => /확인 마치기/.test(b.textContent))?.textContent.trim() ?? null`);
  await p.click('남은 4개는 그대로 두고 확인 마치기');
  await p.wait(700);
  const calls = await p.called('finalizeReview');
  const toast = (await p.toasts()).find((t) => t.includes('확정'));
  await p.click('처리함', { sel: 'button' });
  const locked = await p.js(`![...document.querySelectorAll('button')].some((b) => b.offsetParent && /되돌리기|다시 열기/.test(b.textContent))`);
  check('남은 항목이 있으면 "남은 N개는 그대로 두고 확인 마치기", 확정 뒤 처리함은 잠김', label === '남은 4개는 그대로 두고 확인 마치기' && calls.length === 1 && Boolean(toast) && locked, { label, calls: calls.length, toast, locked });
});

// ══════════════════════ 회의 목록 ══════════════════════
suite('회의 목록 · 갈래와 개수', { STUB_MANY: '30' }, async (p) => {
  await p.go('#meetings', 800);
  const chips = await p.js(`[...document.querySelectorAll('.page [aria-pressed]')].filter((b) => b.offsetParent).map((b) => [b.textContent.replace(/\\d+$/, '').trim(), Number(b.textContent.match(/(\\d+)$/)?.[1] ?? -1)])`);
  const counts = {};
  for (const [label] of chips.filter(([l]) => ['전체', '확인 완료', '확인할 회의', '녹음만 · 실패'].includes(l))) {
    await p.click(label, { sel: '[aria-pressed]' });
    counts[label] = await p.js(`[...document.querySelectorAll('a[href^="#meeting/"]')].filter((a) => a.offsetParent).length`);
  }
  const byChip = Object.fromEntries(chips);
  // 실패·녹음만은 '확인할 회의'와 '녹음만 · 실패' 둘 다에 든다. 짧은 녹음(10초 미만)은 '녹음만 · 실패'에만
  const leftover = byChip['전체'] - byChip['확인 완료'] - byChip['확인할 회의'];
  check('갈래 칩: 확인 완료 + 확인할 회의로 나뉘고, 나머지(짧은 녹음)는 녹음만·실패에', byChip['전체'] === 31 && leftover >= 0 && byChip['녹음만 · 실패'] >= leftover && byChip['확인할 회의'] > 0, { chips, leftover });
  check('갈래를 누르면 그 갈래의 회의만(개수 = 칩 숫자)', ['확인 완료', '녹음만 · 실패'].every((l) => counts[l] === byChip[l]), { counts, byChip });
});

suite('회의 목록 · 검색', { STUB_MANY: '30' }, async (p) => {
  await p.go('#meetings', 800);
  await p.type('제목, 요약 검색', '채용');
  await p.wait(300);
  const titles = await p.js(`[...document.querySelectorAll('a[href^="#meeting/"]')].filter((a) => a.offsetParent).map((a) => a.innerText.split('\\n').find((l) => /\\d차/.test(l)) ?? a.innerText.split('\\n')[0])`);
  await p.type('제목, 요약 검색', '없는제목입니다');
  const empty = await p.js(`[...document.querySelectorAll('a[href^="#meeting/"]')].filter((a) => a.offsetParent).length`);
  check('검색: 제목에 그 말이 든 회의만, 없으면 0', titles.length > 0 && titles.every((t) => t.includes('채용')) && empty === 0, { titles, empty });
});

suite('회의 목록 · 확인할 회의 넘침과 바로가기', { STUB_MANY: '40' }, async (p) => {
  await p.go('#meetings', 900);
  const more = await p.js(`[...document.querySelectorAll('button')].find((b) => /건 더 보기/.test(b.textContent))?.textContent.trim() ?? null`);
  await p.click(more ?? '건 더 보기');
  const pressed = await p.js(`document.querySelector('.page [aria-pressed="true"]')?.textContent.trim() ?? null`);
  await p.click('전체', { sel: '[aria-pressed]' });
  const rail = await p.js(`[...document.querySelectorAll('nav button, aside button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()).filter((t) => /확인할 회의|최근 회의|월/.test(t))`);
  const heads = await p.js(`[...document.querySelectorAll('h2')].map((h) => h.textContent.trim())`);
  check('확인할 회의가 6개를 넘으면 "N건 더 보기" → 확인할 회의 갈래', Boolean(more) && Boolean(pressed?.startsWith('확인할 회의')), { more, pressed });
  check('묶음: 확인할 회의 → 최근 회의 → 이전 회의, 오른쪽 바로가기', ['확인할 회의', '최근 회의', '이전 회의'].every((h) => heads.includes(h)) && rail.some((t) => t.startsWith('최근 회의')), { heads, rail });
});

suite('회의 목록 · 회의가 없을 때', { STUB_MEETING_DIR_NONE: '1' }, async (p) => {
  await p.js(`localStorage.clear()`);
  await p.go('#meetings', 700);
  const text = await p.js(`document.querySelector('.page')?.innerText ?? ''`);
  check('회의가 없으면 빈 화면 안내', /아직|없습니다/.test(text), text.slice(0, 120));
});

// ══════════════════════ 받아쓰기 ══════════════════════
suite('받아쓰기 · 복사·다시 붙여넣기·지우기', { STUB_DICTS: '5' }, async (p) => {
  await p.go('#dictations', 800);
  const first = await p.js(`document.querySelector('[aria-label="다시 붙여넣기"]')?.closest('div').parentElement.innerText.split('\\n').find((l) => l.includes('받아쓴 글')) ?? null`);
  await p.js(`document.querySelector('[aria-label="다시 붙여넣기"]').click()`);
  await p.wait(300);
  const repaste = await p.called('repaste');
  await p.js(`document.querySelector('[aria-label="삭제"]').click()`);
  await p.wait(300);
  const asked = await p.confirm(true);
  await p.wait(400);
  const del = await p.called('deleteDictation');
  const still = await p.has('받아쓴 글 0번입니다');
  check('다시 붙여넣기는 그 글을 보냄', repaste.length === 1 && repaste[0][0] === '받아쓴 글 0번입니다', { first, repaste });
  check('삭제는 확인 창을 거쳐 지우고 목록에서 빠짐', asked && del.length === 1 && del[0][0] === 'd0000' && !still, { asked, del, still });
});

// ══════════════════════ 사전 ══════════════════════
suite('사전 · 추가와 지우기', {}, async (p) => {
  await p.go('#dictionary', 600);
  await p.type('단어나 이름', '메모리캐시, Whisper', { enter: true });
  await p.wait(300);
  const saved = (await p.called('dictSaveSettings')).at(-1)?.[0];
  const shown = await p.has('메모리캐시');
  await p.click('메모리캐시 지우기');
  const removed = (await p.called('dictSaveSettings')).at(-1)?.[0];
  check('사전: 쉼표로 여러 개 추가(이미 있는 Whisper는 다시 안 넣음), 지우기', saved?.vocabulary === 'PJY, Whisper, 메모리캐시' && shown && removed?.vocabulary === 'PJY, Whisper', { saved, removed });
});

// ══════════════════════ 설정 ══════════════════════
suite('설정 · 탭과 저장', {}, async (p) => {
  await p.js(`document.getElementById('openSettings').click()`);
  await p.wait(400);
  const secs = {};
  for (const name of ['받아쓰기', '다듬기', '회의', '엔진', '계정·토큰', '권한']) {
    await p.click(name, { within: '#settings', sel: 'button' });
    secs[name] = await p.js(`[...document.querySelectorAll('#settings section')].find((s) => !s.hidden)?.querySelector('h3')?.textContent.trim() ?? null`);
  }
  check('설정 탭마다 그 칸이 보임', Object.entries(secs).every(([k, v]) => v && v.startsWith(k === '권한' ? 'macOS 권한' : k)), secs);
  await p.click('다듬기', { within: '#settings', sel: 'button' });
  await p.js(`document.getElementById('dictCleanup').click()`);
  await p.wait(300);
  await p.js(`(() => { const r = document.querySelector('input[name=provider][value=codex]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await p.wait(300);
  await p.click('회의', { within: '#settings', sel: 'button' });
  await p.js(`(() => { const s = document.getElementById('meetLanguage'); s.value = 'en'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await p.wait(300);
  const saves = (await p.called('dictSaveSettings')).map(([patch]) => patch);
  check('다듬기 끄기·계정 고르기·회의 언어가 저장됨', saves.some((s) => s.cleanup === false) && saves.some((s) => s.provider === 'codex') && saves.some((s) => s.meetingLanguage === 'en'), saves);
  await p.js(`document.getElementById('settingsClose').click()`);
  await p.wait(300);
  check('닫기', !(await p.js(`document.getElementById('settings').open`)), '');
});

// ══════════════════════ 이동 ══════════════════════
suite('이동 · 사이드바·뒤로·⌘K', { STUB_MANY: '3' }, async (p) => {
  const heads = {};
  for (const [nav, hash] of [['받아쓰기', '#dictations'], ['회의', '#meetings'], ['사전', '#dictionary'], ['통계', '#stats'], ['홈', '#home']]) {
    await p.click(nav, { within: 'nav', sel: 'a, button' });
    heads[nav] = await p.js('location.hash');
  }
  check('사이드바로 각 화면', heads['받아쓰기'] === '#dictations' && heads['회의'] === '#meetings' && heads['사전'] === '#dictionary' && heads['통계'] === '#stats' && heads['홈'] === '#home', heads);
  await p.click('뒤로', { sel: 'button' });
  const back = await p.js('location.hash');
  await p.click('앞으로', { sel: 'button' });
  const fwd = await p.js('location.hash');
  check('뒤로·앞으로', back === '#stats' && fwd === '#home', { back, fwd });
  await p.js(`document.getElementById('openPalette').click()`);
  await p.wait(300);
  await p.js(`(() => { const i = document.getElementById('paletteInput'); i.value = '예시 회의'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.wait(300);
  await p.js(`document.getElementById('paletteInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await p.wait(700);
  check('⌘K: 회의 제목으로 찾아 Enter → 그 회의', (await p.js('location.hash')) === `#meeting/${p.id}`, await p.js('location.hash'));
});

// ══════════════════════ 홈 ══════════════════════
suite('홈 · 챙길 일에서 이동', { STUB_MANY: '12' }, async (p) => {
  await p.go('#home', 700);
  const rows = await p.js(`[...document.querySelectorAll('button')].filter((b) => b.offsetParent && /확인할 회의|회의록이 없는 녹음|압축할 수 있는 녹음/.test(b.textContent)).map((b) => b.innerText.replace(/\\s+/g, ' '))`);
  await p.click('회의록이 없는 녹음');
  const pressed = await p.js(`document.querySelector('.page [aria-pressed="true"]')?.textContent.trim() ?? null`);
  await p.go('#home', 600);
  await p.click('예시 회의: 배포 일정 정리', { sel: 'a' });
  check('챙길 일 "회의록이 없는 녹음" → 녹음만·실패 갈래', rows.length >= 2 && Boolean(pressed?.startsWith('녹음만')), { rows, pressed });
  check('최근 회의 줄 → 그 회의', (await p.js('location.hash')) === `#meeting/${p.id}`, await p.js('location.hash'));
});

suite('홈 · 녹음 공간', { STUB_MANY: '8' }, async (p) => {
  await p.go('#home', 700);
  const text = await p.js(`[...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === '녹음 공간')?.innerText ?? null`);
  check('녹음 공간: 전체 크기·원본/압축 개수, 압축할 수 있는 녹음만 목록, 16kHz는 빼고 개수만', Boolean(text) && /원본 WAV \d+개/.test(text) && text.includes('압축할 수 있는 녹음') && !text.includes('16kHz · 압축 안 함') && /압축하지 않습니다/.test(text), text);
});

// ══════════════════════ 멈춘·막힌 상태 ══════════════════════
suite('회의 페이지 · 인터넷이 끊겨 멈춘 회의', { STUB_MINUTES: 'offline' }, async (p) => {
  await p.go(`#meeting/${p.id}`, 900);
  const text = await p.js(`document.querySelector('.page')?.innerText ?? ''`);
  await p.click('회의록만 다시 쓰기');
  const calls = await p.called('resumeMinutes');
  check('인터넷이 끊겨 멈춘 회의: 이유 안내와 "회의록만 다시 쓰기"(저장된 녹취로)', text.includes('인터넷 연결이 없어 회의록을 쓰지 못했습니다') && calls.length === 1 && calls[0][0] === p.dir, { calls });
});

suite('녹음 폴더 접근이 막혔을 때', { STUB_FOLDER: 'denied' }, async (p) => {
  await p.go('#meetings', 700);
  const text = await p.js(`document.querySelector('.page')?.innerText ?? ''`);
  await p.click('권한 열기');
  const opened = await p.called('permOpenSettings');
  check('폴더 접근이 막히면 빈 목록 대신 이유와 "권한 열기"', text.includes('녹음 폴더를 읽을 수 없습니다') && opened.length >= 1 && opened[0][0] === 'files', { text: text.slice(0, 80), opened });
});

suite('받아쓰기 · 원문 보기', { STUB_DICTS: '3' }, async (p) => {
  await p.go('#dictations', 700);
  const has = await p.js(`Boolean(document.querySelector('[aria-label="원문"]'))`);
  check('다듬기로 글이 바뀌지 않은 기록에는 원문 버튼이 없음', !has, '');
});

suite('회의 페이지 · 액션 할 일 체크', {}, async (p) => {
  fs.writeFileSync(path.join(p.dir, 'actions.json'), JSON.stringify({ actions: [
    { id: 'a1', task: 'QA 마치기', kind: 'assigned', owner: '화자 2', due: '월요일', at: '00:11', done: false },
    { id: 'a2', task: '배포 공지', kind: 'promise', owner: '화자 1', due: null, at: '00:40', done: false },
  ], advice: [] }));
  await p.js(`window.stubMeetingChanged(${JSON.stringify(p.id)})`);
  await p.go(`#meeting/${p.id}`, 900);
  await p.until(`[...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.startsWith('액션'))`);
  await p.click('액션', { sel: '[role=tab]' });
  await p.until(`document.querySelector('input[aria-label="QA 마치기 했음"]')`);
  const before = (await p.js(`document.querySelector('.page')?.innerText ?? ''`)).includes('0/2');
  const found = await p.js(`(() => { const c = document.querySelector('input[aria-label="QA 마치기 했음"]'); c?.click(); return Boolean(c); })()`);
  await p.wait(400);
  const calls = await p.called('toggleAction');
  check('액션 탭: 할 일 체크 → 그 할 일만 완료로 저장, 진행 수', (await p.tab())?.startsWith('액션') && calls.length === 1 && calls[0][1] === 'a1' && calls[0][2] === true && before && found, { tab: await p.tab(), before, found, calls });
});

// ══════════════════════ 실행 ══════════════════════
app.whenReady().then(async () => {
  for (const s of suites.filter((x) => !only || x.name.includes(only))) {
    let p = null;
    const before = results.length;
    try {
      p = await open(s.env.STUB_MEETING_DIR_NONE ? { ...s.env, STUB_MEETING_DIR: '' } : s.env);
      await s.run(p);
      const errs = p.errors.filter((e) => !/rec:\/\/|net::ERR|Autofill/.test(e));
      if (errs.length) check(`${s.name} · 화면 오류 없음`, false, errs.slice(0, 3).join(' | '));
    } catch (err) {
      check(`${s.name} · 실행`, false, err.stack?.split('\n').slice(0, 2).join(' ') ?? String(err));
    }
    if (results.length === before) check(`${s.name} · 확인한 것 없음`, false, '');
    if (p) {
      p.w.destroy();
      await wait(300);
    }
  }
  let fail = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${detail}`}`);
  }
  console.log(fail ? `기능 시험 실패 ${fail}건 / ${results.length}건` : `기능 시험 통과 (${results.length}건)`);
  app.exit(fail ? 1 : 0);
});
