// 옮긴 화면의 HTML이 main과 같은지 상태마다 찍어 비교한다 (docs/testing.md) — 회의 페이지(#view), 홈의 문제 알림, 위 막대·사이드바·회의 시작 창·가져오기 창, ⌘K 빠른 검색, 설정 창과 사이드바, 처음 설정(#onboard).
//   git worktree add --detach ~/.cache/mr-wt-main main && ln -s "$PWD/node_modules" ~/.cache/mr-wt-main/node_modules && (cd ~/.cache/mr-wt-main && npm run build:ts && npm run build:renderer)
//   npm run build:renderer && node scripts/dev/view-parity.js ~/.cache/mr-wt-main .work/parity/now [이름 일부]
// 같은 상태를 두 쪽에서 연달아 찍는다(가짜 기록의 시각이 지금 기준이라). 다르면 <이름>.diff를 남기고 끝에 실패로 끝난다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const electron = require('electron');

const here = path.join(__dirname, '../..');
const [base, out, only] = process.argv.slice(2);
if (!base || !out) throw new Error('쓰는 법: node scripts/dev/view-parity.js <main 작업 폴더> <결과 폴더> [이름 일부]');
fs.mkdirSync(out, { recursive: true });

const H = `const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const need = (x, what) => { if (!x) throw new Error('없음: ' + what); return x; };
const btn = (t, r = document) => need($$('button', r).find((b) => b.textContent.trim() === t || b.getAttribute('aria-label') === t), t);
const tab = (t) => need($$('.tabs .tab').find((b) => b.textContent.trim().startsWith(t)), '탭 ' + t).click();
const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const keep = (...ss) => { const b = document.createElement('div'); b.id = 'dumpbox'; b.innerHTML = ss.map((s) => need(document.querySelector(s), s).outerHTML).join(''); document.body.append(b); };
const settings = async (sec) => { need(document.getElementById('openSettings'), '설정').click(); await wait(); need($$('.set-tab').find((b) => b.dataset.sec === sec), '설정 ' + sec).click(); await wait(1200); };
const type = (s, v) => { const e = need(document.querySelector(s), s); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return e; };
const enter = (e) => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
`;
const M = { DUMP_MEETING: '1' };
const MANY = { STUB_MANY: '12', STUB_BUSY: '1' };
const at = (i) => `#meeting/2026-${['11-01', '10-31', '10-30', '', '10-28', '', '', '10-25', '10-24'][i]}_${String(i).padStart(2, '0')}-00-00_meeting`;
const BOX = { DUMP_SEL: '#dumpbox' };
const PAL = { DUMP_SEL: '#palette', STUB_DICTS: '3', STUB_HISTORY_DICTS: '1', STUB_MANY: '12' };
const OB = (step) => ({ OB_STEP: step, DUMP_SEL: '#onboard', DUMP_NO_MIC: '1' }); // 마이크 단계가 주변 소리에 따라 갈리지 않게
const SETTINGS = ['general', 'cleanup', 'meeting', 'engine', 'accounts', 'perms'].map((sec) => [`설정 · ${sec}`, BOX, `await settings('${sec}'); keep('#settings', '.side')`, '#home']);
const ONBOARDING = ['welcome', 'permissions', 'token', 'engine', 'account', 'mic', 'fnkey', 'practice', 'done'].map((step) => [`처음 설정 · ${step}`, OB(step), `await wait(1200)`, '#home']);
const STATES = [
  ['홈 · 기본', { STUB_DICTS: '3', STUB_MANY: '12', STUB_BUSY: '1' }, null, '#home'],
  ['홈 · 폴더 막힘', { STUB_FOLDER: 'denied' }, null, '#home'],
  ['빠른 검색 · 열기', PAL, `document.getElementById('openPalette').click(); await wait()`, '#home'],
  ['빠른 검색 · 회의 찾기', PAL, `document.getElementById('openPalette').click(); await wait(); type('#paletteInput', '배포'); await wait()`, '#home'],
  ['빠른 검색 · 받아쓰기 찾기', PAL, `document.getElementById('openPalette').click(); await wait(); type('#paletteInput', '받아쓴 글'); await wait()`, '#home'],
  ['빠른 검색 · 아래로 둘', PAL, `document.getElementById('openPalette').click(); await wait(); const i = document.getElementById('paletteInput'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); await wait()`, '#home'],
  ['빠른 검색 · 없음', PAL, `document.getElementById('openPalette').click(); await wait(); type('#paletteInput', 'zzqx'); await wait()`, '#home'],
  ['껍데기 · 위 막대', { DUMP_SEL: '.topbar' }, null, '#home'],
  ['껍데기 · 사이드바 기록 많음', { DUMP_SEL: '.side', STUB_DICTS: '3', STUB_HISTORY_DICTS: '1', STUB_MANY: '12' }, null, '#home'],
  ['껍데기 · 회의 시작 창', { DUMP_SEL: '#meetStart' }, `document.getElementById('meetingBtn').click(); await wait()`, '#home'],
  ['껍데기 · 회의 시작 창 4명 화상', { DUMP_SEL: '#meetStart' }, `document.getElementById('meetingBtn').click(); await wait(); need(document.querySelector('#startSpeakers [data-n="4"]'), '4명').click(); need(document.querySelector('#startKind [data-kind="online"]'), '화상').click(); await wait()`, '#home'],
  ['껍데기 · 가져오기 창', { DUMP_SEL: '#importSheet' }, `btn('파일 가져오기').click(); await wait(1000)`, '#meetings'],
  ...SETTINGS,
  ['설정 · 사이드바만', BOX, `keep('.side')`, '#home'],
  ['설정 · 언어 바꾸기', BOX, `const sel = need(document.getElementById('sideLanguage'), '언어'); sel.value = 'en'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1000); await settings('general'); keep('#settings', '.side', '#toasts')`, '#home'],
  ['설정 · 다듬기 Codex 고르기', BOX, `await settings('cleanup'); need(document.querySelector('input[name=provider][value=codex]'), 'codex').click(); await wait(1000); keep('#settings', '.side')`, '#home'],
  ['설정 · 회의 녹취 언어', BOX, `await settings('meeting'); const sel = need(document.getElementById('meetLanguage'), '회의 언어'); sel.value = 'ja'; sel.dispatchEvent(new Event('change', { bubbles: true })); await wait(1000); keep('#settings', '.side')`, '#home'],
  ['설정 · 토큰 보기', BOX, `await settings('accounts'); need(document.querySelector('.conn-block[data-kind=hf] [data-toggle]'), '토큰 보기').click(); await wait(); keep('#settings')`, '#home'],
  ['설정 · 폴더 막힘 사이드바', { ...BOX, STUB_FOLDER: 'denied' }, `await settings('perms'); keep('#settings', '.side')`, '#home'],
  ...ONBOARDING,
  ['처음 설정 · welcome 다음', OB('welcome'), `await wait(1200); btn('시작하기').click(); await wait(1200)`, '#home'],
  ['처음 설정 · 토큰 쓰기', OB('token'), `await wait(1200); type('#onboard input', 'hf_test'); await wait()`, '#home'],
  ['처음 설정 · 연습 쓰기', OB('practice'), `await wait(1200); type('#onboard textarea', '안녕하세요'); await wait()`, '#home'],
  ['회의록', M],
  ['확인 필요 탭', M, `tab('확인 필요')`],
  ['액션 탭', M, `tab('액션')`],
  ['정리본 탭', M, `tab('정리본')`],
  ['원본 탭', M, `tab('원본')`],
  ['화자 탭', M, `tab('화자')`],
  ['더 보기 메뉴', M, `btn('더 보기').click()`],
  ['다시 만들기 메뉴', M, `btn('다시 만들기').click()`],
  ['확인됨', M, `tab('확인 필요'); await wait(); btn('확인됨').click()`],
  ['그대로 두기', M, `tab('확인 필요'); await wait(); btn('그대로 두기').click()`],
  ['적용', M, `tab('확인 필요'); await wait(); btn('적용').click()`],
  ['처리함', M, `tab('확인 필요'); await wait(); btn('확인됨').click(); await wait(); need($$('.chip').find((b) => b.textContent.startsWith('처리함')), '처리함').click()`],
  ['고치기 줄', M, `tab('확인 필요'); await wait(); btn('확인됨').click(); await wait(); need($$('.chip').find((b) => b.textContent.startsWith('처리함')), '처리함').click(); await wait(); btn('고치기').click()`],
  ['되돌리기', M, `tab('확인 필요'); await wait(); btn('적용').click(); await wait(); need($$('.chip').find((b) => b.textContent.startsWith('처리함')), '처리함').click(); await wait(); btn('되돌리기').click()`],
  ['하나 고르기', M, `tab('확인 필요'); await wait(); need(document.querySelector('[aria-label="고르기"]'), '고르기').click()`],
  ['모두 고르기', M, `tab('확인 필요'); await wait(); need(document.querySelector('[aria-label="모두 고르기"]'), '모두 고르기').click()`],
  ['채팅 열기', M, `tab('확인 필요'); await wait(); btn('채팅').click()`],
  ['여러 개 채팅', M, `tab('확인 필요'); await wait(); need(document.querySelector('[aria-label="모두 고르기"]'), '모두 고르기').click(); await wait(); btn('채팅으로 확인').click()`],
  ['채팅 보내기', M, `tab('확인 필요'); await wait(); btn('채팅').click(); await wait(); enter(type('textarea', '랩캐시도가 뭐였죠')); await wait(1500)`],
  ['구간 다시 받아쓰기', M, `tab('확인 필요'); await wait(); need(document.querySelector('[title="이 구간만 녹음에서 다시 받아씁니다"]'), '구간').click(); await wait(1500)`],
  ['확인 마치기', M, `tab('확인 필요'); await wait(); need(document.querySelector('#view .review .btn.primary, #view .btn.primary'), '확인 마치기').click(); await wait(1000)`],
  ['할 일 체크', M, `tab('액션'); await wait(); need(document.querySelector('#view input[type=checkbox]'), '체크').click()`],
  ['화자 탭 이름 바꾸기', M, `tab('화자'); await wait(); need(document.querySelector('.spk-list button, .spk-list [role=button]'), '화자 이름').click()`],
  ['화자 칩 이름 바꾸기', M, `need(document.querySelector('.spk-chip'), '화자 칩').click()`],
  ['찾기 막대', { ...M, DUMP_SEL: '.panel' }, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true })); await wait(); type('.find-bar input', '배포')`],
  ['용어 카드', { ...M, DUMP_SEL: '#dumpbox' }, `need(document.querySelector('.gl-item'), '용어').click(); await wait(); keep('.term-card')`],
  ['정리하기', { ...M, DUMP_NO_REVIEW: '1' }],
  ['흐름도·액션 없음', { DUMP_MEETING: 'plain' }],
  ['인터넷 끊김', { ...M, STUB_MINUTES: 'offline' }],
  ['지워진 회의', MANY, null, '#meeting/2026-01-01_00-00-00_meeting'],
  ['받아쓰는 중', MANY, null, at(1)],
  ['쓰는 중', MANY, null, at(2)],
  ['차례 기다림', MANY, null, at(4)],
  ['실패', MANY, null, at(7)],
  ['짧은 녹음', MANY, null, at(8)],
  ['압축 안내', MANY, null, at(0)],
  ['압축 안내 그대로 두기', MANY, `btn('그대로 두기').click()`, at(0)],
];

// 찍을 때마다 바뀌는 값: 흐름도 화살표 id, 창마다 새로 섞이는 마이크 장치 id, 지금 시각 기준인 사용 한도 초기화 시각, 실제 마이크 소리를 따르는 처음 설정 막대(on)
const norm = (s) => s
  .replace(/fl-arrow-([a-z0-9]+)-[a-z0-9]+/g, 'fl-arrow-$1-X')
  .replace(/<option value="[0-9a-f]{64}">/g, '<option value="DEVICE">')
  .replace(/\d\d:\d\d 초기화/g, 'HH:MM 초기화')
  .replace(/<i class="(on)?">/g, '<i>')
  // 손으로 쓴 index.html의 들여쓰기(줄바꿈이 든 공백만): React는 만들지 않고 화면에도 안 보인다(사용자 결정, 결정 66). 띄어쓰기 한 칸은 그대로 비교
  .replace(/>[ \t]*\n\s*</g, '><')
  .replace(/></g, '>\n<');
const shoot = (root, name, env, js, hash, file) => {
  const e = { ...process.env, ...env, ROOT: root, ...(js ? { DUMP_JS: H + js } : {}) };
  try {
    execFileSync(electron, [path.join(here, 'scripts/dev/dump-view.js'), hash, file], { env: e, stdio: 'pipe', timeout: 70000 });
  } catch (err) {
    fs.writeFileSync(file, `찍지 못함: ${String(err.stdout ?? '')}${String(err.stderr ?? '')}`);
  }
  return norm(fs.readFileSync(file, 'utf8'));
};

let bad = 0;
for (const [name, env, js, hash = '#meeting/{id}'] of STATES) {
  if (only && !name.includes(only)) continue;
  const f = (side) => path.join(out, `${name.replaceAll(' ', '_')}.${side}.html`);
  const a = shoot(base, name, env, js, hash, f('base'));
  const b = shoot(here, name, env, js, hash, f('after'));
  const lines = b.split('\n').length;
  if (a === b && !a.startsWith('찍지 못함')) {
    console.log(`✓ ${name} (${lines}줄)`);
    continue;
  }
  bad++;
  let d = '';
  try {
    execFileSync('diff', [f('base'), f('after')]);
  } catch (err) {
    d = String(err.stdout);
  }
  fs.writeFileSync(path.join(out, `${name.replaceAll(' ', '_')}.diff`), d);
  console.log(`✗ ${name} — ${a.startsWith('찍지 못함') ? a.slice(0, 200) : b.startsWith('찍지 못함') ? b.slice(0, 200) : `다름 (${d.split('\n').length}줄 diff)`}`);
}
console.log(bad ? `다른 상태 ${bad}개 — ${out}` : '모든 상태가 main과 같음');
process.exit(bad ? 1 : 0);
