// 화면 확인용 가짜 recorderApi. 메인 프로세스 없이 src/renderer/index.html만 띄워 화면을 본다.
// src/preload.js의 함수 이름을 그대로 읽어 같은 모양을 만들고, 몇 가지만 예시 데이터를 돌려준다.
// 녹음·fn·권한·설치는 실제로 하지 않는다. 예시 회의는 STUB_MEETING_DIR(scripts/dev/screens.js가 만든 임시 폴더)에서 읽는다.
const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');

// 화면은 Vite로 묶은 lib/renderer/main.js다. 없으면 빈 화면으로 시험이 엉뚱하게 실패하므로 크게 알린다
if (!fs.existsSync(path.join(__dirname, '../../lib/renderer/main.js'))) console.error('[화면 묶음 없음] npm run build:renderer 를 먼저 돌리세요 (lib/renderer/main.js)');
const dir = process.env.STUB_MEETING_DIR;
const read = (f) => {
  try {
    return fs.readFileSync(path.join(dir, f), 'utf8');
  } catch {
    return null;
  }
};
// STUB_FOLDER=denied: macOS가 녹음 폴더 접근을 막은 상태 · STUB_MINUTES=offline: 인터넷이 끊겨 회의록 쓰기에서 멈춘 상태
const denied = process.env.STUB_FOLDER === 'denied';
const minutes = process.env.STUB_MINUTES === 'offline'
  ? { status: 'error', stage: 'write', offline: true, error: 'fetch failed', speakers: 2 }
  : { status: 'done', title: '예시 회의: 배포 일정 정리', speakers: 2, provider: 'claude-code' };
const meeting = dir && !denied && {
  id: path.basename(dir), dir, mode: 'meeting', startedAt: '2026-11-01T14:00:00Z', durationSec: 1800, tracks: ['mic'], firstFile: 'mic.wav',
  minutes,
  summary: '배포 일정과 QA 범위를 정리한 예시 회의입니다.',
  review: { open: 1, total: 1, finalized: false },
};
// 재생 막대용 예시: 두 사람이 번갈아 말하고, 10:00~11:20은 말소리는 있는데 녹취가 없는 구간
const stubSpeech = () => {
  const turns = [];
  for (let t = 2, k = 0; t < 1790; k++) {
    const len = 8 + ((k * 37) % 50);
    turns.push({ start: t, end: t + len, who: k % 3 === 2 ? '화자 2' : '화자 1' });
    t += len + 1 + (k % 4);
  }
  return { turns, missing: [{ start: 600, end: 680 }, { start: 1340, end: 1360 }] };
};
const noop = () => {};
let meetingChangedCb = noop;
const impl = {
  info: async () => ({ recordingsDir: '/Users/me/Documents/MeetingRecorder', defaultRecordingsDir: '/Users/me/Documents/MeetingRecorder' }),
  history: async () => {
    const memos = process.env.STUB_HISTORY_DICTS ? dicts.slice(0, 30) : []; // 실제 본체처럼 최근 받아쓰기도 같이 (홈 캡처용)
    if (!meeting) return [...manyMeetings(Number(process.env.STUB_MANY) || 0), ...memos];
    const items = JSON.parse(read('review.json') ?? '{"items":[]}').items;
    const first = { ...meeting, review: { open: items.filter((it) => it.status === 'open').length, total: items.length, finalized: false } };
    return [first, ...manyMeetings(Number(process.env.STUB_MANY) || 0), ...memos];
  },
  // 확인 필요 채팅: 늘 같은 제안을 돌려주고, 적용하면 review.json의 상태를 바꾼다
  // '띄어쓰기'가 든 말에는 녹취에서 그대로 찾지 못한 제안(unmatched)을 돌려준다 — 예전에는 조용히 버려 적용 버튼이 없었다
  chatReview: async (_d, ids, messages) => (/외부/.test(messages.at(-1)?.text ?? '')
    ? { text: '외부 분으로 확정하겠습니다.', proposals: [{ id: ids[0], resolve: '외부 개발자, 이름은 그대로' }], unmatched: [] }
    : /띄어쓰기/.test(messages.at(-1)?.text ?? '')
    ? { text: '"랩 캐시 도"는 **Memcached**로 보입니다.', proposals: [], unmatched: [{ id: ids[0], heard: '랩 캐시 도', guess: 'Memcached' }] }
    : { text: '"랩캐시도"는 **Memcached**로 보입니다.', proposals: [{ id: 'r1', heard: '랩캐시도', guess: 'Memcached' }] }),
  applyReview: async (_dir, fixes) => {
    calls.applyReview = [...(calls.applyReview ?? []), fixes];
    const review = JSON.parse(read('review.json'));
    for (const f of fixes) Object.assign(review.items.find((it) => it.id === f.id), f.keep ? { status: 'kept' } : f.resolve ? { status: 'resolved', resolution: f.resolve } : { status: 'applied', applied: f.guess, count: 1 });
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return review;
  },
  pickAudio: async () => ({
    files: [
      { path: '/Users/me/Downloads/2026-11-01 오후 2.00.00 녹음.m4a', name: '2026-11-01 오후 2.00.00 녹음.m4a', durationSec: 1752 },
      { path: '/Users/me/Downloads/2026-11-01 오후 2.30.00 녹음.m4a', name: '2026-11-01 오후 2.30.00 녹음.m4a', durationSec: 1081 },
    ],
    guess: { at: new Date(2026, 10, 1, 14, 0).toISOString(), source: process.env.STUB_GUESS ?? 'name' },
  }),
  importMeeting: async (paths, opts) => {
    calls.importMeeting = opts;
    return { id: 'x', count: paths.length };
  },
  recordingsAccess: async () => (denied ? { ok: false, dir: '/Users/me/Documents/MeetingRecorder', code: 'EPERM' } : { ok: true }),
  dictSettings: async () => ({ ...dictStore }),
  dictSaveSettings: async (patch) => {
    calls.dictSave = [...(calls.dictSave ?? []), patch];
    Object.assign(dictStore, patch);
    return { ...dictStore };
  },
  providers: async () => ({ 'claude-code': { installed: true, loggedIn: true, account: 'me@example.com' }, codex: { installed: true, loggedIn: true, account: 'me@example.com' }, api: { installed: true, loggedIn: false } }),
  permStatus: async () => ({ microphone: 'granted', inputMonitoring: process.env.OB_STEP === 'permissions' ? 'denied' : 'granted', accessibility: 'granted', systemAudio: 'granted' }),
  fnKeyWarning: async () => null,
  tokenStatus: async () => ({ hf: { cli: true }, anthropic: {} }),
  verifyToken: async () => ({ ok: true, message: '예시 계정 · 화자 구분 모델 사용 가능' }),
  readMinutes: async () => ({ minutes: read('minutes.md'), transcript: read('transcript.txt'), scriptClean: read('script-clean.txt'), review: JSON.parse(read('review.json') ?? 'null'), glossary: JSON.parse(read('glossary.json') ?? 'null'), speech: stubSpeech(), flow: JSON.parse(read('flow.json') ?? 'null'), actions: JSON.parse(read('actions.json') ?? 'null') }),
  redoRange: async (_dir, id, start, end) => {
    calls.redoRange = [...(calls.redoRange ?? []), { id, start, end }];
    const review = JSON.parse(read('review.json'));
    const lines = [{ start: start + 2, end: start + 9, text: '그 부분은 로그를 심어서 확인할 예정입니다.', label: '화자 2' }, { start: start + 11, end: start + 18, text: '네, 알겠습니다.', label: '화자 1' }];
    review.items.find((it) => it.id === id).redo = { start, end, lines, gain: 3.2 };
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    const mmss = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
    return { start, end, gain: 3.2, empty: false, text: lines.map((l) => `[${mmss(l.start)}] [${l.label}] ${l.text}`).join('\n') };
  },
  applyRedo: async (_dir, id) => {
    const review = JSON.parse(read('review.json'));
    Object.assign(review.items.find((it) => it.id === id), { status: 'applied', applied: '구간 다시 받아씀', count: 2 });
    review.items.find((it) => it.id === id).redo.appliedAt = new Date().toISOString();
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return review;
  },
  updateTerm: async (_dir, id, patch) => {
    const g = JSON.parse(read('glossary.json'));
    for (const t of g.terms) if (id === '*' || t.id === id) Object.assign(t, patch.status ? { status: patch.status } : {}, patch.note ? { note: patch.note, edited: true, status: 'confirmed' } : {});
    if (patch.remove) g.terms = g.terms.filter((t) => t.id !== id);
    fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify(g));
    return g;
  },
  // 회의 파일이 바뀐 소식 (화면 시험이 window.stubMeetingChanged(id)로 보낸다 — 시험 중에 파일을 바꾼 뒤 다시 읽게)
  onMeetingChanged: (cb) => (meetingChangedCb = cb),
  // 흐름도 SVG 저장: 저장 창 없이 받은 내용을 기록한다
  saveFlowSvg: async (name, svg) => {
    calls.saveSvg = { name, svg };
    return `/tmp/stub/${name}.svg`;
  },
  // ── 기능 시험(scripts/dev/feature-test.js)이 쓰는 흉내: 회의 폴더(STUB_MEETING_DIR)의 파일을 실제로 바꾼다 ──
  setReviewStatus: async (_d, ids, status) => {
    const review = JSON.parse(read('review.json'));
    for (const it of review.items) if (ids.includes(it.id)) it.status = status;
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return review;
  },
  revertReview: async (_d, id) => {
    const review = JSON.parse(read('review.json'));
    const it = review.items.find((x) => x.id === id);
    if (it.failRevert) throw new Error('되돌릴 기록이 없습니다'); // 화면 시험이 오류 알림을 띄우려고 표시한 항목
    Object.assign(it, { status: 'open' });
    delete it.applied;
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return { review, removedWord: null, ...(it.cascade ? { reapplied: it.cascade } : {}) }; // cascade: 같은 줄을 나중에 고쳐 다시 적용된 항목(기능 시험용)
  },
  finalizeReview: async () => {
    const review = JSON.parse(read('review.json'));
    for (const it of review.items) if (it.status === 'open') it.status = 'kept';
    review.finalizedAt = new Date().toISOString();
    review.finalize = { rewritten: false };
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return review;
  },
  toggleTodo: async (_d, index, checked) => {
    let n = -1;
    const md = read('minutes.md').replace(/^(\s*- )\[( |x)\]/gim, (m, pre) => (++n === index ? `${pre}[${checked ? 'x' : ' '}]` : m));
    fs.writeFileSync(path.join(dir, 'minutes.md'), md);
    return md;
  },
  updateTerm: async (_d, termId, patch) => {
    const g = JSON.parse(read('glossary.json') ?? '{"terms":[]}');
    if (patch.remove) g.terms = g.terms.filter((t) => t.id !== termId);
    else Object.assign(g.terms.find((t) => t.id === termId) ?? {}, patch);
    fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify(g));
    return g;
  },
  deleteDictation: async (id) => {
    const i = dicts.findIndex((r) => r.id === id);
    if (i >= 0) dicts.splice(i, 1);
    return true;
  },
  repaste: async () => 'pasted',
  // 오래 걸리는 LLM 작업 흉내 (화면 테스트가 진행 중 표시·중복 실행을 본다)
  makeActions: async () => {
    calls.makeActions = (calls.makeActions ?? 0) + 1;
    await new Promise((r) => setTimeout(r, +(process.env.STUB_JOB_MS || 2500)));
    return JSON.parse(read('actions.json') ?? '{"actions":[],"advice":[]}');
  },
  // 흐름도 만들기·다시 그리기도 오래 걸린다 (버튼의 '… 중'과 입력칸 막힘을 본다). 그릴 흐름은 찾지 못한 것으로
  makeFlow: async (_dir, focus) => {
    calls.makeFlow = [...(calls.makeFlow ?? []), focus];
    await new Promise((r) => setTimeout(r, +(process.env.STUB_JOB_MS || 2500)));
    return { flows: [], handoff: null, reason: '가짜 엔진은 흐름을 그리지 않습니다' };
  },
  remakeFlow: async (_dir, flowId) => {
    calls.remakeFlow = [...(calls.remakeFlow ?? []), flowId];
    await new Promise((r) => setTimeout(r, +(process.env.STUB_JOB_MS || 2500)));
    return JSON.parse(read('flow.json') ?? 'null');
  },
  // 목록에 안 나오는 폴더 예시 (날짜를 잘못 읽은 가져오기 둘, 끊긴 녹음 하나). STUB_STRAY=none이면 없음
  strayFolders: async () => (process.env.STUB_STRAY === 'none' ? [] : strays.filter((f) => !calls.trashed?.includes(f.dir))),
  trashMeeting: async (d) => {
    calls.trashed = [...(calls.trashed ?? []), d];
  },
  // 확인 필요 직접 추가 흉내: 요청을 기억하고 항목 하나를 더한다
  addReview: async (_d, request) => {
    calls.addReview = request;
    const review = JSON.parse(read('review.json') ?? '{"items":[]}');
    review.items.push({ id: `r${review.items.length + 1}`, kind: 'word', at: '00:02', heard: '배포', heardNote: '배포', guess: '릴리스', note: '사용자가 짚은 말', status: 'open', source: 'user', request });
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return { added: [review.items.at(-1).id], reply: '00:02의 "배포"를 항목으로 더했습니다.' };
  },
  // 사용 한도 예시 (Claude Code: 세션·주간·모델 주간, Codex: 주간 + 크레딧). 몇 번 불렸는지 센다
  dictPage: async ({ q = '', before = null, limit = 50 } = {}) => {
    calls.dictPage = [...(calls.dictPage ?? []), { q, before, limit }];
    const matched = q ? dicts.filter((r) => `${r.transcript.text} ${r.app}`.toLowerCase().includes(q.toLowerCase())) : dicts;
    const start = before ? matched.findIndex((r) => r.id === before) + 1 : 0;
    const items = matched.slice(start, start + limit);
    return { items, total: dicts.length, matched: matched.length, next: start + limit < matched.length ? items.at(-1).id : null };
  },
  dictStats: async () => {
    if (!dicts.length) return null;
    const by = (key) => [...dicts.reduce((m, r) => m.set(key(r), [(m.get(key(r))?.[0] ?? 0) + r.chars, (m.get(key(r))?.[1] ?? 0) + 1]), new Map())];
    return {
      count: dicts.length, total: dicts.reduce((n, r) => n + r.chars, 0), today: 0, todayCount: 0, wpm: 120, streak: 3,
      days: Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10), chars: 10 * i, count: i })),
      apps: by((r) => r.app).map(([app, [chars]]) => ({ app, chars })),
      languages: by((r) => r.language).sort((a, b) => b[1][0] - a[1][0]).map(([language, [chars, count]]) => ({ language, chars, count })),
      asrMs: 300, cleanup: [{ provider: 'claude-code', avgMs: 2500, count: dicts.length }],
    };
  },
  compressMeeting: async (d) => {
    calls.compress = [...(calls.compress ?? []), d];
    compressedIds.add(d);
    return { before: 689e6, after: 86e6 };
  },
  declineCompress: async (d, declined) => {
    calls.decline = [...(calls.decline ?? []), [d, declined]];
    declinedIds.add(d);
  },
  askStart: async (question, scope) => {
    calls.askStart = [...(calls.askStart ?? []), { question, scope }];
    return stubAsk(question, scope);
  },
  askList: async () => [...askJobs.values()].map((j) => ({ ...j })),
  askStop: async (id) => {
    const j = askJobs.get(id);
    if (j?.status === 'running') Object.assign(j, { status: 'stopped', stage: 'stopped', ms: Date.now() - j.t0 });
    calls.askStop = [...(calls.askStop ?? []), id];
  },
  askRemove: async (id) => {
    askJobs.delete(id);
    calls.askRemove = [...(calls.askRemove ?? []), id];
  },
  askSeen: async (id) => {
    const j = askJobs.get(id);
    if (j) j.seen = true;
  },
  onAsk: (cb) => (askCb = cb),
  usage: async ({ force = false } = {}) => {
    calls.usage = [...(calls.usage ?? []), force];
    const at = (h) => new Date(Date.now() + h * 3600e3).toISOString();
    return {
      'claude-code': { ok: true, via: 'rule', fetchedAt: new Date(Date.now() - 120e3).toISOString(), credits: null, windows: [
        { kind: 'session', model: null, usedPercent: 15, resetsAt: at(3), resetsText: null },
        { kind: 'week', model: null, usedPercent: 85, resetsAt: at(50), resetsText: null },
        { kind: 'model-week', model: 'Fable', usedPercent: 3, resetsAt: at(50), resetsText: null },
      ] },
      codex: { ok: true, via: 'json', fetchedAt: new Date().toISOString(), credits: '120.5', windows: [{ kind: 'week', model: null, usedPercent: 16, resetsAt: at(100), resetsText: null }] },
    };
  },
  copy: async (text) => {
    calls.copied = text;
  },
  onboardingGet: async () => ({ completed: !process.env.OB_STEP, step: process.env.OB_STEP || 'done' }),
  setupStatus: async () => [
    { id: 'engine', name: '음성 인식 엔진', desc: 'whisper.cpp (Homebrew로 설치)', installed: true, size: null, removable: false },
    { id: 'turbo', name: '받아쓰기 모델', desc: 'Whisper large-v3-turbo', installed: true, size: 834e6, removable: true },
    { id: 'large', name: '회의 모델', desc: 'Whisper large-v3', installed: false, size: 3.1e9, removable: true, job: { running: true, pct: 0.4, text: '1240MB / 3095MB' } },
    { id: 'diarize', name: '화자 구분', desc: 'pyannote', installed: true, size: 1.17e9, removable: true },
  ],
};
const calls = {};
// 회의 녹음 압축 흉내: 압축한 회의·그대로 두기를 고른 회의
const compressedIds = new Set();
const declinedIds = new Set();
// STUB_DICTS=75: 받아쓰기 기록 (최신순, 다섯에 하나는 영어, 70번째에만 '배포' — 첫 묶음 밖의 기록도 찾는지)
const dicts = Array.from({ length: Number(process.env.STUB_DICTS) || 0 }, (_, i) => {
  const text = i === 70 ? '오래된 배포 메모입니다' : `받아쓴 글 ${i}번입니다`;
  const r = { id: `d${String(i).padStart(4, '0')}`, mode: 'memo', startedAt: new Date(Date.now() - i * 5 * 3600e3).toISOString(), durationSec: 4, app: i % 2 ? 'Slack' : 'Notes', chars: text.length, wpm: 120, language: i % 5 === 0 ? 'en' : 'ko', transcript: { raw: text, text, cleanupProvider: 'claude-code', timing: { transcribeMs: 300, cleanupMs: 2500 } } };
  // STUB_DICT_EDITS=1: 앞의 셋은 다듬기가 고친 기록 (조금 고침 → 교정 부호, 많이 고침, 다듬기 실패)
  const edit = process.env.STUB_DICT_EDITS && [
    { raw: '음 다음 주에 배포 일정 잡아 주세요', text: '다음 주에 배포 일정을 잡아 주세요.' },
    { raw: '배포 그거', text: '배포 일정은 화요일 오전으로 정하고, QA는 월요일까지 마칩니다.' },
    { raw: text, text: undefined, cleanupError: '시간 초과' },
  ][i];
  if (edit) Object.assign(r.transcript, edit);
  return r;
});
const dictStore = { enabled: true, language: 'ko', meetingLanguage: 'ko', cleanup: true, provider: 'auto', vocabulary: 'PJY, Whisper', minutes: true, diarize: true, diarizeReady: true, hasHfToken: true, meetingSystemAudio: false, engine: { state: 'ready' } };
// 질문으로 찾기 흉내 (LLM 없이): 단계를 짧게 지나 끝난다. "작년"이 든 질문에 올해 기간 칩을 주면 기간이 겹치지 않아 멈춘다.
// "실패"가 든 질문은 오류로 끝난다. 결과는 예시 회의에서 고른다 (첫 회의는 주로 다룸, 둘째는 잠깐 언급)
const askJobs = new Map();
let askCb = noop;
const ASK_MS = Number(process.env.STUB_ASK_MS) || 300;
function stubAsk(question, scope) {
  const y = new Date().getFullYear();
  const job = { id: `a${askJobs.size + 1}`, q: question, scope, status: 'running', stage: 'parse', t0: Date.now(), ms: null, conds: null, results: [], candidates: 0, seen: false, error: null };
  askJobs.set(job.id, job);
  // '소식없음'이 든 질문은 끝난 소식을 보내지 않는다 (화면이 스스로 본체와 맞추는지), '느린'은 단계마다 10배
  const quiet = /소식없음/.test(question);
  const slow = /느린/.test(question) ? 10 : 1;
  const step = (fn, ms) => setTimeout(() => { if (askJobs.has(job.id) && job.status === 'running') { fn(); if (!(quiet && job.status !== 'running')) askCb({ ...job }); } }, ms * slow);
  const lastYear = /작년/.test(question);
  // '로그인'이 든 질문은 조건 풀기에서 로그인 오류로 끝난다 (CLI가 낸 이유가 화면에 그대로 가는지)
  if (/로그인/.test(question)) return step(() => Object.assign(job, { status: 'error', stage: 'error', provider: 'claude-code', error: 'Invalid API key · Please run /login', errorKind: 'login', ms: Date.now() - job.t0 }), ASK_MS), { ...job };
  step(() => {
    job.conds = { from: lastYear ? `${y - 1}-01-01` : null, to: lastYear ? `${y - 1}-12-31` : null, status: null, focus: 'any', topic: '배포', terms: ['배포', '릴리스'] };
    if (lastYear && scope.from && scope.from > `${y - 1}-12-31`) Object.assign(job, { status: 'blocked', stage: 'blocked', ms: Date.now() - job.t0 });
    else job.stage = 'search';
  }, ASK_MS);
  step(() => { if (job.status === 'running') Object.assign(job, { stage: 'judge', candidates: 3 }); }, ASK_MS * 2);
  step(() => {
    if (job.status !== 'running') return;
    if (/실패/.test(question)) return Object.assign(job, { status: 'error', stage: 'error', error: '시간 초과', ms: Date.now() - job.t0 });
    const ids = [meeting, ...manyMeetings(Number(process.env.STUB_MANY) || 0)].filter(Boolean).map((m) => m.id);
    job.results = [{ id: ids[0], level: 'main', reason: '배포 일정을 정한 회의', quote: '배포는 다음 주 화요일' }, ids[1] && { id: ids[1], level: 'mention', reason: '끝에 배포 얘기가 잠깐 나옴', quote: null }].filter(Boolean);
    Object.assign(job, { status: 'done', stage: 'done', ms: Date.now() - job.t0 });
  }, ASK_MS * 3);
  return { ...job };
}
// STUB_MANY=80: 회의가 많을 때의 목록 화면 (지어낸 제목·요약, 이틀에 하나꼴로 석 달)
function manyMeetings(n) {
  const topics = ['주간 회의', '배포 점검', '디자인 리뷰', '채용 면접', '고객사 미팅', '1:1', '분기 계획', '장애 회고', '온보딩', '예산 검토'];
  const out = [];
  for (let i = 0; i < n; i++) {
    // STUB_PER_DAY=3: 하루에 몇 개씩 (기본은 이틀에 하나꼴)
    const per = Number(process.env.STUB_PER_DAY) || 0;
    const day = per ? Math.floor(i / per) + Math.floor(i / per / 5) * 2 : Math.floor(i * 1.1); // 주말은 건너뜀
    const at = new Date(Date.UTC(2026, 10, 1, 1 + (per ? (i % per) * 2 : i % 8)) - day * 86400e3);
    const k = i % 9;
    const status = k === 7 ? 'error' : k === 8 ? 'short' : 'done';
    // STUB_BUSY=1: 둘째·셋째·다섯째 회의는 회의록을 만드는 중 (받아쓰는 중 42%·화자 구분, 쓰는 중, 차례 기다림)
    const busy = process.env.STUB_BUSY && { 1: { status: 'transcribe', progress: 0.42, diarizing: true }, 2: { status: 'write' }, 4: { status: 'queued' } }[i];
    out.push({
      id: `${at.toISOString().slice(0, 10)}_${String(i).padStart(2, '0')}-00-00_meeting`, dir: `/tmp/stub/m${i}`, mode: 'meeting', startedAt: at.toISOString(), durationSec: 300 + ((i * 397) % 4200), tracks: ['mic'], firstFile: 'mic.wav',
      minutes: status === 'done' ? { status, title: `${topics[i % topics.length]} ${1 + (i % 4)}차`, speakers: 2 + (i % 4), provider: 'claude-code' } : status === 'error' ? { status, error: '앱이 종료되어 중단됨' } : { status },
      summary: status === 'done' ? `${topics[i % topics.length]}에서 일정과 담당을 정리했습니다. 다음 단계와 확인할 점을 남겼습니다.` : null,
      review: status === 'done' ? { open: i % 3, total: 3, finalized: i % 3 === 0 } : null,
    });
    if (busy) Object.assign(out.at(-1), { minutes: busy, summary: null, review: null });
    const d = out.at(-1).dir;
    // 녹음 크기는 길이에 맞게 (48kHz WAV 초당 96KB, 넷째마다 16kHz 가져온 녹음 — 압축 안 함). 첫 회의는 화면 시험이 보는 689MB
    const sec = out.at(-1).durationSec;
    const low = i % 4 === 3;
    out.at(-1).audio = compressedIds.has(d) ? { bytes: i === 0 ? 86e6 : sec * 12e3, wav: false, supported: true, compressed: true, estimate: 86e6, declined: false }
      : i === 0 ? { bytes: 689e6, wav: true, supported: true, compressed: false, estimate: 86e6, declined: declinedIds.has(d) }
      : { bytes: sec * (low ? 32e3 : 96e3), wav: true, supported: !low, compressed: false, estimate: sec * 12e3, declined: declinedIds.has(d) };
  }
  return out;
}
const strays = [
  { id: '112-06-26_02-26-26_meeting', dir: '/tmp/stub/112-06-26_02-26-26_meeting', reason: 'bad-name', bytes: 21e6, audio: true, modifiedAt: '2026-11-06T09:00:00Z' },
  { id: '112-06-26_02-26-26_meeting-2', dir: '/tmp/stub/112-06-26_02-26-26_meeting-2', reason: 'bad-name', bytes: 21e6, audio: true, modifiedAt: '2026-11-06T09:01:00Z' },
  { id: '2026-11-04_09-00-00_meeting', dir: '/tmp/stub/2026-11-04_09-00-00_meeting', reason: 'no-meta', bytes: 512e3, audio: true, modifiedAt: '2026-11-04T01:00:00Z' },
];
const keys = [...fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8').matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const api = {};
// 모든 호출을 순서대로 남긴다 (기능 시험이 "무엇이 어떤 값으로 불렸나"를 본다). 이벤트 구독(on…)은 빼고
const log = [];
const plain = (v) => { try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); } };
// 이벤트 구독은 on + 대문자(onAsk, onMinutes…). onboardingGet·onboardingSet은 이벤트가 아니다
const isEvent = (k) => /^on[A-Z]/.test(k);
for (const k of keys) {
  const fn = impl[k] ?? (isEvent(k) ? noop : async () => null);
  api[k] = isEvent(k) ? fn : (...args) => { log.push([k, plain(args)]); return fn(...args); };
}
contextBridge.exposeInMainWorld('recorderApi', api);
contextBridge.exposeInMainWorld('stubCalls', () => ({ ...calls }));
contextBridge.exposeInMainWorld('stubLog', () => plain(log));
contextBridge.exposeInMainWorld('stubMeetingChanged', (id) => meetingChangedCb({ id }));
