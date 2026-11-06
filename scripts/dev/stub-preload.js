// 화면 확인용 가짜 recorderApi. 메인 프로세스 없이 src/renderer/index.html만 띄워 화면을 본다.
// src/preload.js의 함수 이름을 그대로 읽어 같은 모양을 만들고, 몇 가지만 예시 데이터를 돌려준다.
// 녹음·fn·권한·설치는 실제로 하지 않는다. 예시 회의는 STUB_MEETING_DIR(scripts/dev/screens.js가 만든 임시 폴더)에서 읽는다.
const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');

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
const impl = {
  info: async () => ({ recordingsDir: '/Users/me/Documents/MeetingRecorder', defaultRecordingsDir: '/Users/me/Documents/MeetingRecorder' }),
  history: async () => {
    if (!meeting) return [];
    const items = JSON.parse(read('review.json') ?? '{"items":[]}').items;
    return [{ ...meeting, review: { open: items.filter((it) => it.status === 'open').length, total: items.length, finalized: false } }];
  },
  // 확인 필요 채팅: 늘 같은 제안을 돌려주고, 적용하면 review.json의 상태를 바꾼다
  chatReview: async () => ({ text: '"랩캐시도"는 **Memcached**로 보입니다.', proposals: [{ id: 'r1', heard: '랩캐시도', guess: 'Memcached' }] }),
  applyReview: async (_dir, fixes) => {
    const review = JSON.parse(read('review.json'));
    for (const f of fixes) Object.assign(review.items.find((it) => it.id === f.id), f.keep ? { status: 'kept' } : { status: 'applied', applied: f.guess, count: 1 });
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    return review;
  },
  pickAudio: async () => [
    { path: '/Users/me/Downloads/2026-11-01 오후 2.00.00 녹음.m4a', name: '2026-11-01 오후 2.00.00 녹음.m4a', durationSec: 1752 },
    { path: '/Users/me/Downloads/2026-11-01 오후 2.30.00 녹음.m4a', name: '2026-11-01 오후 2.30.00 녹음.m4a', durationSec: 1081 },
  ],
  recordingsAccess: async () => (denied ? { ok: false, dir: '/Users/me/Documents/MeetingRecorder', code: 'EPERM' } : { ok: true }),
  dictSettings: async () => ({ enabled: true, language: 'ko', cleanup: true, provider: 'auto', vocabulary: 'PJY, Whisper', minutes: true, diarize: true, diarizeReady: true, hasHfToken: true, meetingSystemAudio: false, engine: { state: 'ready' } }),
  providers: async () => ({ 'claude-code': { installed: true, loggedIn: true, account: 'me@example.com' }, codex: { installed: true, loggedIn: false }, api: { installed: true, loggedIn: false } }),
  permStatus: async () => ({ microphone: 'granted', inputMonitoring: process.env.OB_STEP === 'permissions' ? 'denied' : 'granted', accessibility: 'granted', systemAudio: 'granted' }),
  fnKeyWarning: async () => null,
  tokenStatus: async () => ({ hf: { cli: true }, anthropic: {} }),
  verifyToken: async () => ({ ok: true, message: '예시 계정 · 화자 구분 모델 사용 가능' }),
  readMinutes: async () => ({ minutes: read('minutes.md'), transcript: read('transcript.txt'), scriptClean: read('script-clean.txt'), review: JSON.parse(read('review.json') ?? 'null'), glossary: JSON.parse(read('glossary.json') ?? 'null'), speech: stubSpeech(), flow: JSON.parse(read('flow.json') ?? 'null'), actions: JSON.parse(read('actions.json') ?? 'null') }),
  redoRange: async (_dir, id, start, end) => {
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
  // 오래 걸리는 LLM 작업 흉내 (화면 테스트가 진행 중 표시·중복 실행을 본다)
  makeActions: async () => {
    calls.makeActions = (calls.makeActions ?? 0) + 1;
    await new Promise((r) => setTimeout(r, +(process.env.STUB_JOB_MS || 2500)));
    return JSON.parse(read('actions.json') ?? '{"actions":[],"advice":[]}');
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
const strays = [
  { id: '112-06-26_02-26-26_meeting', dir: '/tmp/stub/112-06-26_02-26-26_meeting', reason: 'bad-name', bytes: 21e6, audio: true, modifiedAt: '2026-11-06T09:00:00Z' },
  { id: '112-06-26_02-26-26_meeting-2', dir: '/tmp/stub/112-06-26_02-26-26_meeting-2', reason: 'bad-name', bytes: 21e6, audio: true, modifiedAt: '2026-11-06T09:01:00Z' },
  { id: '2026-11-04_09-00-00_meeting', dir: '/tmp/stub/2026-11-04_09-00-00_meeting', reason: 'no-meta', bytes: 512e3, audio: true, modifiedAt: '2026-11-04T01:00:00Z' },
];
const keys = [...fs.readFileSync(path.join(__dirname, '../../src/preload.js'), 'utf8').matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const api = {};
for (const k of keys) api[k] = impl[k] ?? (k.startsWith('on') ? noop : async () => null);
contextBridge.exposeInMainWorld('recorderApi', api);
contextBridge.exposeInMainWorld('stubCalls', () => ({ ...calls }));
