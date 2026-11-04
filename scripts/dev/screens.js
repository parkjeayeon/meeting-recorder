// 화면 캡처: 가짜 데이터(stub-preload.js)로 메인 창을 숨긴 채 띄워 화면별 PNG를 남긴다. 실제 기록·설정은 건드리지 않는다.
//   npx electron scripts/dev/screens.js [출력 폴더]          → 홈·회의·회의 페이지·사전·통계·설정·엔진
//   OB_STEP=permissions npx electron scripts/dev/screens.js   → 처음 설정의 해당 단계
//   DARK=1 … 다크 모드
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'mr-screens'));
fs.mkdirSync(out, { recursive: true });
nativeTheme.themeSource = process.env.DARK ? 'dark' : 'light';
app.setName(`mr-screens-${process.pid}`); // 설치된 앱과 단일 실행 잠금이 겹치지 않게

// 예시 회의 폴더 (실제 회의 내용 대신)
const meeting = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-stub-')) + '/2026-11-01_23-00-00_meeting';
fs.mkdirSync(meeting, { recursive: true });
const lines = ['[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?', '[00:06] [화자 2] 네, 화요일 오전이 좋을 것 같아요.', '[00:11] [화자 1] QA는 월요일까지 끝낼 수 있죠?', '[00:15] [화자 2] 랩캐시도 쪽 확인만 하면 됩니다.'];
fs.writeFileSync(path.join(meeting, 'transcript.txt'), `${lines.join('\n')}\n`);
fs.writeFileSync(path.join(meeting, 'script-clean.txt'), `${lines.join('\n')}\n`);
fs.writeFileSync(path.join(meeting, 'minutes.md'), '# 예시 회의: 배포 일정 정리\n\n## 요약\n배포 일정과 QA 범위를 정리함.\n\n## 결정 사항\n- 배포는 화요일 오전 (00:06)\n- QA 범위는 결제·로그인·알림 세 가지로 좁히고, 나머지는 배포 뒤 모니터링으로 확인하기로 함. 일정이 밀리면 알림은 다음 배포로 넘김 (00:11).\n\n## 할 일\n- [ ] QA 마치기 — 담당: 화자 2, 기한: 월요일\n\n## 확인 필요\n- "랩캐시도"(00:15): Memcached로 추정됨\n');
fs.writeFileSync(path.join(meeting, 'review.json'), JSON.stringify({ items: [{ id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 관련 용어가 잘못 인식된 것으로 보임', status: 'open' }] }));
fs.writeFileSync(path.join(meeting, 'glossary.json'), JSON.stringify({ terms: [
  { id: 'g1', term: 'QA', note: '출시 전에 기능이 제대로 동작하는지 확인하는 품질 검사', basis: 'general', status: 'confirmed', source: 'llm', at: ['00:11'] },
  { id: 'g2', term: '알림', note: '앱 푸시 알림 기능. 이번 배포 범위에서 빠질 수 있음', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
  { id: 'g3', term: '랩캐시도', note: '회의에서 설명 없음', basis: 'unknown', status: 'suggested', source: 'llm', at: ['00:15'] },
] }));
process.env.STUB_MEETING_DIR = meeting;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => process.exit(1), 60000);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: +(process.env.W || 1240), height: +(process.env.H || 820), show: false, webPreferences: { preload: path.join(__dirname, 'stub-preload.js'), sandbox: false } });
  w.webContents.on('console-message', (e) => e.level === 'error' && console.log('CONSOLE', e.message));
  await w.loadFile(path.join(__dirname, '../../src/renderer/index.html'));
  const js = (c) => w.webContents.executeJavaScript(c);
  const shot = async (name) => {
    await wait(900);
    const file = path.join(out, `${name}${process.env.DARK ? '-dark' : ''}.png`);
    fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
    console.log('saved', file);
  };
  await wait(1500);
  if (process.env.OB_STEP) {
    await shot(`onboarding-${process.env.OB_STEP}`);
    process.exit(0);
  }
  const id = path.basename(meeting);
  for (const [name, code] of [
    ['home', "location.hash='#home'"],
    ['meetings', "location.hash='#meetings'"],
    ['meeting', `location.hash='#meeting/${id}'`],
    ['meeting-review', "[...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith('확인 필요'))?.click()"],
    ['meeting-chat', "[...document.querySelectorAll('.ritem button')].find(b=>b.textContent.includes('채팅'))?.click(); setTimeout(()=>{const t=document.querySelector('.chat textarea'); t.value='캐시 얘기였어요'; t.dispatchEvent(new Event('input')); t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));},100)"],
    ['meeting-chat-applied', "[...document.querySelectorAll('.proposal button')].find(b=>b.textContent==='적용')?.click()"],
    ['meeting-term', "document.querySelector('.chat-head .icon-btn')?.click(); setTimeout(()=>{[...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith('회의록'))?.click(); setTimeout(()=>document.querySelector('.doc .term.guess')?.click(), 300)}, 200)"],
    ['meeting-glossary', "document.querySelector('.term-card') && document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.getElementById('view').scrollTop=1e6"],
    ['dictionary', "location.hash='#dictionary'"],
    ['stats', "location.hash='#stats'"],
    ['settings', "document.getElementById('openSettings').click()"],
    ['settings-engine', "document.querySelector('.set-tab[data-sec=engine]').click()"],
  ]) {
    await js(code);
    await shot(name);
  }
  process.exit(0);
});
