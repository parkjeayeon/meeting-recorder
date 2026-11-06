// 질문으로 찾기 본체(src/ask.js) 시험: 지어낸 회의와 가짜 LLM으로 (토큰을 쓰지 않는다).
//   npx electron scripts/dev/ask-engine-check.js     (npm run test:crash, npm run dist가 빌드 전에 돌린다)
// 앱 데이터 폴더를 임시 폴더로 바꿔 실제 색인·질문 기록(asks.json)은 건드리지 않는다.
// 보는 것: 범위(최근 N개 그리고 기간), 질문 속 기간·상태, 기간 칩과 겹치지 않으면 LLM을 부르지 않고 멈춤,
// 두 글자 말 찾기(trigram은 세 글자부터), '주로 다룬'이면 잠깐 언급은 뺌, 색인은 바뀐 회의만 다시,
// 지운 회의는 색인에서도 빠짐, 여러 질문이 동시에, 캐시 끔(cache: false), 앱이 꺼질 때 돌던 질문은 중단으로 남음.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ask-'));
app.setPath('userData', path.join(tmp, 'userData'));
app.setName(`mr-ask-check-${process.pid}`);
app.dock?.hide();
fs.mkdirSync(app.getPath('userData'), { recursive: true });

// 지어낸 회의 (최신순으로 m1이 가장 최근)
const DAYS = { m1: '2026-11-05T10:00:00', m2: '2026-11-02T10:00:00', m3: '2026-10-10T10:00:00', m4: '2025-02-14T10:00:00', m5: '2025-02-03T10:00:00' };
const BODY = {
  m1: ['[00:05] [화자 1] 이번 배포는 화요일에 내보내죠', '[00:40] [화자 2] 롤백 계획도 같이 봐요'],
  m2: ['[00:05] [화자 1] 디자인 시안 보시죠', '[09:10] [화자 2] 아 그리고 지난주 장애 때문에 배포가 밀렸어요'],
  m3: ['[00:05] [화자 1] 채용 면접 일정을 정합시다', '[01:00] [화자 2] 지원자가 세 명입니다'],
  m4: ['[00:05] [화자 1] 부하 테스트 결과를 봅시다', '[02:00] [화자 2] 응답 시간이 느려요'],
  m5: ['[00:05] [화자 1] 장애 회고를 시작합니다', '[03:00] [화자 2] 서버가 멈췄던 원인은 메모리'],
};
const STATUS = { m1: 'open', m2: 'done', m3: 'done', m4: 'done', m5: 'draft' };
const dirs = {};
for (const id of Object.keys(DAYS)) {
  dirs[id] = path.join(tmp, 'rec', id);
  fs.mkdirSync(dirs[id], { recursive: true });
  fs.writeFileSync(path.join(dirs[id], 'transcript.txt'), `${BODY[id].join('\n')}\n`);
  fs.writeFileSync(path.join(dirs[id], 'minutes.md'), `# ${id}\n\n## 요약\n${id} 회의\n`);
}
let gone = new Set();
const meetings = () => Object.keys(DAYS).filter((id) => !gone.has(id)).map((id) => ({ id, dir: dirs[id], startedAt: new Date(DAYS[id]).toISOString(), title: `${id} 회의`, summary: null, status: STATUS[id] }));

// 가짜 LLM: 조건 풀기는 질문마다 정해 둔 답, 추리기는 후보 줄에 정해 둔 말이 있으면 고른다
const calls = [];
const CONDS = {
  '배포 회의': { from: null, to: null, status: null, focus: 'any', topic: '배포', terms: ['배포', '내보내', '롤백'] },
  '배포를 주로 다룬 회의': { from: null, to: null, status: null, focus: 'main', topic: '배포', terms: ['배포', '내보내', '롤백'] },
  '작년 2월 장애 회의': { from: '2025-02-01', to: '2025-02-28', status: null, focus: 'any', topic: '장애', terms: ['장애', '멈췄'] },
  '확인 안 끝난 회의': { from: null, to: null, status: ['open', 'draft'], focus: 'any', topic: null, terms: [] },
  '면접 회의': { from: null, to: null, status: null, focus: 'any', topic: '채용', terms: ['면접', '지원자'] },
  '실패': null,
};
const MAIN = { 배포: ['내보내'], 장애: ['장애 회고'], 채용: ['면접'] };
const MENTION = { 배포: ['밀렸'], 장애: ['장애 때문'] };
async function fakeComplete({ system, input, cache }) {
  calls.push({ kind: /turn a user's request/.test(system) ? 'parse' : 'judge', cache, input });
  await new Promise((r) => setTimeout(r, 30));
  if (/turn a user's request/.test(system)) {
    const q = /<request>([\s\S]*?)<\/request>/.exec(input)[1];
    if (CONDS[q] === null) throw new Error('시간 초과');
    return { text: JSON.stringify(CONDS[q]), provider: 'claude-code' };
  }
  const q = /<request>([\s\S]*?)<\/request>/.exec(input)[1];
  const topic = CONDS[q].topic;
  const results = [];
  for (const block of input.split(/\n(?=\[c\d+\])/)) {
    const id = /\[(c\d+)\]/.exec(block)?.[1];
    if (!id) continue;
    if ((MAIN[topic] ?? []).some((w) => block.includes(w))) results.push({ id, level: 'main', reason: '주로 다룸', quote: '' });
    else if ((MENTION[topic] ?? []).some((w) => block.includes(w))) results.push({ id, level: 'mention', reason: '잠깐 언급', quote: '' });
  }
  return { text: JSON.stringify({ results }), provider: 'claude-code' };
}
const cleanup = require('../../src/cleanup');
cleanup.complete = fakeComplete;
cleanup.providerStatus = async () => ({ 'claude-code': { installed: true, loggedIn: true }, codex: { installed: true, loggedIn: true }, api: { loggedIn: false } });
require.cache[require.resolve('../../src/dictation')] = { id: 'dictation', loaded: true, exports: { getSettings: () => ({ provider: 'codex', hasApiKey: false }), apiKey: () => null } };

setTimeout(() => {
  console.error('본체 시험 시간 초과');
  process.exit(1);
}, 60000);

app.whenReady().then(async () => {
  const ask = require('../../src/ask');
  const events = [];
  ask.init({ getMeetings: meetings, onChange: (j) => events.push(j) });
  const until = (id) => new Promise((resolve) => {
    const tick = () => {
      const j = ask.list().find((x) => x.id === id);
      if (j && j.status !== 'running') resolve(j);
      else setTimeout(tick, 20);
    };
    tick();
  });
  const run = async (q, scope = {}) => until(ask.start(q, scope).id);
  const ids = (j) => j.results.map((r) => `${r.id}:${r.level ?? '-'}`).join(' ');
  const results = [];
  const check = (name, ok, detail) => results.push([name, ok, detail]);

  // 주제: 주로 다룸·잠깐 언급, 두 글자 말(배포)도 찾고 최신순
  let j = await run('배포 회의');
  check('주제로 찾기 · 두 글자 말 · 최신순', ids(j) === 'm1:main m2:mention' && j.candidates === 2, `${ids(j)} · 후보 ${j.candidates}`);
  j = await run('배포를 주로 다룬 회의');
  check("'주로 다룬'이면 잠깐 언급은 뺌", ids(j) === 'm1:main', ids(j));
  // 범위: 최근 1개 그리고 기간
  j = await run('배포 회의', { count: 1 });
  check('최근 N개', ids(j) === 'm1:main', ids(j));
  j = await run('배포 회의', { from: '2026-11-01', to: '2026-11-03' });
  check('기간 칩', ids(j) === 'm2:mention', ids(j));
  j = await run('배포 회의', { count: 1, from: '2026-11-01', to: '2026-11-03' });
  check('최근 N개 그리고 기간 (AND)', j.results.length === 0 && j.status === 'done', `${ids(j) || '0건'}`);
  // 질문 속 기간
  j = await run('작년 2월 장애 회의');
  check('질문 속 기간', ids(j) === 'm5:main', ids(j));
  // 질문 속 기간과 기간 칩이 겹치지 않으면 추리기를 부르지 않고 멈춘다
  const judgeBefore = calls.filter((c) => c.kind === 'judge').length;
  j = await run('작년 2월 장애 회의', { from: '2026-10-31', to: '2026-11-06' });
  check('기간이 안 겹치면 멈춤', j.status === 'blocked' && calls.filter((c) => c.kind === 'judge').length === judgeBefore, `${j.status} · 추리기 ${calls.filter((c) => c.kind === 'judge').length - judgeBefore}번`);
  j = await run('작년 2월 장애 회의', { from: '2025-02-10', to: '' });
  check('겹치면 찾음 (둘 다 맞는 날만)', ids(j) === '', `${ids(j) || '0건'} (m5는 2/3이라 칩 밖)`);
  // 상태만 (찾을 말 없음): LLM 추리기 없이 목록
  const judge2 = calls.filter((c) => c.kind === 'judge').length;
  j = await run('확인 안 끝난 회의');
  check('상태만 묻는 질문', ids(j) === 'm1:- m5:-' && calls.filter((c) => c.kind === 'judge').length === judge2, ids(j));
  // 실패
  j = await run('실패');
  check('LLM 실패는 오류로', j.status === 'error' && j.error === '시간 초과', `${j.status} · ${j.error}`);
  // 동시에 여러 질문
  const [a, b] = await Promise.all([run('면접 회의'), run('배포 회의')]);
  check('여러 질문 동시에', ids(a) === 'm3:main' && ids(b) === 'm1:main m2:mention', `${ids(a)} | ${ids(b)}`);
  // 색인: 바뀐 회의만 다시 넣고, 지운 회의는 빠진다
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(app.getPath('userData'), 'search-index.sqlite'));
  const rowsOf = (id) => db.prepare('SELECT count(*) n FROM lines WHERE mid = ?').get(id).n;
  const m3Before = rowsOf('m3');
  fs.appendFileSync(path.join(dirs.m2, 'transcript.txt'), '[10:00] [화자 1] 면접은 내일입니다\n');
  fs.utimesSync(path.join(dirs.m2, 'transcript.txt'), new Date(), new Date(Date.now() + 5000));
  j = await run('면접 회의');
  check('바뀐 회의만 다시 색인', ids(j).includes('m2:main') && rowsOf('m3') === m3Before, `${ids(j)} · m3 줄 ${m3Before}→${rowsOf('m3')}`);
  gone = new Set(['m3']);
  j = await run('면접 회의');
  check('지운 회의는 색인에서 빠짐', !ids(j).includes('m3') && rowsOf('m3') === 0, `${ids(j)} · m3 줄 ${rowsOf('m3')}`);
  // 캐시 끔, 변하는 부분(질문)은 뒤에
  check('LLM 호출은 모두 캐시 끔', calls.every((c) => c.cache === false), `${calls.length}번 중 cache≠false ${calls.filter((c) => c.cache !== false).length}`);
  // 끝난 질문은 asks.json에 남고, 돌던 질문은 다음에 켤 때 중단으로
  const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'asks.json'), 'utf8'));
  check('질문 기록 저장', saved.length === ask.list().length && saved.every((x) => x.status !== 'running'), `${saved.length}개`);
  saved.push({ ...saved[0], id: 'zrun', status: 'running', stage: 'judge' });
  fs.writeFileSync(path.join(app.getPath('userData'), 'asks.json'), JSON.stringify(saved));
  delete require.cache[require.resolve('../../src/ask')];
  const ask2 = require('../../src/ask');
  ask2.init({ getMeetings: meetings, onChange: () => {} });
  const z = ask2.list().find((x) => x.id === 'zrun');
  check('꺼질 때 돌던 질문은 중단으로', z?.status === 'error' && /종료/.test(z.error), JSON.stringify(z && { status: z.status, error: z.error }));
  check('진행 소식을 화면에 보냄', events.some((e) => e.stage === 'judge') && events.some((e) => e.status === 'done'), `${events.length}번`);

  let failed = 0;
  for (const [name, ok, detail] of results) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  }
  console.log(failed ? `질문으로 찾기 본체 시험 실패 ${failed}건` : `질문으로 찾기 본체 시험 통과 (${results.length}건)`);
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
});
