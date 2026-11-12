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
fs.writeFileSync(path.join(meeting, 'review.json'), JSON.stringify({ items: [{ id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 관련 용어가 잘못 인식된 것으로 보임', status: 'open' }, { id: 'r2', kind: 'lost', at: '00:20', heard: null, note: '00:20~00:40 구간 녹음이 빠져 QA 범위 이야기 앞부분이 없음', status: 'open' }] }));
fs.writeFileSync(path.join(meeting, 'glossary.json'), JSON.stringify({ terms: [
  { id: 'g1', term: 'QA', note: '출시 전에 기능이 제대로 동작하는지 확인하는 품질 검사', basis: 'general', status: 'confirmed', source: 'llm', at: ['00:11'] },
  { id: 'g2', term: '알림', note: '앱 푸시 알림 기능. 이번 배포 범위에서 빠질 수 있음', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
  { id: 'g3', term: '랩캐시도', note: '회의에서 설명 없음', basis: 'unknown', status: 'suggested', source: 'llm', at: ['00:15'] },
] }));
// 흐름도 예시 (STUB_FLOW=<flow.json 경로>를 주면 그 파일로 바꿔 본다 — 실제 회의 내용이 찍히니 캡처를 저장소에 올리지 않는다)
fs.writeFileSync(path.join(meeting, 'flow.json'), process.env.STUB_FLOW ? fs.readFileSync(process.env.STUB_FLOW) : JSON.stringify({ flows: [{
  id: 'f1', title: '배포 절차', summary: 'QA를 마친 뒤 화요일에 배포하고 지켜보는 순서', lanes: [],
  steps: [
    { id: 's1', title: 'QA', detail: '결제·로그인·알림만 확인', at: '00:11', quote: 'QA는 월요일까지' },
    { id: 's2', title: '배포', detail: '화요일 오전에 배포', at: '00:06', quote: '화요일 오전이 좋을 것 같아요' },
    { id: 's3', title: '모니터링', detail: '나머지는 배포 뒤 확인', at: '00:15', quote: '확인만 하면 됩니다', optional: true },
  ],
  edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }],
  notes: [{ step: 's2', kind: 'warn', text: '일정이 밀리면\n알림은 다음 배포로', at: '00:11', quote: '알림은 다음 배포로' }],
  annotations: [],
}], handoff: null, reason: '배포 순서를 설명함' }));
// 액션 예시 (STUB_ACTIONS=<actions.json 경로>로 바꿔 본다 — 실제 회의 내용이 찍히니 캡처를 저장소에 올리지 않는다)
fs.writeFileSync(path.join(meeting, 'actions.json'), process.env.STUB_ACTIONS ? fs.readFileSync(process.env.STUB_ACTIONS) : JSON.stringify({
  kind: 'work', adviceTitle: '알아 둘 것',
  actions: [
    { id: 'a1', owner: '화자 2', task: 'QA 마치기', due: '월요일', kind: 'assigned', at: '00:11', quote: 'QA는 월요일까지', done: false },
    { id: 'a2', owner: '화자 1', task: '배포 일정 공지하기', due: null, kind: 'promise', at: '00:06', quote: '화요일 오전이 좋을 것 같아요', done: true },
    { id: 'a3', owner: '화자 2', task: '결제 화면 오류 재현 영상 공유하기', due: '내일', kind: 'promise', at: '00:15', quote: 'x', done: false },
    { id: 'a4', owner: '화자 1', task: '롤백 절차 문서 다시 확인하기', due: null, kind: 'assigned', at: '00:20', quote: 'x', done: false },
    { id: 'a5', owner: '화자 1', task: '다음 주부터 매일 배포 전 체크리스트 보기', due: '다음 주', kind: 'resolution', at: '00:24', quote: 'x', done: false },
  ],
  advice: [
    { id: 'v1', group: '배포', key: true, why: '일정이 밀리면 범위부터 줄여야 해서', from: '화자 1', to: '화자 2', text: '일정이 밀리면 알림은 다음 배포로 넘기기', at: '00:11', quote: 'x' },
    { id: 'v2', group: 'QA', key: false, why: null, from: '화자 1', to: '화자 2', text: '결제·로그인·알림만 먼저 확인하기', at: '00:15', quote: 'x' },
  ],
}));
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
    ['dictations', "location.hash='#dictations'"],
    ['meetings', "location.hash='#meetings'"],
    ['import-sheet', "[...document.querySelectorAll('.page-head .btn')].find(b=>b.textContent.includes('파일 가져오기'))?.click()"],
    ['meeting', `document.getElementById('importSheet').close(); location.hash='#meeting/${id}'`],
    ['meeting-find', "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'f',metaKey:true,bubbles:true})); setTimeout(()=>{const i=document.querySelector('.find-bar input'); i.value='배포'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));},100)"],
    ['meeting-find-closed', "document.querySelector('.find-bar input')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))"],
    ['meeting-review', "[...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith('확인 필요'))?.click()"],
    ['meeting-redo', "[...document.querySelectorAll('.ritem button')].find(b=>b.textContent.includes('구간 다시 받아쓰기'))?.click()"],
    ['meeting-redo-applied', "[...document.querySelectorAll('.redo-acts button')].find(b=>b.textContent.includes('녹취에 반영'))?.click()"],
    ['meeting-review-back', "document.querySelector('.chat-head .icon-btn')?.click()"],
    ['meeting-chat', "[...document.querySelectorAll('.ritem button')].find(b=>b.textContent.includes('채팅'))?.click(); setTimeout(()=>{const t=document.querySelector('.chat textarea'); t.value='캐시 얘기였어요'; t.dispatchEvent(new Event('input')); t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));},100)"],
    ['meeting-chat-applied', "[...document.querySelectorAll('.proposal button')].find(b=>b.textContent==='적용')?.click()"],
    ['meeting-review-done', "[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('처리함'))?.click()"],
    ['meeting-actions', "document.querySelector('.chat-head .icon-btn')?.click(); [...document.querySelectorAll('.tab')].find(t=>t.textContent.startsWith('액션'))?.click()"],
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
