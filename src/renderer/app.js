import { Recorder } from './recorder.js';
import { startOnboarding } from './onboarding.js';

const api = window.recorderApi;
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

// 작은 DOM 도우미: h('div', { class: 'x', onclick }, 자식...)
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el[k] = v;
    else if (k in el && !k.startsWith('aria') && !k.startsWith('data')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}

// replaceChildren은 false/null도 글자로 넣으므로 조건부 자식을 걸러서 넘긴다
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));

function icon(id) {
  const svg = document.createElementNS(SVGNS, 'svg');
  const use = document.createElementNS(SVGNS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

const num = (text) => h('span', { class: 'num' }, String(text));
const fmt = new Intl.NumberFormat('ko-KR');
const DAY = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
const FULL = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const TIME = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const PROVIDER_NAME = { 'claude-code': 'Claude Code', codex: 'Codex', api: 'API' };

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}
const seconds = (ms) => `${(ms / 1000).toFixed(1)}초`;
const parseStamp = (t) => t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
const dayKey = (d) => new Date(d).toDateString();

function dayLabel(date) {
  const key = dayKey(date);
  const today = new Date();
  if (key === today.toDateString()) return '오늘';
  if (key === new Date(today - 864e5).toDateString()) return '어제';
  return DAY.format(new Date(date));
}

function store(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function remember(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ── 토스트 (잠깐 보여 주는 알림) ─────────────────────────────────────────
function toast(title, detail = '', { bad = false, action = null, onAction = null, ms = 4200 } = {}) {
  const el = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, h('b', null, title), detail && h('span', null, detail));
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 200);
  };
  if (action) el.append(h('button', { onclick: () => { onAction?.(); close(); } }, action));
  $('toasts').append(el);
  setTimeout(close, ms);
  if (bad) api.log(`${title} ${detail}`);
}

// ── 확인해야 할 문제 (권한·엔진·토큰): 홈 맨 위와 설정 점으로 계속 보인다 ─────────
const issues = new Map(); // key → { title, detail, action, onAction, sec }

function setIssue(key, issue) {
  const before = issues.get(key);
  if (!issue === !before && (!issue || (issue.title === before.title && issue.detail === before.detail))) return; // 권한은 3초마다 다시 확인하므로 바뀐 것만 반영
  if (issue) issues.set(key, issue);
  else issues.delete(key);
  const secs = new Set([...issues.values()].map((i) => i.sec));
  $('settingsDot').hidden = issues.size === 0;
  $('permDot').hidden = !secs.has('perms');
  $('accountsDot').hidden = !secs.has('accounts');
  if (route.name === 'home') refresh();
}

function issueList() {
  if (!issues.size) return null;
  return h('div', { class: 'issues' }, [...issues.entries()].map(([key, i]) =>
    h('div', { class: 'issue' },
      icon('i-alert'),
      h('div', { class: 'issue-text' }, h('b', null, i.title), i.detail && h('span', null, i.detail)),
      i.action && h('button', { class: 'btn small', onclick: i.onAction }, i.action),
      i.dismiss && h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => setIssue(key, null) }, icon('i-x')),
    )));
}

// ── 녹음 ────────────────────────────────────────────────────────────────
const peakDb = { mic: -Infinity, system: -Infinity };
const tape = { levels: [], ctx: $('tape').getContext('2d') };
const recorder = new Recorder({
  api,
  onLevel: (track, db) => {
    peakDb[track] = Math.max(peakDb[track], db);
    if (track === 'mic') pushLevel(db);
  },
});

function pushLevel(db) {
  if (liveClock.paused) return;
  tape.levels.push(Math.max(0, Math.min(1, (db + 60) / 54)));
  if (tape.levels.length > 60) tape.levels.shift();
  drawTape();
}

function drawTape() {
  const canvas = $('tape');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (!w) return;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
  }
  const { ctx } = tape;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  const step = 4;
  const levels = tape.levels.slice(-Math.floor(w / step));
  levels.forEach((v, i) => {
    const bar = Math.max(2, Math.round(v * hgt));
    ctx.beginPath();
    ctx.roundRect(w - (levels.length - i) * step, (hgt - bar) / 2, 2, bar, 1);
    ctx.fill();
  });
}

let liveTimer;
let recordingMode = null;
let liveClock = { elapsedMs: 0, at: Date.now(), paused: false }; // 회의 일시정지를 반영한 녹음 시간 (기준은 메인 프로세스)
const liveElapsed = () => (liveClock.paused ? liveClock.elapsedMs : liveClock.elapsedMs + Date.now() - liveClock.at);
let settings = null;

function setLive(state, text = '') {
  const live = $('live');
  live.hidden = state === 'idle';
  live.dataset.state = state;
  $('liveText').textContent = text;
  $('route').hidden = state !== 'working';
  $('tape').hidden = state !== 'memo' && state !== 'meeting';
  clearInterval(liveTimer);
  $('liveTime').textContent = '';
  if (state === 'memo' || state === 'meeting' || state === 'paused') {
    if (state !== 'paused') {
      tape.levels = [];
      drawTape();
    }
    const tick = () => ($('liveTime').textContent = clock(liveElapsed() / 1000));
    tick();
    liveTimer = setInterval(tick, 250);
  }
}

function setRecording(mode) {
  recordingMode = mode;
  const memo = $('memoBtn');
  const meet = $('meetingBtn');
  memo.classList.toggle('on', mode === 'memo');
  meet.classList.toggle('on', mode === 'meeting');
  memo.querySelector('span').textContent = mode === 'memo' ? '받아쓰기 정지' : '받아쓰기';
  meet.querySelector('span').textContent = mode === 'meeting' ? '종료하고 저장' : '회의 녹음';
  meet.querySelector('use').setAttribute('href', mode === 'meeting' ? '#i-stop' : '#i-rec');
  memo.disabled = mode === 'meeting';
  meet.disabled = mode === 'memo';
  memo.hidden = mode === 'meeting'; // 회의 중에는 취소 · 일시정지 · 종료만 보인다
  $('cancelBtn').hidden = mode !== 'meeting';
  $('pauseBtn').hidden = mode !== 'meeting';
  $('liveSpeakers').hidden = mode !== 'meeting';
  if (mode === 'meeting') $('liveSpeakersSel').value = startedFromSheet ? startSpeakers : '';
  startedFromSheet = false;
  liveClock = { elapsedMs: 0, at: Date.now(), paused: false };
  setPauseButton(false);
  if (mode === 'memo') setLive('memo', '듣는 중');
  else if (mode === 'meeting') setLive('meeting', '회의 녹음 중');
  else if ($('live').dataset.state !== 'working') setLive('idle');
}

function setPauseButton(paused) {
  const b = $('pauseBtn');
  b.querySelector('span').textContent = paused ? '재개' : '일시정지';
  b.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  b.classList.toggle('on', paused);
}

api.onClock((c) => {
  if (!c || c.mode !== 'meeting' || recordingMode !== 'meeting') return;
  liveClock = { elapsedMs: c.elapsedMs, at: Date.now(), paused: c.paused };
  setPauseButton(c.paused);
  setLive(c.paused ? 'paused' : 'meeting', c.paused ? '일시정지됨' : '회의 녹음 중');
});

$('pauseBtn').onclick = () => api.pause(!liveClock.paused);
$('cancelBtn').onclick = async () => {
  const min = Math.round(liveElapsed() / 60000);
  if (await confirmBox('회의 녹음을 취소할까요?', `지금까지 녹음한 ${min ? `${min}분` : '내용'}이 저장되지 않고 지워집니다.`, '녹음 버리기')) api.cancel();
};

const STAGES = ['listen', 'transcribe', 'cleanup', 'paste'];
function showStage(stage) {
  setLive('working', '받아쓰는 중');
  const at = STAGES.indexOf(stage);
  for (const li of $('route').children) {
    const i = STAGES.indexOf(li.dataset.stage);
    li.className = i < at ? 'done' : i === at ? 'now' : '';
  }
}

// 메인 프로세스 명령은 도착 순서대로 하나씩 처리한다 (꾹 눌렀다 바로 떼면 start → cancel이 연달아 온다)
let cmdQueue = Promise.resolve();
function enqueue(cmd) {
  cmdQueue = cmdQueue.then(() => run(cmd)).catch((err) => toast('오류', err.message, { bad: true }));
}

async function run({ action, mode }) {
  if (action === 'start') {
    if (recorder.isRecording) return;
    peakDb.mic = peakDb.system = -Infinity;
    try {
      const { warnings, timing } = await recorder.start({
        mode,
        deviceId: $('micSelect').value || undefined,
        echoCancellation: $('echo').checked,
        includeSystem: mode === 'meeting' && Boolean(settings?.meetingSystemAudio),
      });
      warnings.forEach((w) => toast('녹음 경고', w, { bad: true, ms: 7000 }));
      setRecording(mode);
      api.log(`start timing ${mode} ${JSON.stringify(timing)}`);
    } catch (err) {
      setRecording(null);
      api.failed();
      if (/EPERM|EACCES|operation not permitted/i.test(err.message)) {
        toast('녹음 폴더에 쓸 수 없습니다', 'macOS가 이 앱의 문서 폴더 접근을 막았습니다', { bad: true, ms: 10000, action: '권한 열기', onAction: () => api.permOpenSettings('files') });
        loadHistory();
      } else toast('녹음을 시작하지 못했습니다', err.message, { bad: true, ms: 8000 });
    }
    return;
  }

  const wasMode = recordingMode;
  const result = await recorder.stop({ discard: action === 'cancel' });
  setRecording(null);
  if (action === 'cancel' && wasMode === 'meeting') toast('회의 녹음을 취소했습니다', '녹음은 저장하지 않았습니다');
  if (!result) return;
  if (wasMode === 'memo' && settings?.enabled) showStage('transcribe');
  const savedSec = Math.max(0, ...Object.values(result.files ?? {}).map((f) => f.durationSec ?? 0));
  if (wasMode === 'meeting' && savedSec >= 10) toast('회의 녹음을 저장했습니다', settings?.minutes ? '회의록을 만들기 시작합니다' : '');
  loadHistory();
  // 권한이 없으면 macOS는 에러 없이 완전한 무음(0)을 넘겨준다
  if (result.files.system && peakDb.system < -150) {
    setIssue('system-silent', { title: '상대방 소리가 녹음되지 않았습니다', detail: '시스템 오디오 녹음 권한을 허용한 뒤 앱을 다시 실행하세요.', action: '권한 보기', onAction: () => openSettings('perms'), sec: 'perms', dismiss: true });
  }
}

$('memoBtn').onclick = () => api.toggle('memo');
$('meetingBtn').onclick = () => (recordingMode === 'meeting' ? api.toggle('meeting') : openMeetingStart());

// ── 회의 녹음 시작 시트: 참석 인원 · 대면/화상 · 회의록 자동 ─────────────────
const SPEAKER_CHOICES = ['', '2', '3', '4', '5', '6', '7', '8'];
const speakerLabel = (v) => (v ? `${v}명` : '자동');
let startSpeakers = store('startSpeakers', '');
let startedFromSheet = false; // 독·메뉴바에서 시작하면 시트를 거치지 않으므로 자동으로 둔다

function segPick(box, attr, value) {
  for (const b of box.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === value));
}

function openMeetingStart() {
  if (recordingMode) return;
  const box = $('startSpeakers');
  box.replaceChildren(...SPEAKER_CHOICES.map((v) => h('button', { type: 'button', role: 'radio', 'data-n': v, onclick: () => { startSpeakers = v; segPick(box, 'n', v); } }, speakerLabel(v))));
  segPick(box, 'n', startSpeakers);
  const kind = settings?.meetingSystemAudio ? 'online' : 'offline';
  segPick($('startKind'), 'kind', kind);
  $('startMinutes').checked = Boolean(settings?.minutes);
  $('meetStart').showModal();
  $('startYes').focus();
}
for (const b of $('startKind').querySelectorAll('button')) b.onclick = () => segPick($('startKind'), 'kind', b.dataset.kind);
$('startNo').onclick = () => $('meetStart').close();
$('startClose').onclick = () => $('meetStart').close();
$('meetStart').addEventListener('click', (e) => e.target === $('meetStart') && $('meetStart').close());
$('startYes').onclick = async () => {
  const online = $('startKind').querySelector('[aria-checked="true"]')?.dataset.kind === 'online';
  const patch = {};
  if (online !== Boolean(settings?.meetingSystemAudio)) patch.meetingSystemAudio = online;
  if ($('startMinutes').checked !== Boolean(settings?.minutes)) patch.minutes = $('startMinutes').checked;
  if (Object.keys(patch).length) await saveDict(patch);
  remember('startSpeakers', startSpeakers);
  api.setSpeakers(startSpeakers || null);
  startedFromSheet = true;
  $('meetStart').close();
  api.toggle('meeting');
};

// 녹음 중 참석 인원 바꾸기 (위쪽 막대)
$('liveSpeakersSel').append(...SPEAKER_CHOICES.map((v) => h('option', { value: v }, v ? `참석 ${speakerLabel(v)}` : '참석 자동')));
$('liveSpeakersSel').onchange = (e) => api.setSpeakers(e.target.value || null);
api.onCommand(enqueue);
api.onFnStatus((s) => setIssue('fn', s.ok ? null : { title: 'fn 키를 감지하지 못합니다', detail: s.reason, action: '권한 보기', onAction: () => openSettings('perms'), sec: 'perms' }));

// ── 기록 데이터 ─────────────────────────────────────────────────────────
let history = [];
let freshId = null;
const dictations = () => history.filter((r) => r.mode === 'memo' && r.transcript?.raw);
const meetings = () => history.filter((r) => r.mode === 'meeting');
const BUSY = ['queued', 'transcribe', 'write'];

// macOS가 녹음 폴더(기본은 문서 폴더 안) 접근을 막으면 목록이 비어 보인다. 녹음이 사라진 게 아니라고 알린다
const FOLDER_DENIED = new Set(['EPERM', 'EACCES']);
function folderIssue(access) {
  if (!access || access.ok) return null;
  const denied = FOLDER_DENIED.has(access.code);
  return {
    title: '녹음 폴더를 읽을 수 없습니다',
    detail: denied
      ? `macOS가 이 앱의 ${tilde(access.dir)} 접근을 막았습니다. 녹음은 그대로 있습니다. 시스템 설정 › 파일 및 폴더에서 Meeting Recorder의 '문서 폴더'를 켜 주세요.`
      : `${tilde(access.dir)}를 열지 못했습니다 (${access.code ?? '알 수 없는 오류'}).`,
    action: denied ? '권한 열기' : null,
    onAction: () => api.permOpenSettings('files'),
    sec: 'general',
  };
}

function folderEmpty() {
  const i = issues.get('folder');
  return i && h('div', { class: 'empty' }, h('b', null, i.title), i.detail, i.action && h('br'), i.action && h('button', { class: 'btn', onclick: i.onAction }, i.action));
}

async function loadHistory() {
  const [list, access] = await Promise.all([api.history(), api.recordingsAccess()]);
  history = list;
  setIssue('folder', folderIssue(access));
  $('countDict').textContent = dictations().length || '';
  $('countMeet').textContent = meetings().length || '';
  refresh();
}

api.onMinutes(({ id, status, offline }) => {
  if (status === 'done') {
    docCache.delete(id);
    // 회의록은 바로 쓸 수 있는 초안이다. 확인할 항목이 있으면 같이 알린다
    api.history().then((list) => {
      const r = list.find((m) => m.id === id);
      const open = r?.review?.open ?? 0;
      toast('회의록 초안을 만들었습니다', open ? `확인 필요 ${open}개 · 확인하면 회의록을 확정합니다` : r ? clock(r.durationSec) : '', {
        action: open ? '확인하기' : '열기', ms: 10000,
        onAction: () => {
          if (open) openReviewNext = id;
          location.hash = `#meeting/${encodeURIComponent(id)}`;
        },
      });
    });
  }
  if (status === 'short') toast('회의 녹음을 저장했습니다', '10초 미만이라 회의록은 만들지 않았습니다');
  if (status === 'error') {
    toast(offline ? '인터넷 연결이 없어 회의록을 쓰지 못했습니다' : '회의록을 만들지 못했습니다', offline ? '녹취는 저장했습니다. 연결되면 이어서 씁니다' : '', {
      bad: true, action: '보기', onAction: () => (location.hash = `#meeting/${encodeURIComponent(id)}`),
    });
  }
  loadHistory();
});

// 파일이 바뀌면(앱 밖에서 고친 경우 포함) 열려 있는 회의와 목록을 다시 읽는다
api.onMeetingChanged(({ id }) => {
  docCache.delete(id);
  if (route.name === 'meeting' && route.arg === id) current?.reload?.();
  loadHistory();
});
api.onRecordingsChanged(() => loadHistory());

// 다듬기 전/후를 단어 단위로 비교해 지운 말(취소선)과 넣은 말(밑줄)을 표시한다
const PUNCT = /^[.,!?…·:;"'“”‘’()]$/;
const tokenize = (s) => s.match(/[^\s.,!?…·:;"'“”‘’()]+|[.,!?…·:;"'“”‘’()]/g) ?? [];
const joinTokens = (tokens) => tokens.reduce((out, t, i) => (i && !PUNCT.test(t) ? `${out} ${t}` : out + t), '');

function diffWords(a, b) {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 250000) return [{ op: 'eq', tokens: y }];
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out = [];
  const push = (op, token) => {
    const last = out.at(-1);
    if (last?.op === op) last.tokens.push(token);
    else out.push({ op, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('eq', x[i++]);
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', x[i++]);
    else push('ins', y[j++]);
  }
  while (i < x.length) push('del', x[i++]);
  while (j < y.length) push('ins', y[j++]);
  return out;
}

// 교정 부호를 붙인 글. 너무 많이 고쳤으면(넣은 말 비율 > 40%) 다듬은 글만 보여 준다
function markedText(raw, text) {
  const el = h('div', { class: 'dtext' });
  if (!text || raw === text) {
    el.textContent = text ?? raw;
    return { el, heavy: false };
  }
  const parts = diffWords(raw, text);
  const inserted = parts.filter((p) => p.op === 'ins').reduce((n, p) => n + p.tokens.length, 0);
  const kept = parts.filter((p) => p.op !== 'del').reduce((n, p) => n + p.tokens.length, 0);
  if (inserted / Math.max(1, kept) > 0.4) {
    el.textContent = text;
    return { el, heavy: true };
  }
  parts.forEach((part, k) => {
    const words = joinTokens(part.tokens);
    if (k && !PUNCT.test(part.tokens[0])) el.append(' ');
    if (part.op === 'eq') el.append(words);
    else el.append(h(part.op, { title: part.op === 'del' ? '다듬기가 지운 말' : '다듬기가 넣은 말' }, words));
  });
  return { el, heavy: false };
}

// ── 라우터 ──────────────────────────────────────────────────────────────
const ROUTES = { home: pageHome, dictations: pageDictations, meetings: pageMeetings, meeting: pageMeeting, dictionary: pageDictionary, stats: pageStats };
const TITLES = { home: '홈', dictations: '받아쓰기', meetings: '회의', meeting: '회의', dictionary: '사전', stats: '통계' };
let route = parseHash();
let current = null; // { el, update? }

function parseHash() {
  const [name, ...rest] = location.hash.slice(1).split('/');
  return { name: ROUTES[name] ? name : 'home', arg: rest.length ? decodeURIComponent(rest.join('/')) : null };
}

// 뒤로·앞으로: 해시 이동마다 window.history.state에 순번을 붙여 지금 어디쯤인지 안다
let navIndex = 0;
let navMax = 0;
let navStarted = false;
function trackHistory() {
  const idx = window.history.state?.idx;
  if (typeof idx === 'number') navIndex = idx;
  else if (!navStarted) window.history.replaceState({ idx: 0 }, ''); // 앱을 연 첫 화면
  else {
    navIndex += 1;
    navMax = navIndex; // 새로 이동하면 앞으로 갈 곳은 사라진다
    window.history.replaceState({ idx: navIndex }, '');
  }
  navMax = Math.max(navMax, navIndex);
  navStarted = true;
  $('navBack').disabled = navIndex <= 0;
  $('navFwd').disabled = navIndex >= navMax;
}
$('navBack').onclick = () => window.history.back();
$('navFwd').onclick = () => window.history.forward();
document.addEventListener('keydown', (e) => {
  if (!e.metaKey || e.target.closest?.('input, textarea')) return;
  if (e.key === '[') {
    e.preventDefault();
    if (navIndex > 0) window.history.back();
  } else if (e.key === ']') {
    e.preventDefault();
    if (navIndex < navMax) window.history.forward();
  }
});
// 마우스 옆 버튼(뒤로·앞으로)
window.addEventListener('mouseup', (e) => {
  if (e.button === 3 && navIndex > 0) window.history.back();
  if (e.button === 4 && navIndex < navMax) window.history.forward();
});
api.onSwipe?.((dir) => {
  if (dir === 'left' && navIndex > 0) window.history.back();
  if (dir === 'right' && navIndex < navMax) window.history.forward();
});

// 지운 회의에서 벗어날 때는 기록을 바꿔치워 뒤로 가기로 다시 오지 않게 한다
function replaceRoute(hash) {
  window.history.replaceState({ idx: navIndex }, '', hash);
  navigate();
}

function navigate() {
  trackHistory();
  route = parseHash();
  const navName = route.name === 'meeting' ? 'meetings' : route.name;
  for (const a of document.querySelectorAll('.nav a.nav-item')) {
    if (a.dataset.route === navName) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  current?.leave?.();
  current = ROUTES[route.name](route.arg);
  $('view').replaceChildren(current.el);
  $('view').scrollTop = 0;
  setCrumbs();
}
window.addEventListener('hashchange', navigate);

function setCrumbs(title) {
  const crumbs = $('crumbs');
  crumbs.replaceChildren();
  if (route.name === 'meeting') {
    crumbs.append(h('a', { href: '#meetings' }, '회의'), icon('i-right'), h('b', null, title ?? ''));
  } else crumbs.append(h('b', null, TITLES[route.name]));
}

// 데이터가 바뀌면 지금 화면만 다시 그린다 (스크롤 위치와 입력칸은 지킨다)
function refresh() {
  if (!current) return;
  const top = $('view').scrollTop;
  if (current.update) current.update();
  else {
    current = ROUTES[route.name](route.arg);
    $('view').replaceChildren(current.el);
  }
  $('view').scrollTop = top;
}

// ── 홈 ───────────────────────────────────────────────────────────────
function greeting() {
  const hr = new Date().getHours();
  if (hr >= 5 && hr < 11) return '좋은 아침이에요';
  if (hr >= 11 && hr < 17) return '좋은 오후예요';
  if (hr >= 17 && hr < 23) return '좋은 저녁이에요';
  return '늦게까지 수고 많아요';
}

function dictStats(items = dictations()) {
  const chars = (r) => r.chars ?? (r.transcript.text ?? r.transcript.raw ?? '').length;
  const today = items.filter((r) => dayKey(r.startedAt) === new Date().toDateString());
  const wpms = items.map((r) => r.wpm).filter((w) => w > 0);
  const days = new Set(items.map((r) => dayKey(r.startedAt)));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // 오늘 아직 안 썼으면 어제부터 센다
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return {
    total: items.reduce((n, r) => n + chars(r), 0),
    today: today.reduce((n, r) => n + chars(r), 0),
    todayCount: today.length,
    wpm: wpms.length ? Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length) : null,
    streak,
    chars,
  };
}

function pageHome() {
  const el = h('div', { class: 'page' });
  const update = () => {
    const st = dictStats();
    const meets = meetings();
    const todayMeets = meets.filter((m) => dayKey(m.startedAt) === new Date().toDateString());
    const line = h('p');
    if (st.todayCount) {
      line.append('오늘 ', h('b', null, num(fmt.format(st.today)), '자'), '를 말로 썼어요');
      if (st.wpm) line.append(' · 평균 ', h('b', null, num(st.wpm)), ' WPM');
      if (st.streak > 1) line.append(' · ', h('b', null, num(st.streak), '일'), ' 연속');
    } else line.append(h('kbd', null, 'fn'), '을 꾹 누른 채 말하면 지금 커서 위치에 글이 들어갑니다.');
    if (todayMeets.length) line.append(' · 오늘 회의 ', h('b', null, num(todayMeets.length), '건'));

    const busy = meets.filter((m) => BUSY.includes(m.minutes?.status));
    const recentMeets = meets.filter((m) => BUSY.includes(m.minutes?.status) || (m.minutes?.status === 'done' && m.durationSec >= 60)).slice(0, 4); // 몇 초짜리 시험 녹음은 홈에 올리지 않는다
    const recentDicts = dictations().slice(0, 5);
    const doneMeeting = meets.some((m) => m.minutes?.status === 'done');
    const permsOk = ![...issues.values()].some((i) => i.sec === 'perms');
    const steps = [
      { done: permsOk, title: '권한 허용', text: '마이크, 입력 모니터링, 손쉬운 사용 권한이 있어야 fn 받아쓰기가 됩니다.', action: '권한 보기', on: () => openSettings('perms') },
      { done: dictations().length > 0, title: 'fn으로 받아쓰기', text: '아무 입력칸에 커서를 두고 fn을 꾹 누른 채 말한 뒤 떼세요.', action: '설정 보기', on: () => openSettings('general') },
      { done: doneMeeting, title: '회의 녹음', text: '회의를 시작할 때 위쪽 회의 녹음을 누르면, 끝난 뒤 회의록이 만들어집니다.', action: '지금 녹음 시작', on: openMeetingStart },
    ];

    fill(el, 
      h('header', { class: 'hello' }, h('h1', null, greeting()), line),
      issueList(),
      busy.length > 0 && h('div', { class: 'section' }, busy.map(jobCard)),
      !steps.every((s) => s.done) && h('div', { class: 'start' }, steps.map((s, i) =>
        h('div', { class: `step${s.done ? ' done' : ''}` },
          h('span', { class: 'step-n' }, s.done ? icon('i-check') : String(i + 1)),
          h('b', null, s.title), h('p', null, s.text),
          !s.done && h('button', { class: 'btn small', onclick: s.on }, s.action)))),
      recentMeets.length > 0 && h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, '최근 회의'), h('a', { href: '#meetings' }, '모두 보기')),
        h('div', { class: 'mgrid' }, recentMeets.map(meetingCard))),
      recentDicts.length > 0 && h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h2', null, '최근 받아쓰기'), h('a', { href: '#dictations' }, '모두 보기')),
        h('div', { class: 'dlist' }, recentDicts.map((r) => dictItem(r, { compact: true })))),
    );
  };
  update();
  return { el, update };
}

function progressOf(m) {
  if (m?.status === 'transcribe' && m.progress !== undefined) return m.progress;
  return null;
}

function statusText(m) {
  const s = m?.status;
  if (s === 'queued') return '차례를 기다리는 중';
  if (s === 'transcribe') {
    const p = progressOf(m);
    return `받아쓰는 중${p !== null ? ` ${Math.round(p * 100)}%` : ''}${m.diarizing ? ' · 화자 구분 중' : ''}`;
  }
  if (s === 'write') return '회의록 쓰는 중';
  if (s === 'error') return m.error ?? '실패';
  if (s === 'empty') return '들린 말이 없어 회의록을 만들지 않았습니다';
  if (s === 'short') return '10초 미만이라 회의록을 만들지 않았습니다';
  return '녹음만 저장됨';
}

function jobCard(r) {
  const p = progressOf(r.minutes);
  return h('a', { class: 'job', href: `#meeting/${encodeURIComponent(r.id)}` },
    h('b', null, `${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))} 회의 · 회의록 만드는 중`),
    h('span', { class: 'pct' }, p !== null ? `${Math.round(p * 100)}%` : ''),
    h('span', { class: 'sub' }, `${statusText(r.minutes)} · 녹음 ${clock(r.durationSec)}`),
    h('div', { class: `bar${p === null ? ' indeterminate' : ''}` }, h('i', { style: `width:${Math.round((p ?? 0.3) * 100)}%` })));
}

function speakerDots(n) {
  if (!n) return null;
  return h('span', { class: 'speakers', title: `화자 ${n}명` }, Array.from({ length: Math.min(n, 6) }, (_, i) => h('i', { style: `background:var(--s${i + 1})` })));
}

function meetingCard(r) {
  const m = r.minutes;
  const s = m?.status;
  const busy = BUSY.includes(s);
  const title = s === 'done' ? m.title ?? '제목 없는 회의' : busy ? '회의록 만드는 중' : s === 'error' ? '회의록을 만들지 못했습니다' : s === 'empty' ? '들린 말 없음' : '회의록 없음';
  return h('a', { class: 'mcard', href: `#meeting/${encodeURIComponent(r.id)}` },
    h('div', { class: 'mcard-top' }, h('span', null, `${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))}`), '·', num(clock(r.durationSec)), h('span', { style: 'flex:1' }), speakerDots(m?.speakers)),
    h('h3', { class: s === 'done' ? '' : 'muted' }, title),
    h('p', null, s === 'done' ? r.summary ?? '' : statusText(m)),
    h('div', { class: 'mcard-foot' },
      busy && h('span', { class: 'tag accent busy' }, statusText(m)),
      s === 'error' && h('span', { class: 'tag accent' }, '실패'),
      reviewTag(r),
      m?.speakers && h('span', { class: 'tag' }, `화자 ${m.speakers}명`),
      s === 'done' && m.provider && h('span', { class: 'tag' }, PROVIDER_NAME[m.provider] ?? m.provider),
      r.tracks?.includes('system') && h('span', { class: 'tag' }, '상대방 소리 포함')));
}

async function trashMeetings(list) {
  const total = list.reduce((n, m) => n + m.durationSec, 0);
  const title = list.length > 1 ? `녹음 ${list.length}개를 휴지통으로 옮길까요?` : '이 녹음을 휴지통으로 옮길까요?';
  if (!(await confirmBox(title, `녹음 폴더째(총 ${clock(total)}) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.`, '휴지통으로'))) return;
  let failed = 0;
  for (const m of list) await api.trashMeeting(m.dir).catch(() => failed++);
  toast(failed ? `${list.length - failed}개를 옮기고 ${failed}개는 옮기지 못했습니다` : `${list.length}개를 휴지통으로 옮겼습니다`, failed ? '회의록을 만드는 중인 녹음은 옮길 수 없습니다' : '', { bad: Boolean(failed) });
  loadHistory();
}

function meetingRow(r) {
  const s = r.minutes?.status;
  return h('a', { class: `mrow${s === 'error' ? ' err' : ''}`, href: `#meeting/${encodeURIComponent(r.id)}` },
    h('time', null, TIME.format(new Date(r.startedAt))), num(clock(r.durationSec)),
    h('span', { class: 'status' }, s === 'error' ? `회의록 실패 · ${r.minutes.error ?? ''}` : s === 'empty' ? '들린 말 없음' : s === 'short' ? '짧은 녹음 (10초 미만)' : '녹음만 저장됨'),
    h('span', { class: 'go' }, s === 'empty' || s === 'short' ? '열기' : '회의록 만들기'),
    h('button', { class: 'icon-btn', title: '휴지통으로', 'aria-label': '휴지통으로', onclick: (e) => { e.preventDefault(); e.stopPropagation(); trashMeetings([r]); } }, icon('i-trash')));
}

// ── 받아쓰기 ────────────────────────────────────────────────────────────
const openRaw = new Set();
let showMarks = store('showMarks', true);

function copyButton(text, label = '복사') {
  const b = h('button', { class: 'icon-btn', title: label, 'aria-label': label }, icon('i-copy'));
  b.onclick = async (e) => {
    e.stopPropagation();
    await api.copy(typeof text === 'function' ? await text() : text);
    b.classList.add('ok');
    b.replaceChildren(icon('i-check'));
    setTimeout(() => {
      b.classList.remove('ok');
      b.replaceChildren(icon('i-copy'));
    }, 1400);
  };
  return b;
}

function dictItem(r, { compact = false } = {}) {
  const t = r.transcript;
  const text = t.text ?? t.raw;
  const { el: body, heavy } = markedText(t.raw, t.text);
  if (!showMarks) body.classList.add('plain');
  const meta = h('div', { class: 'dmeta' },
    r.app && h('span', { class: 'tag' }, r.app),
    num(seconds(r.durationSec * 1000)),
    heavy && h('span', null, '많이 고침'),
    !compact && t.timing?.transcribeMs !== undefined && h('span', null, '인식 ', num(seconds(t.timing.transcribeMs))),
    !compact && t.cleanupProvider && h('span', null, `다듬기 ${PROVIDER_NAME[t.cleanupProvider] ?? t.cleanupProvider} `, num(seconds(t.timing?.cleanupMs ?? 0))),
    t.cleanupError && h('span', { class: 'err' }, `다듬기 실패: ${t.cleanupError}`));
  const changed = t.text && t.text !== t.raw;
  const acts = h('div', { class: 'dacts' },
    copyButton(text),
    h('button', {
      class: 'icon-btn', title: '창을 닫고 직전에 쓰던 앱에 다시 입력', 'aria-label': '다시 입력',
      onclick: async () => {
        const status = await api.repaste(text);
        if (status !== 'pasted') toast('클립보드에 복사했습니다', '⌘V로 붙여 넣으세요');
      },
    }, icon('i-paste')),
    changed && !compact && h('button', {
      class: 'icon-btn', title: openRaw.has(r.id) ? '원문 닫기' : '원문 보기', 'aria-label': '원문',
      onclick: () => {
        openRaw.has(r.id) ? openRaw.delete(r.id) : openRaw.add(r.id);
        refresh();
      },
    }, icon('i-book')),
    !compact && !r.dir && h('button', {
      class: 'icon-btn', title: '삭제', 'aria-label': '삭제',
      onclick: async () => {
        if (!(await confirmBox('이 받아쓰기를 지울까요?', '기록과 통계에서 빠집니다. 되돌릴 수 없습니다.', '지우기'))) return;
        await api.deleteDictation(r.id);
        toast('받아쓰기를 지웠습니다');
        loadHistory();
      },
    }, icon('i-trash')));
  return h('div', { class: `ditem${r.id === freshId ? ' fresh' : ''}` },
    h('time', null, TIME.format(new Date(r.startedAt))),
    h('div', null, body, openRaw.has(r.id) && h('div', { class: 'draw' }, t.raw), meta),
    acts);
}

function groupByDay(items, render, wrapClass) {
  const out = [];
  let key = null;
  let box = null;
  for (const item of items) {
    const k = dayKey(item.startedAt);
    if (k !== key) {
      key = k;
      const count = items.filter((r) => dayKey(r.startedAt) === k).length;
      out.push(h('div', { class: 'day-head' }, dayLabel(item.startedAt), num(`${count}건`)));
      out.push((box = h('div', { class: wrapClass })));
    }
    box.append(render(item));
  }
  return out;
}

function searchBox(placeholder, value, onInput) {
  const input = h('input', { type: 'search', placeholder, value, spellcheck: false });
  input.oninput = () => onInput(input.value);
  return h('label', { class: 'search' }, icon('i-search'), input);
}

function pageDictations() {
  let q = '';
  const list = h('div');
  const marksInput = h('input', { type: 'checkbox', checked: showMarks });
  marksInput.onchange = () => {
    showMarks = marksInput.checked;
    remember('showMarks', showMarks);
    update();
  };
  const marks = h('label', { class: 'inline-switch', title: '다듬기가 지운 말(취소선)과 넣은 말(밑줄) 표시' }, h('span', { class: 'switch' }, marksInput, h('i')), '고친 곳 표시');
  const count = num('');
  const update = () => {
    const all = dictations();
    count.textContent = all.length || '';
    const items = q ? all.filter((r) => `${r.transcript.text ?? ''} ${r.transcript.raw} ${r.app ?? ''}`.toLowerCase().includes(q)) : all;
    if (!all.length && issues.has('folder')) list.replaceChildren(folderEmpty());
    else if (!all.length) list.replaceChildren(h('div', { class: 'empty' }, h('b', null, '아직 받아쓴 글이 없습니다'), '아무 입력칸에 커서를 두고 ', h('kbd', null, 'fn'), '을 꾹 누른 채 말해 보세요.'));
    else if (!items.length) list.replaceChildren(h('div', { class: 'empty' }, h('b', null, '찾는 글이 없습니다'), `"${q}"가 들어간 받아쓰기가 없습니다.`));
    else list.replaceChildren(...groupByDay(items, (r) => dictItem(r), 'dlist'));
  };
  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, '받아쓰기', count), h('div', { class: 'head-tools' }, marks, searchBox('받아쓴 말, 앱 이름 검색', '', (v) => {
      q = v.trim().toLowerCase();
      update();
    }))),
    list);
  update();
  return { el, update };
}

// ── 회의 목록 ───────────────────────────────────────────────────────────
function pageMeetings() {
  let q = '';
  let filter = 'all';
  const FILTERS = [
    ['all', '전체', () => true],
    ['done', '회의록 있음', (m) => m.minutes?.status === 'done'],
    ['busy', '만드는 중', (m) => BUSY.includes(m.minutes?.status)],
    ['rest', '녹음만 · 실패', (m) => !m.minutes || ['error', 'empty', 'short'].includes(m.minutes.status)],
  ];
  const chips = h('div', { class: 'chips' });
  const bulk = h('div', { class: 'bulk-row' });
  const list = h('div');
  const count = num('');
  const update = () => {
    const all = meetings();
    count.textContent = all.length || '';
    chips.replaceChildren(...FILTERS.map(([id, label, fn]) => {
      const n = all.filter(fn).length;
      if (id !== 'all' && !n) return null;
      return h('button', { class: 'chip', 'aria-pressed': String(filter === id), onclick: () => { filter = id; update(); } }, label, num(n));
    }).filter(Boolean));
    const fn = FILTERS.find((f) => f[0] === filter)[2];
    const items = all.filter(fn).filter((m) => !q || `${m.minutes?.title ?? ''} ${m.summary ?? ''}`.toLowerCase().includes(q));
    const failedOnes = items.filter((m) => !BUSY.includes(m.minutes?.status) && m.minutes?.status !== 'done');
    bulk.replaceChildren(...(filter === 'rest' && failedOnes.length > 1 ? [
      h('span', null, `회의록이 없는 녹음 ${failedOnes.length}개`),
      h('button', { class: 'btn small', onclick: () => trashMeetings(failedOnes) }, icon('i-trash'), '모두 휴지통으로'),
    ] : []));
    if (!all.length && issues.has('folder')) list.replaceChildren(folderEmpty());
    else if (!all.length) list.replaceChildren(h('div', { class: 'empty' }, h('b', null, '아직 회의 녹음이 없습니다'), '회의를 시작할 때 위쪽 회의 녹음을 누르세요. 끝나면 녹취와 회의록이 만들어집니다. 다른 앱에서 녹음한 파일은 가져오거나 여기로 끌어다 놓으세요.', h('br'),
      h('div', { style: 'display:inline-flex; gap:8px' }, h('button', { class: 'btn rec', onclick: openMeetingStart }, icon('i-rec'), '회의 녹음 시작'), h('button', { class: 'btn', onclick: () => importMeeting() }, icon('i-folder'), '파일 가져오기'))));
    else if (!items.length) list.replaceChildren(h('div', { class: 'empty' }, h('b', null, '맞는 회의가 없습니다'), '검색어나 필터를 바꿔 보세요.'));
    else {
      // 회의록이 있거나 만드는 중인 회의는 카드, 녹음만·실패·들린 말 없음은 한 줄로 접는다
      const out = [];
      let key = null;
      let cards = null;
      let rows = null;
      for (const m of items) {
        const k = dayKey(m.startedAt);
        if (k !== key) {
          key = k;
          const count = items.filter((r) => dayKey(r.startedAt) === k).length;
          out.push(h('div', { class: 'day-head' }, dayLabel(m.startedAt), num(`${count}건`)), (cards = h('div', { class: 'mgrid' })), (rows = h('div', { class: 'mrows' })));
        }
        if (m.minutes?.status === 'done' || BUSY.includes(m.minutes?.status)) cards.append(meetingCard(m));
        else rows.append(meetingRow(m));
      }
      fill(list, out.filter((el) => el.childElementCount || el.classList.contains('day-head')));
    }
  };
  const el = h('div', { class: 'page wide' },
    h('div', { class: 'page-head' }, h('h1', null, '회의', count),
      h('button', { class: 'btn', title: '다른 앱에서 녹음한 파일로 회의록을 만듭니다. 여기로 끌어다 놓아도 됩니다', onclick: () => importMeeting() }, icon('i-folder'), '파일 가져오기'),
      searchBox('제목, 요약 검색', '', (v) => {
        q = v.trim().toLowerCase();
        update();
      })),
    chips, bulk, list);
  // 녹음 파일을 끌어다 놓으면 가져온다 (여러 개면 이름 순서대로 이어 붙임)
  el.ondragover = (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    el.classList.add('drop');
  };
  el.ondragleave = (e) => !el.contains(e.relatedTarget) && el.classList.remove('drop');
  el.ondrop = (e) => {
    e.preventDefault();
    el.classList.remove('drop');
    const paths = [...e.dataTransfer.files].map((f) => api.filePath(f)).filter(Boolean);
    if (paths.length) importMeeting(paths);
  };
  update();
  return { el, update };
}

// 녹음 파일 가져오기: 파일을 고르면(또는 끌어다 놓으면) 확인 창에서 순서·참석 인원·녹음에 담기지 않은 내용을 받고 가져온다
let importing = false;
let importPaths = [];
let importSpeakers = '';
async function importMeeting(paths = null) {
  if (importing) return;
  const files = await api.pickAudio(paths);
  if (!files?.length) return;
  importPaths = files.map((f) => f.path);
  $('importOrder').textContent = files.length > 1 ? `이름 순서대로 이어 붙여 회의 하나로 만듭니다` : '';
  $('importFiles').replaceChildren(...files.map((f) => h('li', null, f.name, f.durationSec ? h('span', { class: 'num' }, clock(f.durationSec)) : null)));
  const box = $('importSpeakers');
  box.replaceChildren(...SPEAKER_CHOICES.map((v) => h('button', { type: 'button', role: 'radio', 'data-n': v, onclick: () => { importSpeakers = v; segPick(box, 'n', v); } }, speakerLabel(v))));
  importSpeakers = '';
  segPick(box, 'n', '');
  $('importNotes').value = '';
  $('importSheet').showModal();
  $('importYes').focus();
}
$('importNo').onclick = () => $('importSheet').close();
$('importClose').onclick = () => $('importSheet').close();
$('importSheet').addEventListener('click', (e) => e.target === $('importSheet') && $('importSheet').close());
$('importYes').onclick = async () => {
  if (importing) return;
  importing = true;
  const btn = $('importYes');
  btn.classList.add('busy');
  btn.lastChild.textContent = '가져오는 중…';
  try {
    const r = await api.importMeeting(importPaths, { notes: $('importNotes').value.trim(), speakers: importSpeakers || null });
    $('importSheet').close();
    toast(r.count > 1 ? `녹음 파일 ${r.count}개를 이어 붙여 가져왔습니다` : '녹음 파일을 가져왔습니다', '받아쓰기와 회의록을 만들기 시작합니다', {
      action: '보기', onAction: () => (location.hash = `#meeting/${encodeURIComponent(r.id)}`),
    });
    loadHistory();
  } catch (err) {
    toast('가져오지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true, ms: 8000 });
  } finally {
    importing = false;
    btn.classList.remove('busy');
    btn.lastChild.textContent = '가져오기';
  }
};

// ── 회의 상세 ───────────────────────────────────────────────────────────
const docCache = new Map(); // 회의 id → { minutes, transcript, scriptClean }
const audio = new Audio(); // 문서 밖에 두어 화면을 다시 그려도 재생이 끊기지 않는다
audio.preload = 'metadata';
let audioFor = null;
let follow = store('follow', true);
const SPEEDS = [1, 1.25, 1.5, 2];

function parseScript(text) {
  return (text ?? '').trim().split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^\[([\d:]+)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/);
    return m ? { at: parseStamp(m[1]), stamp: m[1], who: m[2] ?? null, said: m[3] } : { at: null, stamp: '', who: null, said: line };
  });
}

// 화자 색은 원본 스크립트에 처음 나온 순서로 고정한다 (이름을 바꿔도 색은 그대로)
function speakerOrder(lines) {
  const order = [];
  for (const l of lines) if (l.who && !order.includes(l.who)) order.push(l.who);
  return order;
}

function speakerStats(lines, total) {
  const map = new Map();
  lines.forEach((l, i) => {
    if (!l.who || l.at === null) return;
    const next = lines.slice(i + 1).find((n) => n.at !== null)?.at ?? total;
    const s = map.get(l.who) ?? { who: l.who, sec: 0, lines: 0, first: l.stamp };
    s.sec += Math.max(0, Math.min(next - l.at, 30));
    s.lines++;
    map.set(l.who, s);
  });
  return [...map.values()].sort((a, b) => b.sec - a.sec);
}

let openReviewNext = null; // 알림에서 '확인하기'로 들어오면 확인 필요 탭을 연다

function reviewTag(r) {
  const rv = r.review;
  if (!rv || r.minutes?.status !== 'done') return null;
  if (rv.finalized) return h('span', { class: 'tag' }, '확정');
  return h('span', { class: 'tag accent' }, rv.open ? `초안 · 확인 ${rv.open}개` : '초안 · 확인 마치기 전');
}

const REVIEW_KIND = { word: '오인식', name: '이름', meaning: '의미 불명', lost: '유실' };

function pageMeeting(id) {
  const el = h('div', { class: 'page' });
  let tab = null;
  const reviewSel = new Set(); // 확인 필요에서 고른 항목
  const guessDraft = new Map(); // 항목별로 고쳐 쓴 '고칠 말'
  let reviewFilter = 'open';
  let chat = null; // { ids, messages: [{ role, text, proposals }], busy }
  if (openReviewNext === id) {
    tab = 'review';
    openReviewNext = null;
  }
  let lastKey = null;
  // 회의록 진행 상태와 확인 필요 숫자(제목 아래 배지)가 바뀌면 다시 그린다
  const stateKey = (r) => JSON.stringify([r.minutes?.status, r.minutes?.progress, r.minutes?.diarizing, r.minutes?.updatedAt, r.minutes?.title, r.review?.open, r.review?.finalized]);
  let lineEls = [];
  let lineTimes = [];
  let playingIdx = -1;
  let player = null;

  const r0 = history.find((m) => m.id === id);
  if (!r0) {
    el.append(h('div', { class: 'empty gone' }, h('b', null, '삭제된 녹음입니다'), '휴지통으로 옮겼거나 폴더를 옮긴 회의입니다. Finder 휴지통에서 되살리면 다시 보입니다.', h('br'),
      h('div', { style: 'display:flex;gap:8px;justify-content:center' },
        navIndex > 0 && h('button', { class: 'btn', onclick: () => window.history.back() }, icon('i-left'), '뒤로'),
        h('button', { class: 'btn', onclick: () => replaceRoute('#meetings') }, '회의 목록'))));
    setTimeout(() => setCrumbs('삭제된 녹음'));
    return { el };
  }

  if (audioFor !== id) {
    audio.pause();
    audio.src = r0.firstFile ? `rec://m/${encodeURIComponent(r0.id)}/${encodeURIComponent(r0.firstFile)}` : '';
    audioFor = id;
  }

  const seek = (sec, play = true) => {
    audio.currentTime = sec;
    if (play) audio.play();
  };

  async function draw() {
    const r = history.find((m) => m.id === id);
    if (!r) return;
    const m = r.minutes;
    const s = m?.status;
    lastKey = stateKey(r);
    let doc = docCache.get(id);
    if (!doc && ['done', 'error', 'empty'].includes(s)) {
      doc = await api.readMinutes(r.dir);
      docCache.set(id, doc);
    }
    doc ??= {};
    const raw = parseScript(doc.transcript);
    const order = speakerOrder(raw);
    const color = (who) => {
      const i = order.indexOf(who);
      return i >= 0 ? `var(--s${(i % 6) + 1})` : 'var(--line-2)';
    };
    const title = s === 'done' ? m.title ?? '제목 없는 회의' : `${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))} 회의`;
    setCrumbs(title);

    const tabs = [];
    if (doc.minutes) tabs.push(['minutes', '회의록']);
    const reviewOpen = doc.review?.items?.filter((it) => it.status === 'open').length ?? 0;
    if (doc.review?.items?.length || /^## 확인 필요/m.test(doc.minutes ?? '')) tabs.push(['review', '확인 필요', doc.review ? `${reviewOpen}` : null]);
    // 액션: 확인된 할 일·조언이 있을 때만 (대화에 따라 생기고 무조건 생기지 않는다)
    const acts = doc.actions;
    if (acts && (acts.actions?.length || acts.advice?.length)) tabs.push(['actions', '액션', acts.actions.length ? `${acts.actions.filter((a) => !a.done).length}` : null]);
    if (doc.transcript) tabs.push(['clean', '정리본'], ['raw', '원본'], ['speakers', '화자', order.length ? `${order.length}명` : null]);
    if (!tabs.some((t) => t[0] === tab)) tab = tabs[0]?.[0] ?? null;

    const head = h('div', { class: 'meet-head' },
      h('div', { style: 'flex:1;min-width:0' },
        h('h1', null, title),
        h('div', { class: 'meet-meta' },
          h('span', { class: 'tag' }, FULL.format(new Date(r.startedAt))),
          h('span', { class: 'tag' }, num(clock(r.durationSec))),
          m?.speakers && h('span', { class: 'tag' }, `화자 ${m.speakers}명`),
          r.speakersHint && h('span', { class: 'tag' }, `참석 인원 ${speakerLabel(String(r.speakersHint))}로 지정`),
          s === 'done' && r.review && h('button', { class: `tag tag-btn${r.review.finalized ? '' : ' accent'}`, title: '확인 필요 보기', onclick: () => { tab = 'review'; draw(); } },
            r.review.finalized ? '확정된 회의록' : r.review.open ? `초안 · 확인 ${r.review.open}개 남음` : '초안 · 확인 마치기 전'),
          s === 'done' && m.provider && h('span', { class: 'tag' }, `${PROVIDER_NAME[m.provider] ?? m.provider}로 작성`),
          m?.timing?.model && h('span', { class: 'tag' }, `Whisper ${m.timing.model}`),
          m?.diarizeError && h('span', { class: 'tag accent' }, `화자 구분 실패: ${m.diarizeError}`))),
      meetingActions(r, doc));

    lineEls = [];
    lineTimes = [];
    playingIdx = -1;
    player = r.firstFile ? playerBar(r, raw, color, doc.speech) : null;

    const body = h('div');
    findScope = body;
    const matcher = termMatcher(doc.glossary?.terms);
    closeTermCard();
    removeAddBtn();
    if (tab === 'minutes') body.append(minutesDoc(r, doc.minutes, reviewOpen, () => { tab = 'review'; draw(); }, matcher));
    else if (tab === 'review') body.append(reviewView(r, doc));
    else if (tab === 'actions') body.append(actionsView(r, doc.actions));
    else if (tab === 'clean' || tab === 'raw') {
      const text = tab === 'clean' ? doc.scriptClean : doc.transcript;
      const bar = h('div', { class: 'tab-bar' },
        h('span', null, tab === 'clean' ? '맞장구·하다 만 말·잡담을 쳐내고, 같은 사람이 이어서 한 말을 한 줄로 합친 스크립트입니다.' : '녹취 그대로의 스크립트입니다.'),
        text && copyButton(text, '스크립트 복사'));
      body.append(bar);
      if (text) body.append(scriptView(r, parseScript(text), color, seek, matcher));
      else {
        const make = h('button', { class: 'btn primary' }, '정리본 만들기');
        make.onclick = async () => {
          make.classList.add('busy'); // 흐리게 하지 않고 진행 중 표시
          make.textContent = '만드는 중… (1~2분)';
          await api.cleanScript(r.dir);
          docCache.delete(id);
          draw();
        };
        body.append(h('div', { class: 'state' }, h('b', null, '정리본이 아직 없습니다'), h('p', null, '대화 흐름과 상관없는 말을 쳐낸 정리본을 만듭니다.'), h('div', { class: 'row' }, make)));
      }
    } else if (tab === 'speakers') body.append(speakersView(r, raw, color));

    fill(el, 
      head,
      order.length > 0 && speakerBar(r, order, color),
      player?.el,
      s !== 'done' && stateCard(r),
      tabs.length > 0 && h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([tid, label, n]) =>
        h('button', { class: 'tab', role: 'tab', 'aria-selected': String(tid === tab), onclick: () => { tab = tid; draw(); } }, label, n && num(n)))),
      body,
      chat && chatDrawer(r, doc),
      flowChat && flowChatDrawer(r, doc));
    syncPlaying(true);
    if (findBar) runFind({ keep: true }); // 탭을 바꾸거나 다시 그려도 찾던 말을 그대로 표시
  }

  function scriptView(r, lines, color, seekTo, matcher = null) {
    const box = h('div', { class: 'script' });
    for (const l of lines) {
      const row = h('div', { class: 'sline' },
        h('button', { class: 'stime', title: '여기부터 듣기', onclick: () => l.at !== null && seekTo(l.at) }, l.stamp),
        l.who ? h('button', { class: 'who', title: '눌러서 이름 바꾸기', onclick: (e) => renameSpeaker(e.currentTarget, r, l.who) }, h('i', { style: `background:${color(l.who)}` }), l.who) : h('span'),
        h('span', { class: 'ssaid' }, ...withTerms(l.said, matcher)));
      box.append(row);
      if (l.at !== null) {
        lineEls.push(row);
        lineTimes.push(l.at);
      }
    }
    return box;
  }

  function renameSpeaker(btn, r, from) {
    const input = h('input', { type: 'text', class: 'rename', value: from });
    btn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const to = input.value.trim();
      if (save && to && to !== from) {
        await api.renameSpeaker(r.dir, from, to);
        docCache.delete(r.id);
        toast(`'${from}'을 '${to}'(으)로 바꿨습니다`, '회의록과 스크립트에 모두 반영했습니다');
      }
      draw();
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
  }

  function speakersView(r, raw, color) {
    const stats = speakerStats(raw, r.durationSec);
    const total = stats.reduce((n, s) => n + s.sec, 0) || 1;
    if (!stats.length) return h('div', { class: 'state' }, h('b', null, '화자 구분 결과가 없습니다'), h('p', null, '설정 › 회의에서 화자 구분을 켜고 회의록을 다시 만들면 누가 말했는지 표시됩니다.'));
    return h('div', { class: 'spk-list' },
      h('p', { class: 'hint', style: 'margin:0 0 6px' }, '이름을 누르면 바꿀 수 있습니다. 말한 시간은 스크립트 줄 간격으로 어림한 값입니다.'),
      stats.map((s) => h('div', { class: 'spk' },
        h('div', { class: 'spk-name' }, h('i', { style: `background:${color(s.who)}` }), h('button', { onclick: (e) => renameSpeaker(e.currentTarget, r, s.who) }, s.who)),
        h('div', { class: 'share' }, h('i', { style: `width:${(s.sec / total) * 100}%;background:${color(s.who)}` })),
        h('span', { class: 'num' }, `${Math.round((s.sec / total) * 100)}%`),
        h('div', { class: 'spk-sub' }, `약 ${clock(s.sec)} · ${fmt.format(s.lines)}줄 · 처음 말한 시각 `, h('button', { class: 'seek', onclick: () => seek(parseStamp(s.first)) }, s.first)))));
  }

  // ── 용어 설명: 회의록·정리본·원본의 용어에 밑줄, 누르면 한 줄 설명 카드 ──────────
  // 낱말 속 글자에는 긋지 않는다 ('나'가 '모르거나'·'나눈'에 붙지 않게): 앞에 글자가 없고,
  // 뒤가 끝·글자 아닌 것·조사(뒤에 한글이 더 이어지지 않을 때)일 때만. 화면 표시만 하고 파일은 고치지 않는다
  const JOSA_AFTER = '은|는|이|가|을|를|의|도|에|에서|에게|께서|과|와|로|으로|만|까지|부터|처럼|보다|이나|랑|이랑|이다|입니다';
  function termMatcher(terms) {
    const list = (terms ?? []).filter((t) => t.term).sort((a, b) => b.term.length - a.term.length);
    if (!list.length) return null;
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![가-힣A-Za-z0-9])(${list.map((t) => esc(t.term)).join('|')})(?=$|[^가-힣A-Za-z0-9]|(?:${JOSA_AFTER})(?![가-힣]))`, 'g');
    return { re, byTerm: new Map(list.map((t) => [t.term, t])) };
  }

  // 글에서 용어를 찾아 밑줄 요소로 바꾼 조각들. seen: 한 문단·한 줄 안에서는 처음 나온 곳에만 긋는다
  function withTerms(text, matcher, seen = new Set()) {
    if (!matcher || !text) return [text];
    const out = [];
    let last = 0;
    for (const m of text.matchAll(matcher.re)) {
      const t = matcher.byTerm.get(m[1]);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      if (m.index > last) out.push(text.slice(last, m.index));
      const open = (e) => termCard(e.currentTarget, t);
      out.push(h('span', { class: `term${t.status === 'confirmed' ? '' : ' guess'}`, role: 'button', tabindex: 0, title: t.note, onclick: open, onkeydown: (e) => e.key === 'Enter' && open(e) }, m[1]));
      last = m.index + m[1].length;
    }
    out.push(text.slice(last));
    return out;
  }

  const BASIS_LABEL = { general: '일반 용어', meeting: '회의 내용에서', unknown: '회의에서 설명 없음' };
  let cardEl = null;
  const outsideCard = (e) => cardEl && !cardEl.contains(e.target) && !e.target.closest?.('.term, .gl-item') && closeTermCard();
  const escCard = (e) => e.key === 'Escape' && closeTermCard();
  function closeTermCard() {
    cardEl?.remove();
    cardEl = null;
    document.removeEventListener('mousedown', outsideCard, true);
    document.removeEventListener('keydown', escCard, true);
  }

  async function changeTerm(r, termId, patch, done) {
    try {
      await api.updateTerm(r.dir, termId, patch);
      if (done) toast(done);
    } catch (err) {
      toast('바꾸지 못했습니다', err.message, { bad: true });
    }
    closeTermCard();
    refreshDoc(r);
  }

  function termCard(anchor, t, editing = false) {
    closeTermCard();
    const r = history.find((m) => m.id === id);
    if (!r) return;
    const guess = t.status !== 'confirmed';
    const note = editing ? h('textarea', { class: 'tc-edit', rows: 3, maxlength: 200, 'aria-label': '설명' }) : h('p', { class: 'tc-note' }, t.note);
    if (editing) note.value = t.note;
    const acts = editing
      ? [h('button', { class: 'btn small primary', onclick: () => note.value.trim() && changeTerm(r, t.id, { note: note.value }, '설명을 고쳤습니다') }, '저장'),
        h('button', { class: 'btn small', onclick: () => termCard(anchor, t) }, '취소')]
      : [guess && h('button', { class: 'btn small primary', onclick: () => changeTerm(r, t.id, { status: 'confirmed' }) }, icon('i-check'), '맞아요'),
        h('button', { class: 'btn small', onclick: () => termCard(anchor, t, true) }, icon('i-pencil'), '고치기'),
        h('button', { class: 'btn small ghost', onclick: () => changeTerm(r, t.id, { remove: true }, `'${t.term}' 설명을 지웠습니다`) }, '지우기')];
    cardEl = h('div', { class: 'term-card', role: 'dialog', 'aria-label': `${t.term} 설명` },
      h('div', { class: 'tc-head' }, h('b', null, t.term),
        h('span', { class: `tc-badge${guess ? ' guess' : ''}` }, guess ? 'LLM 추정 · 확인 전' : t.edited ? '직접 고침' : BASIS_LABEL[t.basis] ?? '')),
      note,
      !editing && t.at?.length > 0 && h('div', { class: 'tc-at' }, h('span', null, '회의에서 나온 곳'),
        t.at.map((s) => (r.firstFile ? h('button', { class: 'seek', title: '여기부터 듣기', onclick: () => seek(parseStamp(s)) }, s) : h('span', { class: 'num' }, s)))),
      h('div', { class: 'tc-acts' }, acts));
    document.body.append(cardEl);
    // 용어 아래에, 화면 밖으로 나가면 위로
    const a = anchor.getBoundingClientRect();
    const c = cardEl.getBoundingClientRect();
    const top = a.bottom + 6 + c.height > innerHeight - 8 ? Math.max(8, a.top - 6 - c.height) : a.bottom + 6;
    cardEl.style.top = `${top}px`;
    cardEl.style.left = `${Math.min(Math.max(8, a.left), innerWidth - c.width - 8)}px`;
    if (editing) note.focus();
    setTimeout(() => {
      document.addEventListener('mousedown', outsideCard, true);
      document.addEventListener('keydown', escCard, true);
    });
  }

  // 회의록 아래 '용어' 칸: 설명을 스티커처럼 모아 보여 주고, 확인 전인 것은 한 번에 확인
  function glossaryBox(r, g) {
    const terms = g?.terms ?? [];
    const guesses = terms.filter((t) => t.status !== 'confirmed');
    const make = h('button', { class: 'btn small', onclick: async () => {
      make.classList.add('busy');
      make.setAttribute('aria-busy', 'true');
      make.textContent = '용어 찾는 중… (10초 안팎)';
      try {
        await api.makeGlossary(r.dir);
      } catch (err) {
        toast('용어 설명을 만들지 못했습니다', err.message, { bad: true });
      }
      refreshDoc(r);
    } }, g ? '추정 설명 다시 찾기' : '용어 설명 만들기');
    return h('section', { class: 'glossary' },
      h('div', { class: 'glossary-head' }, h('h3', null, '용어', terms.length > 0 && num(terms.length)), h('span', { style: 'flex:1' }),
        guesses.length > 1 && h('button', { class: 'btn small', onclick: () => changeTerm(r, '*', { status: 'confirmed' }, `${guesses.length}개를 확인했습니다`) }, icon('i-check'), `확인 전 ${guesses.length}개 모두 확인`),
        make),
      h('p', { class: 'hint' }, terms.length
        ? '밑줄 친 말을 누르면 설명을 볼 수 있습니다. 점선은 LLM이 회의 내용으로 추정한 설명입니다. 본문에서 단어를 드래그하면 설명을 더할 수 있습니다.'
        : '회의록에 나온 사내 용어·약어·기술 용어에 한 줄 설명을 붙입니다. 본문에서 단어를 드래그해 하나씩 더할 수도 있습니다.'),
      terms.length > 0 && h('div', { class: 'gl-grid' }, terms.map((t) =>
        h('button', { class: `gl-item${t.status === 'confirmed' ? '' : ' guess'}`, onclick: (e) => termCard(e.currentTarget, t) },
          h('b', null, t.term), h('span', null, t.note), t.status !== 'confirmed' && h('i', { class: 'gl-badge' }, '추정')))));
  }

  // ── 액션 (src/actions.js): 할 일(약속·맡은 일·다짐)과 받은 조언·알아 둘 것. 회의록과 따로 actions.json에 ──
  const ACTION_KIND = { promise: '약속', assigned: '맡음', resolution: '다짐' };
  function actionsView(r, data) {
    const stamp = (at) => (r.firstFile ? h('button', { class: 'seek', title: '여기부터 듣기', onclick: () => seek(parseStamp(at)) }, at) : h('span', { class: 'num' }, at));
    const todo = h('section', { class: 'act-sec' },
      h('div', { class: 'act-head' }, h('h3', null, '할 일'), data.actions.length > 0 && num(`${data.actions.filter((a) => a.done).length}/${data.actions.length}`)),
      data.actions.length
        ? h('ul', { class: 'act-list' }, data.actions.map((a) => {
          const cb = h('input', { type: 'checkbox', checked: a.done, 'aria-label': '했음' });
          const li = h('li', { class: `act-item${a.done ? ' done' : ''}`, title: `녹취: “${a.quote}”` }, cb,
            h('div', { class: 'act-body' }, h('span', { class: 'act-task' }, a.task),
              h('div', { class: 'act-meta' }, h('span', { class: 'flane' }, a.owner), a.due && h('span', { class: 'flane due' }, a.due), h('span', { class: 'act-kind' }, ACTION_KIND[a.kind] ?? ''), stamp(a.at))));
          cb.onchange = async () => {
            li.classList.toggle('done', cb.checked);
            await api.toggleAction(r.dir, a.id, cb.checked);
            docCache.delete(r.id);
            loadHistory();
          };
          return li;
        }))
        : h('p', { class: 'act-empty' }, '약속하거나 맡은 할 일은 없었습니다.'));
    const keys = data.advice.filter((a) => a.key);
    const groups = [...new Set(data.advice.map((a) => a.group))];
    const who = (a) => (a.from || a.to) && h('span', { class: 'act-who' }, `${a.from ?? ''}${a.to ? ` → ${a.to}` : ''}`);
    const advice = data.advice.length > 0 && h('section', { class: 'act-sec' },
      h('div', { class: 'act-head' }, h('h3', null, data.adviceTitle ?? '받은 조언'), num(String(data.advice.length))),
      keys.length > 0 && h('div', { class: 'act-keys' }, keys.map((a) => h('div', { class: 'act-key', title: `녹취: “${a.quote}”` },
        h('b', null, '★ ', a.text), a.why && h('p', null, a.why), h('div', { class: 'act-meta' }, who(a), stamp(a.at))))),
      groups.map((g) => h('div', { class: 'act-group' }, h('h4', null, g),
        h('ul', null, data.advice.filter((a) => a.group === g).map((a) => h('li', { title: `녹취: “${a.quote}”` },
          h('span', null, a.key && '★ ', a.text), h('span', { class: 'act-meta inline' }, who(a), stamp(a.at))))))));
    const again = h('button', { class: 'btn small ghost', onclick: () => findActions(r, again) }, icon('i-redo'), h('span', null, '다시 찾기'));
    return h('div', { class: 'acts' },
      h('div', { class: 'tab-bar' }, h('span', null, '회의가 끝난 뒤 챙길 것입니다. LLM이 원본·정리본·회의록을 보고 고르고, 각 항목의 녹취 인용을 앱이 확인했습니다. 체크는 회의록의 할 일과 따로 저장됩니다.'), again),
      todo, advice);
  }

  async function findActions(r, btn) {
    btn.classList.add('busy');
    btn.lastChild.textContent = '찾는 중… (1분 안팎)';
    try {
      const res = await api.makeActions(r.dir);
      toast(res.actions.length || res.advice.length ? '액션을 정리했습니다' : '챙길 할 일이나 조언을 찾지 못했습니다',
        res.actions.length || res.advice.length ? `할 일 ${res.actions.length}개 · ${res.adviceTitle ?? '조언'} ${res.advice.length}개` : '이 대화에는 약속한 일이나 남길 조언이 없었습니다', { ms: 7000 });
      if (res.actions.length || res.advice.length) tab = 'actions';
    } catch (err) {
      toast('액션을 정리하지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true });
    }
    refreshDoc(r);
  }

  // 이 기능 전에 만든 회의: 회의록 아래에 '액션 찾기'
  function actionsRow(r) {
    const btn = h('button', { class: 'btn small', onclick: () => findActions(r, btn) }, icon('i-check'), h('span', null, '액션 찾기'));
    return h('div', { class: 'flow-row' },
      h('div', { class: 'flow-row-text' }, h('b', null, '액션'), h('span', null, '약속하거나 맡은 할 일과 받은 조언을 찾아 따로 정리합니다. 있을 때만 "액션" 탭이 생깁니다.')),
      h('div', { class: 'flow-row-acts' }, btn));
  }

  // ── 흐름도 (src/flow.js): 사용자가 요청한 회의만. 회의록 요약 아래에 그림마다 카드 — 한 줄 요약·채팅·다시 만들기·지우기 ──
  // 배치는 고정된 규칙: 띠(도구·담당)마다 가로줄, 같은 띠에서는 오른쪽으로, 띠를 바꾸면 같은 칸 위아래로 내려가고(꺾은선),
  // 메모는 해당 단계 칸 아래에, 바뀐 경위는 해당 단계 위에 점선 호로. 색은 앱 값(CSS 변수), LLM 글은 글자로만 넣는다
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}, ...kids) => {
    const e = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, String(v));
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
    return e;
  };
  let measureCtx = null;
  // 글자 폭을 재서 줄을 나눈다 (낱말 단위, 너무 긴 낱말은 글자 단위), 넘치면 말줄임
  function wrapText(text, px, weight, maxW, maxLines) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    measureCtx.font = `${weight} ${px}px ${getComputedStyle(document.body).fontFamily}`;
    const fits = (t) => measureCtx.measureText(t).width <= maxW;
    const lines = [];
    for (const para of String(text ?? '').split('\n')) {
      let cur = '';
      for (const word of para.split(/(\s+)/)) {
        if (fits(cur + word)) cur += word;
        else if (fits(word.trim())) {
          lines.push(cur.trim());
          cur = word.trim();
        } else {
          for (const ch of word) {
            if (fits(cur + ch)) cur += ch;
            else {
              lines.push(cur);
              cur = ch.trim();
            }
          }
        }
      }
      lines.push(cur.trim());
    }
    const out = lines.filter((l, i) => l || i === 0);
    if (out.length > maxLines) {
      out.length = maxLines;
      let last = out[maxLines - 1];
      while (last && !fits(`${last}…`)) last = last.slice(0, -1);
      out[maxLines - 1] = `${last}…`;
    }
    return out;
  }

  // 화살표 순서대로 단계를 늘어놓는다 (들어오는 화살표가 없는 단계부터, 갈래는 나온 순서대로)
  function flowOrder(f) {
    const next = new Map(f.steps.map((s) => [s.id, []]));
    const into = new Set();
    for (const e of f.edges) {
      next.get(e.from)?.push(e.to);
      into.add(e.to);
    }
    const out = [];
    const seen = new Set();
    const visit = (id) => {
      if (seen.has(id) || !next.has(id)) return;
      seen.add(id);
      out.push(id);
      for (const n of next.get(id)) visit(n);
    };
    for (const s of f.steps) if (!into.has(s.id)) visit(s.id);
    for (const s of f.steps) visit(s.id);
    return out.map((id) => f.steps.find((s) => s.id === id));
  }

  const FLOW = { BW: 164, GX: 36, GY: 46, PAD: 18, LABEL: 104 };

  // 띠가 있는 흐름의 칸: 같은 띠는 오른쪽으로, 띠를 바꾸면 같은 칸 위아래로 (처음 들어가는 빈 띠만 한 칸 당겨 폭을 줄인다)
  function placeLanes(steps, laneIdx) {
    const pos = new Map();
    const last = new Map();
    let prev = null;
    for (const s of steps) {
      const row = laneIdx.get(s.lane) ?? 0;
      const after = (last.get(row) ?? -1) + 1;
      const col = !prev ? 0 : prev.row === row ? prev.col + 1 : last.has(row) ? Math.max(after, prev.col) : Math.max(after, prev.col - 1);
      last.set(row, col);
      prev = { row, col };
      pos.set(s.id, prev);
    }
    return pos;
  }

  // part: 넓은 그림을 여러 줄로 접을 때 한 줄에 들어갈 단계와 칸 (번호·띠 색은 그림 전체 기준을 이어 쓴다)
  function flowSvgH(r, f, part = null, per = 4) {
    const { BW, GX, GY, PAD } = FLOW;
    const allLanes = f.lanes?.length > 1 ? f.lanes : [];
    const steps = part?.steps ?? flowOrder(f);
    const lanes = part?.lanes ?? allLanes;
    const notesIn = [...(f.notes ?? [])];
    let arcs = [];
    const laneIdx = new Map(lanes.map((l, i) => [l.id, i]));
    const colorIdx = new Map(allLanes.map((l, i) => [l.id, i]));
    const laneColor = (id) => (colorIdx.has(id) ? `var(--s${(colorIdx.get(id) % 6) + 1})` : 'var(--ink)');
    const numOf = part?.number ?? new Map(steps.map((s, i) => [s.id, i + 1]));
    const LABEL = lanes.length ? FLOW.LABEL : 0;
    // 칸 정하기
    const pos = part?.pos ?? new Map();
    if (part) {
      // 칸은 이미 정해 왔다
    } else if (lanes.length) {
      for (const [id, p] of placeLanes(steps, laneIdx)) pos.set(id, p);
    } else {
      steps.forEach((s, i) => pos.set(s.id, { row: Math.floor(i / per), col: i % per }));
    }
    // 바뀐 경위: 같은 줄의 서로 다른 두 단계를 잇는 것만 호로, 나머지는 그 단계의 메모(정보)로
    for (const a of f.annotations ?? []) {
      const p = pos.get(a.from);
      const q = pos.get(a.to);
      if (!p || !q) continue;
      if (p.row === q.row && a.from !== a.to) arcs.push(a);
      else notesIn.push({ step: a.to, kind: 'info', text: a.text, at: a.at, quote: a.quote });
    }
    arcs = arcs.slice(0, 2);
    const rows = Math.max(...[...pos.values()].map((p) => p.row)) + 1;
    const cols = Math.max(...[...pos.values()].map((p) => p.col)) + 1;
    // 상자 높이: 가장 긴 내용에 맞춘다
    const box = new Map(steps.map((s) => [s.id, { title: wrapText(s.title, 14, 700, BW - (s.optional ? 82 : 52), 2), detail: wrapText(s.detail, 12.5, 400, BW - 28, 3) }]));
    const BH = 30 + Math.max(...[...box.values()].map((b) => b.title.length * 19 + b.detail.length * 18)) + 34;
    // 줄마다 위쪽 여유: 바뀐 경위 호가 있으면 더
    const annRows = new Set(arcs.map((a) => pos.get(a.from).row));
    const rowTop = [];
    let y = PAD + (annRows.has(0) ? 30 : 4);
    for (let i = 0; i < rows; i++) {
      if (i) y += annRows.has(i) ? 30 : 0;
      rowTop.push(y);
      y += BH + GY;
    }
    const IN = part?.in?.length ? 64 : 0; // 앞 줄에서 이어지는 화살표 자리
    const xOf = (c) => PAD + LABEL + IN + c * (BW + GX);
    const bandTop = (i) => rowTop[i] - (annRows.has(i) ? 26 : 10);
    const bandBottom = (i) => rowTop[i] + BH + 10;
    const gapY = (i) => (i + 1 < rows ? (bandBottom(i) + bandTop(i + 1)) / 2 : bandBottom(i) + GY / 2); // i줄과 i+1줄 사이
    const at = (id) => {
      const p = pos.get(id);
      return { x: xOf(p.col), y: rowTop[p.row], ...p };
    };
    // 메모: 단계 칸 아래에 쌓는다
    const notesTop = rowTop[rows - 1] + BH + 26;
    const noteBoxes = [];
    const colY = new Map();
    for (const n of notesIn) {
      if (!pos.has(n.step)) continue;
      const lines = wrapText(n.text, 12.5, 400, BW - 44, 4);
      const h = 18 + lines.length * 18 + 26;
      const c = pos.get(n.step).col;
      const ny = colY.get(c) ?? notesTop;
      noteBoxes.push({ n, lines, x: xOf(c), y: ny, h });
      colY.set(c, ny + h + 10);
    }
    const W = xOf(cols) - GX + PAD + (part?.out?.length ? 70 : 0);
    const H = Math.max(notesTop - 26, ...noteBoxes.map((b) => b.y + b.h)) + PAD;

    const stamp = (x, yy, t) => {
      const w = 10 + t.length * 7.3;
      const g = svgEl('g', { class: `fl-stamp${r.firstFile ? ' play' : ''}`, transform: `translate(${x} ${yy})` },
        svgEl('rect', { width: w, height: 19, rx: 5 }), svgEl('text', { x: 5, y: 13.5 }, t));
      if (r.firstFile) {
        g.addEventListener('click', () => seek(parseStamp(t)));
        g.append(svgEl('title', {}, '여기부터 듣기'));
      }
      return g;
    };
    const svg = svgEl('svg', { class: 'flow-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': f.title });
    // 앱 전체 svg 규칙(아이콘 16px)보다 앞서게. 넓으면 화면 폭에 맞춰 줄인다 (원래 크기보다 키우지는 않음)
    svg.style.width = '100%';
    svg.style.maxWidth = `${W}px`;
    svg.style.height = 'auto';
    const mid = `fl-arrow-${f.id}-${Math.random().toString(36).slice(2, 7)}`;
    svg.append(svgEl('defs', {}, svgEl('marker', { id: mid, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'fl-arrowhead' }))));
    // 띠
    lanes.forEach((l, i) => {
      svg.append(svgEl('rect', { x: PAD - 6, y: bandTop(i), width: W - 2 * PAD + 12, height: bandBottom(i) - bandTop(i), rx: 12, class: 'fl-lane' }));
      svg.append(svgEl('text', { x: PAD + 8, y: rowTop[i] + 20, class: 'fl-lane-name', style: `fill:${laneColor(l.id)}` }, l.name));
      wrapText(l.desc, 11.5, 400, LABEL - 22, 3).forEach((t, k) => svg.append(svgEl('text', { x: PAD + 8, y: rowTop[i] + 40 + k * 16, class: 'fl-lane-desc' }, t)));
    });
    // 화살표 (상자 밑에 그린다)
    const edgeLayer = svgEl('g', { class: 'fl-edges' });
    for (const e of f.edges ?? []) {
      if (!pos.has(e.from) || !pos.has(e.to)) continue;
      const a = at(e.from);
      const b = at(e.to);
      let d;
      if (a.row === b.row && b.col > a.col) d = `M${a.x + BW} ${a.y + BH / 2} L${b.x - 3} ${b.y + BH / 2}`;
      else if (a.row === b.row) d = `M${a.x + BW / 2} ${a.y} V${a.y - 14} H${b.x + BW / 2} V${b.y - 3}`;
      else if (a.col === b.col && Math.abs(b.row - a.row) === 1) d = b.row > a.row ? `M${a.x + BW / 2} ${a.y + BH} V${b.y - 3}` : `M${a.x + BW / 2} ${a.y} V${b.y + BH + 3}`;
      // 다른 줄·다른 칸: 세로 → 두 줄 사이 빈 곳에서 가로 → 세로로 꺾어 상자·글을 가로지르지 않는다
      // 두 줄 이상 건너가면 칸 사이 세로 통로로 내려가 가운데 줄의 상자를 가로지르지 않는다
      else if (Math.abs(b.row - a.row) > 1) {
        // 상자 옆면(받는 단계 쪽)에서 나가 바로 옆 통로로 내려간다 → 위아래로 드나드는 다른 선·바뀐 경위 글과 겹치지 않는다
        const left = b.col < a.col; // 같은 칸이면 오른쪽 통로로
        const sx = left ? a.x : a.x + BW;
        const lane = left ? a.x - GX / 2 : a.x + BW + GX / 2;
        const down = b.row > a.row;
        d = `M${sx} ${a.y + BH / 2} H${lane} V${down ? gapY(b.row - 1) : gapY(b.row)} H${b.x + BW / 2} V${down ? b.y - 3 : b.y + BH + 3}`;
      } else if (b.row > a.row) d = `M${a.x + BW / 2} ${a.y + BH} V${gapY(a.row)} H${b.x + BW / 2} V${b.y - 3}`;
      else d = `M${a.x + BW / 2} ${a.y} V${gapY(b.row)} H${b.x + BW / 2} V${b.y + BH + 3}`;
      edgeLayer.append(svgEl('path', { d, class: 'fl-edge', 'marker-end': `url(#${mid})` }));
    }
    svg.append(edgeLayer);
    // 바뀐 경위: 해당 단계들 위에 점선 호와 글
    for (const a of arcs) {
      const p = at(a.from);
      const q = at(a.to);
      const x1 = Math.min(p.x, q.x) + BW / 2 - 40;
      const x2 = Math.max(p.x, q.x) + BW / 2 + 40;
      const top = q.y - 6;
      svg.append(svgEl('path', { d: `M${x1} ${top} Q${(x1 + x2) / 2} ${top - 22} ${x2} ${top}`, class: 'fl-anno-arc' }));
      svg.append(svgEl('text', { x: (x1 + x2) / 2, y: top - 16, class: 'fl-anno' }, a.text));
    }
    // 단계 상자
    steps.forEach((s, i) => {
      const p = at(s.id);
      const b = box.get(s.id);
      const g = svgEl('g', { class: `fl-step${s.optional ? ' optional' : ''}`, transform: `translate(${p.x} ${p.y})` },
        svgEl('title', {}, `녹취: “${s.quote}”`),
        svgEl('rect', { width: BW, height: BH, rx: 12, class: 'fl-box' }),
        svgEl('circle', { cx: 21, cy: 23, r: 11, style: `fill:${laneColor(s.lane)}` }),
        svgEl('text', { x: 21, y: 27.5, class: 'fl-num' }, String(numOf.get(s.id))),
        b.title.map((t, k) => svgEl('text', { x: 40, y: 28 + k * 19, class: 'fl-title' }, t)),
        b.detail.map((t, k) => svgEl('text', { x: 14, y: 30 + b.title.length * 19 + 6 + k * 18, class: 'fl-detail' }, t)),
        s.optional && svgEl('text', { x: BW - 12, y: 27, class: 'fl-tag' }, '선택'));
      g.append(stamp(14, BH - 30, s.at));
      svg.append(g);
    });
    // 줄을 넘어가는 화살표: 오른쪽 끝으로 '다음 줄 N번으로', 왼쪽 끝에서 'N번에서 이어짐'
    for (const o of part?.out ?? []) {
      const p = at(o.from);
      svg.append(svgEl('path', { d: `M${p.x + BW} ${p.y + BH / 2} H${W - PAD + 2}`, class: 'fl-edge', 'marker-end': `url(#${mid})` }));
      svg.append(svgEl('text', { x: W - PAD, y: p.y + BH / 2 - 8, class: 'fl-cont end' }, `다음 줄 ${o.toNum}번으로`));
    }
    for (const o of part?.in ?? []) {
      const p = at(o.to);
      const x0 = PAD + LABEL + 4;
      svg.append(svgEl('path', { d: `M${x0} ${p.y + BH / 2} H${p.x - 3}`, class: 'fl-edge dashed', 'marker-end': `url(#${mid})` }));
      svg.append(svgEl('text', { x: x0, y: p.y + BH / 2 - 8, class: 'fl-cont' }, `${o.fromNum}번에서`));
    }
    // 메모
    const num = numOf;
    for (const { n, lines, x, y: ny, h } of noteBoxes) {
      const g = svgEl('g', { class: `fl-note ${n.kind}`, transform: `translate(${x} ${ny})` },
        svgEl('rect', { width: BW, height: h, rx: 10 }),
        svgEl('circle', { cx: 16, cy: 18, r: 8 }),
        svgEl('text', { x: 16, y: 22, class: 'fl-note-icon' }, n.kind === 'info' ? 'i' : '!'),
        svgEl('text', { x: BW - 12, y: h - 15, class: 'fl-note-step' }, `${num.get(n.step)}번 단계`),
        lines.map((t, k) => svgEl('text', { x: 32, y: 22 + k * 18, class: 'fl-note-text' }, t)));
      g.append(stamp(32, h - 28, n.at));
      svg.append(g);
    }
    svg.flowWidth = W;
    svg.flowLayout = { steps, pos, lanes, cols };
    return svg;
  }

  // 그림 놓을 폭 (회의 페이지 본문 폭 − 카드 여백)
  function flowAvail() {
    const v = $('view').clientWidth;
    return v ? Math.min(v, 1040) - 88 - 36 : null;
  }

  // 넓으면 가로 그림을 여러 줄로 접는다 (80%보다 줄여야 할 때만). 단계 순서대로 앞에서부터 한 줄을 채우고,
  // 들어갈 칸을 넘으면 다음 줄로 — 줄마다 배치를 새로 계산해 번호 순서가 섞이지 않고, 세로로 길게 늘이지 않는다
  function flowSvg(r, f) {
    const wide = flowSvgH(r, f);
    const avail = flowAvail();
    if (!avail || wide.flowWidth * 0.8 <= avail) return wide;
    const { BW, GX, PAD } = FLOW;
    const { steps, lanes } = wide.flowLayout;
    const label = lanes.length ? FLOW.LABEL : 0;
    const per = Math.max(2, Math.floor((avail / 0.85 - 2 * PAD - label - 70 - 64 + GX) / (BW + GX)));
    if (!lanes.length) return flowSvgH(r, f, null, per); // 띠 없는 흐름은 한 줄 칸 수만 줄인다
    const laneIdx = new Map(lanes.map((l, i) => [l.id, i]));
    const chunks = [];
    let cur = [];
    for (const st of steps) {
      const next = [...cur, st];
      const cols = Math.max(...[...placeLanes(next, laneIdx).values()].map((p) => p.col)) + 1;
      if (cur.length && cols > per) {
        chunks.push(cur);
        cur = [st];
      } else cur = next;
    }
    if (cur.length) chunks.push(cur);
    const number = new Map(steps.map((st, i) => [st.id, i + 1]));
    const box = h('div', { class: 'flow-parts' });
    for (const part of chunks) {
      const partLanes = lanes.filter((l) => part.some((st) => st.lane === l.id));
      const rowOf = new Map(partLanes.map((l, i) => [l.id, i]));
      const partPos = placeLanes(part, rowOf);
      const ids = new Set(part.map((st) => st.id));
      const out = f.edges.filter((e) => ids.has(e.from) && !ids.has(e.to) && number.has(e.to)).map((e) => ({ from: e.from, toNum: number.get(e.to) }));
      const inn = f.edges.filter((e) => ids.has(e.to) && !ids.has(e.from) && number.has(e.from)).map((e) => ({ to: e.to, fromNum: number.get(e.from) }));
      box.append(flowSvgH(r, f, { steps: part, lanes: partLanes, pos: partPos, number, out, in: inn }));
    }
    return box;
  }



  function handoffBox(hd) {
    const col = (head, cls, items) => items.length > 0 && h('div', { class: `handoff-col ${cls}` }, h('b', null, head),
      h('ul', null, items.map((x) => h('li', null, x.text, x.owner && h('span', { class: 'flane' }, x.owner)))));
    return h('section', { class: 'handoff' },
      h('div', { class: 'handoff-head' }, h('b', null, '인수인계'), (hd.from || hd.to) && h('span', null, `${hd.from ?? ''} → ${hd.to ?? ''}`)),
      h('div', { class: 'handoff-cols' },
        col(`${hd.from ?? '넘기는 사람'}이 넘겨줄 것`, 'give', hd.give), col(`${hd.to ?? '받는 사람'}이 할 일`, 'todo', hd.todo), col('정해진 것', 'decided', hd.decided)));
  }

  function flowCard(r, f) {
    const remake = h('button', { class: 'btn small ghost', onclick: async () => {
      remake.classList.add('busy');
      remake.lastChild.textContent = '다시 그리는 중… (1분 안팎)';
      try {
        await api.remakeFlow(r.dir, f.id);
        toast('흐름도를 다시 만들었습니다', f.title);
      } catch (err) {
        toast('다시 만들지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true });
      }
      refreshDoc(r);
    } }, icon('i-redo'), h('span', null, '다시 만들기'));
    return h('section', { class: 'flow' },
      h('div', { class: 'flow-head' },
        h('div', { class: 'flow-titles' }, h('h3', null, f.title), f.summary && h('p', { class: 'flow-summary' }, f.summary)),
        h('span', { class: 'tc-badge guess', title: '단계·메모는 LLM이 정리했고, 각 항목의 녹취 인용이 실제로 있는지 앱이 확인했습니다' }, 'LLM 정리 · 녹취로 확인'),
        h('div', { class: 'flow-acts' },
          h('button', { class: 'btn small ghost', onclick: () => openFlowChat(f.id) }, icon('i-chat'), '채팅'),
          remake,
          h('button', { class: 'btn small ghost', onclick: async () => {
            await api.removeFlow(r.dir, f.id);
            toast('흐름도를 지웠습니다', f.title);
            refreshDoc(r);
          } }, icon('i-trash'), '지우기'))),
      h('div', { class: 'flow-canvas' }, flowSvg(r, f)));
  }

  function flowsSection(r, data) {
    return h('div', { class: 'flows' }, data.flows.map((f) => flowCard(r, f)), data.handoff && handoffBox(data.handoff));
  }

  // 흐름도가 없을 때 회의록 아래 줄: 무엇을 그릴지(선택) 적고 만들기. 만들어 봤는데 없었으면 그 이유
  function flowRow(r, data) {
    const input = h('input', { type: 'text', class: 'flow-focus', placeholder: '그릴 흐름 (선택) · 예: 데이터 처리 순서만', maxlength: 200, 'aria-label': '그릴 흐름' });
    const btn = h('button', { class: 'btn small', onclick: async () => {
      btn.classList.add('busy');
      btn.lastChild.textContent = '흐름 정리하는 중… (1분 안팎)';
      try {
        const res = await api.makeFlow(r.dir, input.value);
        toast(res.flows.length ? `흐름도 ${res.flows.length}장을 만들었습니다` : '그릴 흐름을 찾지 못했습니다', res.flows.length ? res.flows.map((f) => f.title).join(' · ') : res.reason ?? '', { ms: 7000 });
      } catch (err) {
        toast('흐름도를 만들지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true });
      }
      refreshDoc(r);
    } }, icon('i-plus'), h('span', null, '흐름도 만들기'));
    return h('div', { class: 'flow-row' },
      h('div', { class: 'flow-row-text' }, h('b', null, '흐름도'),
        h('span', null, data ? `그릴 흐름을 찾지 못했습니다 · ${data.reason ?? ''}` : '인수인계·업무 절차처럼 단계와 순서를 설명한 회의는 그림으로 정리할 수 있습니다. 원본·정리본·회의록을 모두 보고 만듭니다.')),
      h('div', { class: 'flow-row-acts' }, input, btn));
  }

  // 그림마다 채팅: 고친 그림을 제안받아 '이대로 바꾸기'로 반영 (바꾼 그림도 녹취 인용을 다시 확인)
  let flowChat = null; // { flowId, messages: [{ role, text, revision, applied }], busy, draft }
  function openFlowChat(flowId) {
    chat = null;
    flowChat = { flowId, messages: [], busy: false, draft: '' };
    draw();
    setTimeout(() => document.querySelector('.chat textarea')?.focus(), 50);
  }

  function flowChatDrawer(r, doc) {
    const f = doc.flow?.flows?.find((x) => x.id === flowChat.flowId);
    if (!f) return null;
    const log = h('div', { class: 'chat-log' });
    if (!flowChat.messages.length) log.append(h('p', { class: 'chat-empty' }, '그림에서 고칠 점을 말해 주세요. 예: "3번과 4번 순서가 바뀌었어요", "업로드 뒤에 백업 단계도 있어요", "메모를 더 짧게". 녹취를 다시 보고 고친 그림을 제안합니다.'));
    for (const m of flowChat.messages) {
      const textEl = h('div', { class: 'msg-text' });
      m.text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => part && textEl.append(i % 2 ? h('b', null, part) : part));
      const bubble = h('div', { class: `msg ${m.role}` }, textEl);
      if (m.revision) {
        bubble.append(h('div', { class: 'redo-result' },
          h('div', { class: 'redo-lines' }, h('b', null, m.revision.title), flowOrder(m.revision).map((s, i) => h('div', { class: 'redo-line' }, h('span', { class: 'num' }, String(i + 1)), h('span', null, `${s.title} — ${s.detail}`)))),
          m.applied
            ? h('div', { class: 'proposal-state ok' }, icon('i-check'), '그림에 반영됨')
            : h('div', { class: 'redo-acts' }, h('button', { class: 'btn small primary', onclick: async (e) => {
              e.currentTarget.classList.add('busy');
              try {
                await api.applyFlow(r.dir, f.id, m.revision);
                m.applied = true;
                toast('흐름도를 고쳤습니다', m.revision.title);
              } catch (err) {
                toast('반영하지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true });
              }
              refreshDoc(r);
            } }, '이대로 바꾸기'))));
      }
      log.append(bubble);
    }
    if (flowChat.busy) log.append(h('div', { class: 'msg assistant busy' }, h('div', { class: 'msg-text' }, '녹취를 다시 보고 있습니다…')));
    const input = h('textarea', { rows: 2, placeholder: '예: 마지막에 백업 단계도 넣어 주세요', spellcheck: false });
    input.value = flowChat.draft ?? '';
    input.oninput = () => (flowChat.draft = input.value);
    const send = async () => {
      const text = input.value.trim();
      if (!text || flowChat.busy) return;
      flowChat.messages.push({ role: 'user', text });
      flowChat.draft = '';
      flowChat.busy = true;
      draw();
      try {
        const res = await api.chatFlow(r.dir, f.id, flowChat.messages.map(({ role, text: t }) => ({ role, text: t })));
        flowChat?.messages.push({ role: 'assistant', text: res.text + (res.dropped?.length ? `\n(녹취에서 확인되지 않은 항목 ${res.dropped.length}개는 뺐습니다)` : ''), revision: res.revision });
      } catch (err) {
        flowChat?.messages.push({ role: 'assistant', text: `답을 받지 못했습니다: ${err.message}` });
      }
      if (flowChat) flowChat.busy = false;
      draw();
      setTimeout(() => document.querySelector('.chat textarea')?.focus(), 30);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    };
    const drawer = h('aside', { class: 'chat', 'aria-label': '흐름도 채팅' },
      h('header', { class: 'chat-head' }, icon('i-chat'), h('b', null, '흐름도 채팅'), h('span', { style: 'flex:1' }),
        h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => { flowChat = null; draw(); } }, icon('i-x'))),
      h('div', { class: 'chat-ctx' }, h('span', { class: 'tag' }, f.title)),
      log,
      h('div', { class: 'chat-input' }, input, h('button', { class: 'icon-btn send', 'aria-label': '보내기', disabled: flowChat.busy, onclick: send }, icon('i-send'))));
    requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    return drawer;
  }

  // 본문·스크립트에서 단어를 드래그하면 '설명 추가' 버튼을 띄운다
  let addBtn = null;
  const removeAddBtn = () => {
    addBtn?.remove();
    addBtn = null;
  };
  function offerExplain() {
    removeAddBtn();
    const sel = window.getSelection();
    const text = sel?.toString().trim().replace(/\s+/g, ' ');
    if (!text || text.length > 40 || !sel.rangeCount || !el.querySelector('.doc, .script')?.contains(sel.anchorNode)) return;
    const r = history.find((m) => m.id === id);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    addBtn = h('button', { class: 'btn small term-add', style: `top:${Math.max(8, rect.top - 38)}px;left:${Math.min(rect.left, innerWidth - 140)}px`, onmousedown: (e) => e.preventDefault(), onclick: async () => {
      addBtn.classList.add('busy');
      addBtn.setAttribute('aria-busy', 'true');
      addBtn.lastChild.textContent = '설명 찾는 중…';
      try {
        const t = await api.explainTerm(r.dir, text);
        toast(`'${t.term}' 설명을 더했습니다`, t.note);
      } catch (err) {
        toast('설명을 더하지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true });
      }
      removeAddBtn();
      window.getSelection()?.removeAllRanges();
      refreshDoc(r);
    } }, icon('i-plus'), h('span', null, `'${text.length > 12 ? `${text.slice(0, 12)}…` : text}' 설명 추가`));
    document.body.append(addBtn);
  }
  el.addEventListener('mouseup', () => setTimeout(offerExplain));
  el.addEventListener('mousedown', (e) => !addBtn?.contains(e.target) && removeAddBtn());

  // 회의록 마크다운: 소제목, 목록, 할 일(체크 가능), 문단, **굵게**, (12:34) 시각은 눌러서 듣기, 용어 밑줄
  function minutesDoc(r, md, reviewOpen = 0, openReview = null, matcher = null) {
    const box = h('article', { class: 'doc' });
    const flowData = docCache.get(r.id)?.flow;
    let flowPlaced = false;
    let sawSummary = false;
    let list = null;
    let todoIndex = 0;
    let skipping = false; // 확인 필요 섹션은 '확인 필요' 탭에서 하나씩 처리한다
    const inline = (el, text, terms = matcher) => {
      const seen = new Set();
      text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
        if (!part) return;
        if (i % 2) return el.append(h('b', null, ...withTerms(part, terms, seen)));
        const segs = part.split(/(\(\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*,\s*\d{1,2}:\d{2}(?::\d{2})?)*\s*\))/);
        segs.forEach((seg, j) => {
          if (j % 2 === 0) return seg && el.append(...withTerms(seg, terms, seen));
          const times = seg.match(/\d{1,2}:\d{2}(?::\d{2})?/g);
          // 시각 칩과 바로 뒤 문장부호("(02:50)." → 칩 + ".")를 한 덩어리로 묶어 마침표만 다음 줄로 넘어가지 않게 한다
          const punct = /^[.,;:!?…)\]」』]+/.exec(segs[j + 1] ?? '')?.[0] ?? '';
          if (punct) segs[j + 1] = segs[j + 1].slice(punct.length);
          const group = h('span', { class: 'stamps' });
          times.forEach((t, k) => {
            if (k) group.append(' ');
            group.append(r.firstFile ? h('button', { class: 'seek', title: '여기부터 듣기', onclick: () => seek(parseStamp(t)) }, t) : h('span', { class: 'num' }, t));
          });
          if (punct) group.append(punct);
          el.append(' ', group);
        });
      });
    };
    for (const line of md.split('\n')) {
      const todo = line.match(/^\s*- \[( |x)\]\s+(.*)$/i);
      const item = line.match(/^\s*[-*]\s+(.*)$/);
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) skipping = heading[1] === '##' && heading[2].trim() === '확인 필요';
      if (skipping) continue;
      if (todo || item) {
        if (!list) box.append((list = h('ul')));
        if (todo) {
          const index = todoIndex++;
          const checked = todo[1].trim() !== '';
          const text = h('span');
          inline(text, todo[2]);
          const cb = h('input', { type: 'checkbox', checked, 'aria-label': '할 일 완료' });
          const li = h('li', { class: `todo${checked ? ' done' : ''}` }, cb, text);
          cb.onchange = async () => {
            li.classList.toggle('done', cb.checked);
            const updated = await api.toggleTodo(r.dir, index, cb.checked);
            docCache.set(r.id, { ...docCache.get(r.id), minutes: updated });
          };
          list.append(li);
        } else {
          const li = h('li');
          inline(li, item[1]);
          list.append(li);
        }
        continue;
      }
      list = null;
      if (!line.trim()) continue;
      if (heading) {
        if (heading[1] === '#') continue; // 제목은 페이지 머리에 있다
        if (heading[1] === '##' && flowData?.flows?.length && !flowPlaced && sawSummary) {
          box.append(flowsSection(r, flowData));
          flowPlaced = true;
        }
        if (heading[1] === '##') sawSummary = heading[2].trim() === '요약';
        const hd = h(heading[1] === '##' ? 'h3' : 'h4');
        inline(hd, heading[2], null);
        box.append(hd);
      } else {
        const p = h('p');
        inline(p, line);
        box.append(p);
      }
    }
    if (flowData?.flows?.length && !flowPlaced) box.append(flowsSection(r, flowData));
    if (!docCache.get(r.id)?.actions) box.append(actionsRow(r));
    if (!flowData?.flows?.length) box.append(flowRow(r, flowData));
    box.append(glossaryBox(r, docCache.get(r.id)?.glossary));
    if (openReview && /^## 확인 필요/m.test(md)) {
      const finalized = Boolean(docCache.get(r.id)?.review?.finalizedAt);
      box.append(h('div', { class: 'review-callout' }, icon(finalized ? 'i-check' : 'i-alert'),
        h('span', null, finalized ? '확인을 마친 회의록입니다.' : reviewOpen ? `초안입니다. 확인이 필요한 부분이 ${reviewOpen}개 남아 있습니다.` : '확인 필요 항목을 모두 처리했습니다. 확인을 마치면 회의록이 확정됩니다.'),
        h('button', { class: 'btn small', onclick: openReview }, finalized ? '확인 결과 보기' : '확인하기')));
    }
    return box;
  }

  // 화자 이름 정하기: 회의록·스크립트의 '화자 N'을 실제 이름으로 바꾼다
  function speakerBar(r, order, color) {
    const generic = order.some((w) => /^화자 \d+$/.test(w));
    return h('div', { class: 'spk-bar' },
      h('span', { class: 'spk-bar-label' }, '화자'),
      order.map((who) => h('button', { class: 'spk-chip', title: '눌러서 이름 바꾸기', onclick: (e) => renameSpeaker(e.currentTarget, r, who) },
        h('i', { style: `background:${color(who)}` }), h('span', null, who), icon('i-pencil'))),
      generic && h('span', { class: 'spk-bar-hint' }, '이름을 누르면 바꿀 수 있습니다. 회의록과 스크립트에 모두 반영됩니다.'));
  }

  async function refreshDoc(r) {
    docCache.set(r.id, await api.readMinutes(r.dir));
    draw();
    loadHistory(); // 제목 아래 '확인 N개 남음'·목록 카드 숫자도 같이
  }

  async function applyFixes(r, fixes) {
    if (!fixes.length) return;
    try {
      const review = await api.applyReview(r.dir, fixes);
      const applied = review.items.filter((it) => fixes.some((f) => f.id === it.id) && it.status === 'applied');
      const kept = fixes.filter((f) => f.keep).length;
      for (const f of fixes) reviewSel.delete(f.id);
      const words = review.addedWords ?? [];
      toast(applied.length ? `${applied.length}개를 고쳤습니다` : `${kept}개를 그대로 두었습니다`,
        applied.length ? `녹취·정리본·회의록에서 ${applied.reduce((n, it) => n + (it.count ?? 0), 0)}곳을 바꿨습니다${words.length ? ` · 사전에 추가: ${words.join(', ')}` : ''}` : '',
        words.length ? { action: '사전 보기', onAction: () => (location.hash = '#dictionary'), ms: 7000 } : {});
      if (words.length) renderDictSettings(await api.dictSettings()); // 사전 개수·목록도 바로
      await refreshDoc(r);
    } catch (err) {
      toast('적용하지 못했습니다', err.message, { bad: true });
    }
  }

  async function keepItems(r, ids) {
    await api.setReviewStatus(r.dir, ids, 'kept');
    ids.forEach((i) => reviewSel.delete(i));
    toast(`${ids.length}개를 그대로 두었습니다`, '나중에 다시 열 수 있습니다');
    refreshDoc(r);
  }

  // 구간 다시 받아쓰기 범위: 설명에 'mm:ss~mm:ss'가 있으면 그 구간, 없으면 항목 시각 앞 10초~뒤 50초
  function itemRange(it) {
    const m = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[~∼–-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/.exec(`${it.note ?? ''} ${it.heardNote ?? ''}`);
    if (m && parseStamp(m[2]) > parseStamp(m[1])) return { start: parseStamp(m[1]), end: parseStamp(m[2]) };
    if (!it.at) return null;
    const at = parseStamp(it.at);
    return { start: Math.max(0, at - 10), end: at + 50 };
  }

  async function runRedo(r, itemId, range) {
    if (!chat || chat.redoing) return;
    chat.redoing = itemId;
    draw();
    try {
      const res = await api.redoRange(r.dir, itemId, range.start, range.end);
      const span = `${clock(res.start)}~${clock(res.end)}`;
      chat?.messages.push({
        role: 'assistant',
        text: res.empty
          ? `${span} 구간을 다시 받아써도 알아들을 수 있는 말이 없었습니다. 녹음을 직접 들어 보세요.`
          : `${span} 구간을 다시 받아썼습니다${res.gain > 1.05 ? ` (작은 소리를 ${res.gain}배 키움)` : ''}. 녹취에 반영하면 이 구간 줄만 바뀌고 다른 줄은 그대로입니다.`,
        redo: { id: itemId, ...res },
      });
    } catch (err) {
      chat?.messages.push({ role: 'assistant', text: `다시 받아쓰지 못했습니다: ${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}` });
    }
    if (chat) chat.redoing = null;
    draw();
  }

  async function applyRedo(r, itemId) {
    try {
      const review = await api.applyRedo(r.dir, itemId);
      const it = review.items.find((x) => x.id === itemId);
      toast('녹취에 반영했습니다', `이 구간 ${it?.count ?? ''}줄만 바꿨습니다 · 확인을 마치면 회의록에도 반영합니다`);
      await refreshDoc(r);
    } catch (err) {
      toast('반영하지 못했습니다', err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { bad: true });
    }
  }

  function openChat(ids) {
    if (!ids.length) return;
    flowChat = null;
    chat = { ids: [...ids], messages: [], busy: false, applying: new Set() };
    draw();
    setTimeout(() => document.querySelector('.chat textarea')?.focus(), 50);
  }

  // 확인 필요: 항목마다 추정 적용 · 직접 고치기 · 채팅 · 그대로 두기, 여러 개 골라 한 번에
  function reviewView(r, doc) {
    const box = h('div', { class: 'review' });
    if (!doc.review) {
      const make = h('button', { class: 'btn primary' }, '정리하기');
      make.onclick = async () => {
        make.classList.add('busy'); // 흐리게 하지 않고 진행 중 표시
        make.textContent = '정리하는 중…';
        try {
          await api.makeReview(r.dir);
          refreshDoc(r);
        } catch (err) {
          toast('정리하지 못했습니다', err.message, { bad: true });
          make.classList.remove('busy');
          make.textContent = '정리하기';
        }
      };
      box.append(h('div', { class: 'state' }, h('b', null, '확인 필요 항목을 하나씩 처리할 수 있게 정리합니다'), h('p', null, '회의록의 "확인 필요"를 항목별로 나누고, 고칠 말 추정이 있으면 채워 둡니다.'), h('div', { class: 'row' }, make)));
      return box;
    }
    const items = doc.review.items;
    const open = items.filter((it) => it.status === 'open');
    const done = items.filter((it) => it.status !== 'open');
    const shown = reviewFilter === 'open' ? open : done;
    for (const id of [...reviewSel]) if (!open.some((it) => it.id === id)) reviewSel.delete(id);
    const guessOf = (it) => (guessDraft.has(it.id) ? guessDraft.get(it.id) : it.guess ?? '');
    const sel = open.filter((it) => reviewSel.has(it.id));
    const applicable = sel.filter((it) => it.heard && guessOf(it).trim());

    const all = h('input', { type: 'checkbox', checked: open.length > 0 && sel.length === open.length, 'aria-label': '모두 고르기' });
    all.indeterminate = sel.length > 0 && sel.length < open.length;
    all.onchange = () => {
      if (all.checked) open.forEach((it) => reviewSel.add(it.id));
      else reviewSel.clear();
      draw();
    };
    box.append(
      h('div', { class: 'tab-bar' }, h('span', null, '들린 말을 고칠 말로 바꾸면 녹취·정리본·회의록에 모두 반영됩니다. 처음 고칠 때 원본을 따로 보관합니다.')),
      h('div', { class: 'review-bar' },
        reviewFilter === 'open' && open.length > 0 && h('label', { class: 'review-all' }, all, sel.length ? `${sel.length}개 선택` : '모두 고르기'),
        reviewFilter === 'open' && sel.length > 0 && [
          h('button', { class: 'btn small primary', disabled: !applicable.length, title: '고칠 말이 있는 항목만 적용됩니다', onclick: () => applyFixes(r, applicable.map((it) => ({ id: it.id, guess: guessOf(it) }))) }, icon('i-check'), `추정대로 적용${applicable.length ? ` ${applicable.length}` : ''}`),
          h('button', { class: 'btn small', onclick: () => openChat(sel.map((it) => it.id)) }, icon('i-chat'), '채팅으로 확인'),
          h('button', { class: 'btn small', onclick: () => keepItems(r, sel.map((it) => it.id)) }, '그대로 두기'),
        ],
        h('span', { style: 'flex:1' }),
        h('div', { class: 'chips', style: 'margin:0' },
          h('button', { class: 'chip', 'aria-pressed': String(reviewFilter === 'open'), onclick: () => { reviewFilter = 'open'; draw(); } }, '남은 것', num(open.length)),
          h('button', { class: 'chip', 'aria-pressed': String(reviewFilter === 'done'), onclick: () => { reviewFilter = 'done'; draw(); } }, '처리함', num(done.length)))));

    box.append(finalizePanel(r, doc.review, open.length));
    if (!shown.length) {
      box.append(h('div', { class: 'empty' }, h('b', null, reviewFilter === 'open' ? '확인할 항목이 없습니다' : '아직 처리한 항목이 없습니다'), reviewFilter === 'open' && items.length ? '모두 처리했습니다.' : ''));
      return box;
    }
    for (const it of shown) {
      const atBtn = it.at && r.firstFile && h('button', { class: 'seek', title: '여기부터 듣기', onclick: () => seek(parseStamp(it.at)) }, it.at);
      const card = h('div', { class: `ritem${reviewSel.has(it.id) ? ' on' : ''} ${it.status}` });
      const head = h('div', { class: 'ritem-head' },
        it.status === 'open' && h('input', { type: 'checkbox', checked: reviewSel.has(it.id), 'aria-label': '고르기', onchange: (e) => { e.target.checked ? reviewSel.add(it.id) : reviewSel.delete(it.id); draw(); } }),
        h('span', { class: `tag kind-${it.kind}` }, REVIEW_KIND[it.kind] ?? '확인'),
        atBtn,
        h('span', { class: 'ritem-note' }, it.note));
      card.append(head);
      if (it.status === 'open') {
        if (it.kind === 'lost') {
          // 유실 구간은 고칠 글자가 아니라 반복된 문장이다. 들어 보고 채팅하거나 그대로 둔다
          if (it.heardNote) card.append(h('div', { class: 'ritem-fix muted' }, h('span', { class: 'hint', style: 'margin:0' }, '반복된 문장'), h('span', { class: 'quote' }, it.heardNote)));
        } else if (it.heard) {
          const input = h('input', { type: 'text', value: guessOf(it), placeholder: '고칠 말 (기억나는 대로)', spellcheck: false });
          input.oninput = () => guessDraft.set(it.id, input.value);
          input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.isComposing && input.value.trim()) applyFixes(r, [{ id: it.id, guess: input.value }]);
          };
          card.append(h('div', { class: 'ritem-fix' },
            h('span', { class: 'heard' }, it.heard), icon('i-right'), input,
            h('button', { class: 'btn small primary', onclick: () => input.value.trim() && applyFixes(r, [{ id: it.id, guess: input.value }]) }, '적용')));
        } else if (it.heardNote) card.append(h('div', { class: 'ritem-fix muted' }, h('span', { class: 'heard' }, it.heardNote), h('span', { class: 'hint', style: 'margin:0' }, '녹취에서 같은 글자를 찾지 못해 자동으로 고칠 수 없습니다. 채팅으로 확인하거나 그대로 두세요.')));
        card.append(h('div', { class: 'ritem-acts' },
          h('button', { class: 'btn small ghost', onclick: () => openChat([it.id]) }, icon('i-chat'), '채팅'),
          (it.kind === 'lost' || it.kind === 'meaning') && r.firstFile && itemRange(it) && h('button', { class: 'btn small ghost', title: '이 구간만 녹음에서 다시 받아씁니다', onclick: () => {
            openChat([it.id]);
            runRedo(r, it.id, itemRange(it));
          } }, icon('i-redo'), '구간 다시 받아쓰기'),
          h('button', { class: 'btn small ghost', onclick: () => keepItems(r, [it.id]) }, it.kind === 'lost' ? '유실 그대로 두기' : '그대로 두기')));
      } else {
        card.append(h('div', { class: 'ritem-done' },
          it.status === 'applied' ? [h('span', { class: 'heard' }, it.heard), icon('i-right'), h('b', null, it.applied), h('span', { class: 'hint', style: 'margin:0' }, `${it.count ?? 0}곳 고침`)] : h('span', null, '그대로 둠'),
          it.status === 'kept' && h('button', { class: 'btn small ghost', onclick: async () => { await api.setReviewStatus(r.dir, [it.id], 'open'); refreshDoc(r); } }, '다시 열기')));
      }
      box.append(card);
    }
    return box;
  }

  // 확인 마치기: 남은 항목은 그대로 둔 것으로 하고, 채팅·이름 등 문장에 영향이 있는 결과만 회의록에 반영한다
  function finalizePanel(r, review, openCount) {
    if (review.finalizedAt) {
      const f = review.finalize ?? {};
      return h('div', { class: 'finalize done' }, icon('i-check'),
        h('div', { class: 'finalize-text' }, h('b', null, '확인을 마쳤습니다'),
          h('span', null, `고침 ${f.applied ?? 0} · 그대로 둠 ${f.kept ?? 0}${f.rewritten ? ' · 회의록의 해당 부분을 고쳐 썼습니다 (이전 회의록은 minutes.before-finalize.md로 보관)' : ' · 회의록 문장은 그대로입니다'}`)));
    }
    const needsRewrite = review.items.some((it) => it.chat?.length || (it.status === 'applied' && it.kind !== 'word'));
    const go = h('button', { class: 'btn primary' }, icon('i-check'), openCount ? `남은 ${openCount}개는 그대로 두고 확인 마치기` : '확인 마치기');
    go.onclick = async () => {
      go.classList.add('busy'); // 흐리게 하지 않고 진행 중 표시
      go.lastChild.textContent = needsRewrite ? '회의록에 반영하는 중…' : '마치는 중…';
      try {
        const res = await api.finalizeReview(r.dir);
        toast('회의록을 확정했습니다', res.finalize?.rewritten ? '확인 결과에 맞춰 회의록의 해당 부분을 고쳤습니다' : '고친 단어는 이미 반영되어 있어 회의록 문장은 그대로입니다');
        await refreshDoc(r);
        loadHistory();
      } catch (err) {
        toast('확인을 마치지 못했습니다', err.message, { bad: true });
        go.classList.remove('busy');
        go.lastChild.textContent = '다시 시도';
      }
    };
    return h('div', { class: 'finalize' },
      h('div', { class: 'finalize-text' }, h('b', null, openCount ? `확인 필요 ${openCount}개 남음` : '모두 처리했습니다'),
        h('span', null, needsRewrite ? '채팅으로 밝혀진 내용이나 고친 이름은 회의록의 해당 문장에 반영합니다. 나머지 문장은 그대로 둡니다.' : '고친 단어는 이미 녹취·정리본·회의록에 반영되어 있습니다. 마치면 회의록이 확정됩니다.')),
      go);
  }

  function chatDrawer(r, doc) {
    const items = (doc.review?.items ?? []).filter((it) => chat.ids.includes(it.id));
    const log = h('div', { class: 'chat-log' });
    if (!chat.messages.length) log.append(h('p', { class: 'chat-empty' }, '기억나는 것, 그때 상황, 맞는 이름 등을 알려 주세요. 녹취 앞뒤를 같이 보고 고칠 말을 제안합니다. 기억이 안 나면 "그대로 두자"고 하면 됩니다.'));
    for (const m of chat.messages) {
      const textEl = h('div', { class: 'msg-text' });
      m.text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => part && textEl.append(i % 2 ? h('b', null, part) : part));
      const bubble = h('div', { class: `msg ${m.role}` }, textEl);
      if (m.proposals?.length) {
        // 이미 처리한 항목(적용·그대로 둠)은 버튼 대신 결과를 보여 준다 → 같은 제안을 두 번 누르지 않게
        const itemOf = (p) => items.find((x) => x.id === p.id);
        const fixes = m.proposals.filter((p) => !p.keep && !p.redo && itemOf(p)?.status === 'open');
        const apply = async (list) => {
          list.forEach((f) => chat.applying.add(f.id));
          draw();
          await applyFixes(r, list);
          list.forEach((f) => chat?.applying.delete(f.id));
          draw();
        };
        bubble.append(h('div', { class: 'proposals' },
          m.proposals.map((p) => {
            const it = itemOf(p);
            if (p.redo) {
              const busy = chat.redoing === p.id;
              return h('div', { class: 'proposal' }, icon('i-redo'), h('span', null, `${clock(p.redo.start)}~${clock(p.redo.end)} 구간 다시 받아쓰기`),
                h('button', { class: `btn small${busy ? ' busy' : ''}`, onclick: () => runRedo(r, p.id, p.redo) }, busy ? '받아쓰는 중…' : '다시 받아쓰기'));
            }
            const done = it && it.status !== 'open';
            const busy = chat.applying.has(p.id);
            const state = !done ? null
              : it.status === 'kept' ? h('span', { class: 'proposal-state' }, '그대로 둠')
              : h('span', { class: 'proposal-state ok' }, icon('i-check'), it.applied === p.guess || p.keep ? '적용됨' : `'${it.applied}'로 적용됨`);
            return h('div', { class: `proposal${done ? ' done' : ''}` },
              p.keep ? h('span', null, `${it?.heard ?? it?.heardNote ?? p.id}: 그대로 두기`) : [h('span', { class: 'heard' }, p.heard), icon('i-right'), h('b', null, p.guess)],
              state ?? h('button', { class: `btn small${busy ? ' busy' : ''}`, 'aria-busy': String(busy), onclick: () => apply([p.keep ? { id: p.id, keep: true } : { id: p.id, heard: p.heard, guess: p.guess }]) },
                busy ? '적용 중…' : p.keep ? '그대로 두기' : '적용'));
          }),
          fixes.length > 1 && h('button', { class: 'btn small primary', disabled: fixes.some((p) => chat.applying.has(p.id)), onclick: () => apply(fixes.map((p) => ({ id: p.id, heard: p.heard, guess: p.guess }))) }, `${fixes.length}개 모두 적용`)));
      }
      if (m.redo && !m.redo.empty) {
        const it = items.find((x) => x.id === m.redo.id);
        const applied = Boolean(it?.redo?.appliedAt);
        bubble.append(h('div', { class: 'redo-result' },
          h('div', { class: 'redo-lines' }, m.redo.text.split('\n').map((l) => {
            const x = /^\[([\d:]+)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/.exec(l);
            return h('div', { class: 'redo-line' }, x ? [h('span', { class: 'num' }, x[1]), x[2] && h('b', null, x[2]), h('span', null, x[3])] : l);
          })),
          applied
            ? h('div', { class: 'proposal-state ok' }, icon('i-check'), '녹취에 반영됨')
            : h('div', { class: 'redo-acts' }, h('button', { class: 'btn small primary', onclick: (e) => { e.currentTarget.classList.add('busy'); applyRedo(r, m.redo.id); } }, '녹취에 반영'))));
      }
      log.append(bubble);
    }
    if (chat.redoing) log.append(h('div', { class: 'msg assistant busy' }, h('div', { class: 'msg-text' }, '녹음에서 그 구간을 다시 받아쓰는 중입니다… (30초 구간에 몇 초)')));
    if (chat.busy) log.append(h('div', { class: 'msg assistant busy' }, h('div', { class: 'msg-text' }, '녹취를 보고 있습니다…')));
    const input = h('textarea', { rows: 2, placeholder: '예: 화자 1 이름은 김민준이에요 / 그 부분은 기억 안 나요', spellcheck: false });
    input.value = chat.draft ?? '';
    input.oninput = () => (chat.draft = input.value); // 화면을 다시 그려도 쓰던 글이 남게
    const send = async () => {
      const text = input.value.trim();
      if (!text || chat.busy) return;
      chat.messages.push({ role: 'user', text });
      chat.draft = '';
      chat.busy = true;
      draw();
      try {
        const res = await api.chatReview(r.dir, chat.ids, chat.messages.map(({ role, text: t, redo }) => ({ role, text: redo?.text ? `${t}\n${redo.text}` : t })));
        chat?.messages.push({ role: 'assistant', text: res.text, proposals: res.proposals });
      } catch (err) {
        chat?.messages.push({ role: 'assistant', text: `답을 받지 못했습니다: ${err.message}` });
      }
      if (chat) chat.busy = false;
      draw();
      setTimeout(() => document.querySelector('.chat textarea')?.focus(), 30);
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    };
    const drawer = h('aside', { class: 'chat', 'aria-label': '확인 필요 채팅' },
      h('header', { class: 'chat-head' }, icon('i-chat'), h('b', null, '확인 필요 채팅'), h('span', { style: 'flex:1' }),
        h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => { chat = null; draw(); } }, icon('i-x'))),
      h('div', { class: 'chat-ctx' }, items.map((it) => h('span', { class: 'tag' }, it.at ? `${it.at} ` : '', it.heard ?? it.heardNote ?? REVIEW_KIND[it.kind]))),
      log,
      h('div', { class: 'chat-input' }, input, h('button', { class: 'icon-btn send', 'aria-label': '보내기', disabled: chat.busy, onclick: send }, icon('i-send'))));
    requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    return drawer;
  }

  function speakersSelect() {
    const sel = h('select', { 'aria-label': '참석 인원' }, h('option', { value: '' }, '자동'));
    for (let n = 2; n <= 10; n++) sel.append(h('option', { value: String(n) }, `${n}명`));
    const r = history.find((m) => m.id === id);
    sel.value = r?.speakersHint ? String(r.speakersHint) : r?.minutes?.speakers ? String(r.minutes.speakers) : '';
    return sel;
  }

  function remake(r, speakers) {
    docCache.delete(r.id);
    api.makeMinutes(r.dir, speakers || null);
    toast('회의록을 다시 만듭니다', '녹취·화자 구분·회의록을 처음부터 만듭니다');
    setTimeout(loadHistory, 400);
  }

  function stateCard(r) {
    const m = r.minutes;
    const s = m?.status;
    if (BUSY.includes(s)) {
      const p = progressOf(m);
      return h('div', { class: 'state' }, h('b', null, '회의록을 만드는 중입니다'), h('p', null, `${statusText(m)} · 2시간 회의는 약 20분 걸립니다. 창을 닫아도 계속됩니다.`),
        h('div', { class: `bar${p === null ? ' indeterminate' : ''}`, style: 'margin-top:14px' }, h('i', { style: `width:${Math.round((p ?? 0.3) * 100)}%` })));
    }
    if (s === 'short' || r.durationSec < 10) {
      return h('div', { class: 'state' }, h('b', null, '짧은 녹음입니다'), h('p', null, '10초 미만 녹음은 회의록을 만들지 않습니다. 필요 없으면 오른쪽 위 ⋯ 메뉴에서 휴지통으로 옮기세요.'));
    }
    const sel = speakersSelect();
    // 회의록 쓰기에서 멈췄으면(인터넷 끊김·앱 종료) 저장된 녹취로 회의록만 다시 쓴다
    if (s === 'error' && m.stage === 'write') {
      const resume = h('button', { class: 'btn primary', onclick: () => {
        docCache.delete(r.id);
        api.resumeMinutes(r.dir).catch((err) => toast('이어서 쓰지 못했습니다', err.message, { bad: true }));
        setTimeout(loadHistory, 400);
      } }, '회의록만 다시 쓰기');
      const redo = h('button', { class: 'btn', onclick: () => remake(r, sel.value) }, '녹취부터 다시');
      return h('div', { class: 'state' },
        h('b', null, m.offline ? '인터넷 연결이 없어 회의록을 쓰지 못했습니다' : '회의록을 쓰다가 멈췄습니다'),
        h('p', { class: 'err' }, m.offline ? '녹취와 화자 구분은 저장되어 있습니다. 연결되면 자동으로 이어서 씁니다.' : `${m.error} · 녹취와 화자 구분은 저장되어 있어 회의록만 다시 쓸 수 있습니다.`),
        h('div', { class: 'row' }, resume, h('label', { class: 'hint', style: 'margin:0 0 0 12px' }, '참석 인원 '), sel, redo));
    }
    const go = h('button', { class: 'btn primary', onclick: () => remake(r, sel.value) }, s === 'error' ? '다시 만들기' : '회의록 만들기');
    return h('div', { class: 'state' },
      h('b', null, s === 'error' ? '회의록을 만들지 못했습니다' : s === 'empty' ? '들린 말이 없었습니다' : '아직 회의록이 없습니다'),
      h('p', { class: s === 'error' ? 'err' : '' }, s === 'error' ? m.error : s === 'empty' ? '녹음에서 말소리를 찾지 못했습니다. 마이크를 확인해 주세요.' : '녹음은 저장되어 있습니다. 녹취·화자 구분·회의록을 만들 수 있습니다.'),
      h('div', { class: 'row' }, h('label', { class: 'hint', style: 'margin:0' }, '참석 인원 '), sel, go));
  }

  function meetingActions(r, doc) {
    const s = r.minutes?.status;
    const busy = BUSY.includes(s);
    const wrap = h('div', { class: 'meet-acts' });
    let menu = null;
    const closeMenu = () => {
      menu?.remove();
      menu = null;
      document.removeEventListener('mousedown', outside);
    };
    const outside = (e) => !wrap.contains(e.target) && closeMenu();
    const openMenu = (content) => {
      if (menu) return closeMenu();
      menu = h('div', { class: 'menu' }, content);
      wrap.append(menu);
      setTimeout(() => document.addEventListener('mousedown', outside));
    };
    if (doc.minutes) wrap.append(h('button', { class: 'btn', onclick: async (e) => {
      await api.copy(doc.minutes);
      toast('회의록을 복사했습니다', '마크다운 형식');
      e.currentTarget.blur();
    } }, icon('i-copy'), '회의록 복사'));
    if (!busy && s && s !== 'short') {
      wrap.append(h('button', { class: 'btn', onclick: () => {
        const sel = speakersSelect();
        openMenu([h('label', null, '참석 인원', sel), h('button', { class: 'btn primary', onclick: () => { closeMenu(); remake(r, sel.value); } }, '녹취부터 다시 만들기')]);
      } }, icon('i-redo'), '다시 만들기'));
    }
    wrap.append(h('button', { class: 'icon-btn', 'aria-label': '더 보기', onclick: () => openMenu([
      h('button', { onclick: () => { closeMenu(); api.reveal(`${r.dir}/${r.firstFile}`); } }, icon('i-folder'), 'Finder에서 보기'),
      doc.transcript && h('button', { onclick: () => { closeMenu(); api.copy(doc.transcript); toast('원본 스크립트를 복사했습니다'); } }, icon('i-copy'), '원본 스크립트 복사'),
      h('hr'),
      h('button', { class: 'danger', disabled: busy, onclick: async () => {
        closeMenu();
        if (!(await confirmBox('이 회의를 휴지통으로 옮길까요?', '녹음 파일과 회의록이 함께 옮겨집니다. Finder 휴지통에서 되살릴 수 있습니다.', '휴지통으로'))) return;
        try {
          audio.pause();
          await api.trashMeeting(r.dir);
          toast('휴지통으로 옮겼습니다');
          replaceRoute('#meetings');
          loadHistory();
        } catch (err) {
          toast('옮기지 못했습니다', err.message, { bad: true });
        }
      } }, icon('i-trash'), '휴지통으로 옮기기'),
    ]) }, icon('i-more')));
    return wrap;
  }

  // 재생 막대: 화자별 색 띠 위에서 누르거나 끌어 원하는 곳부터 듣는다.
  // 색은 스크립트와 같게 녹취 줄 기준(다음 줄까지, 최대 30초). 화자 구분 결과를 그대로 그리면 짧은 말을 놓친 곳이 비고
  // 줄 화자와 어긋나서(실측 2시간 회의 27%) 쓰지 않는다. 말소리는 있는데 녹취 글이 없는 구간만 빗금으로 겹쳐 그린다
  function playerBar(r, raw, color, speech = null) {
    const missing = speech?.missing ?? [];
    const missingAt = (t) => missing.find((g) => t >= g.start && t < g.end);
    const playBtn = h('button', { class: 'play', 'aria-label': '재생' }, icon('i-play'));
    const time = h('span', { class: 'ptime' });
    const canvas = h('canvas');
    const head = h('div', { class: 'head' });
    const hover = h('div', { class: 'hover', hidden: true });
    const scrub = h('div', { class: 'scrub', role: 'slider', 'aria-label': '재생 위치', tabIndex: 0 }, canvas, head, hover);
    const speed = h('button', { class: 'btn small ghost speed', title: '재생 속도' }, `${audio.playbackRate}×`);
    const followBtn = h('button', { class: 'btn small ghost follow', 'aria-pressed': String(follow), title: '재생 중인 줄을 따라 화면을 옮깁니다' }, '따라가기');
    const total = () => (Number.isFinite(audio.duration) ? audio.duration : r.durationSec);
    const order = speakerOrder(raw);

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const hh = canvas.clientHeight;
      if (!w) return;
      canvas.width = w * dpr;
      canvas.height = hh * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement);
      const resolve = (v) => (v.startsWith('var(') ? css.getPropertyValue(v.slice(4, -1)) : v);
      ctx.fillStyle = css.getPropertyValue('--panel-3');
      ctx.beginPath();
      ctx.roundRect(0, 0, w, hh, 4);
      ctx.fill();
      const T = total() || 1;
      // 같은 사람이 이어서 말한 구간은 한 덩어리로 합쳐, 2시간짜리도 누가 언제 말했는지 읽히게 한다
      const runs = [];
      raw.forEach((l, i) => {
        if (l.at === null || !l.who) return;
        const next = raw.slice(i + 1).find((n) => n.at !== null)?.at ?? T;
        const end = Math.min(next, l.at + 30);
        const last = runs.at(-1);
        if (last && last.who === l.who && l.at - last.end < 8) last.end = end;
        else runs.push({ who: l.who, start: l.at, end });
      });
      for (const run of runs) {
        ctx.fillStyle = resolve(color(run.who));
        ctx.fillRect((run.start / T) * w, 0, Math.max(1, ((run.end - run.start) / T) * w), hh);
      }
      // 녹취 없음: 그 구간을 비우고 강조색 빗금
      const accent = css.getPropertyValue('--accent').trim();
      for (const g of missing) {
        const x = (g.start / T) * w;
        const gw = Math.max(3, ((g.end - g.start) / T) * w);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, gw, hh);
        ctx.clip();
        ctx.fillStyle = css.getPropertyValue('--panel');
        ctx.fillRect(x, 0, gw, hh);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        for (let k = -hh; k < gw + hh; k += 4) {
          ctx.beginPath();
          ctx.moveTo(x + k, hh);
          ctx.lineTo(x + k + hh, 0);
          ctx.stroke();
        }
        ctx.restore();
      }
    };
    const tick = () => {
      const T = total() || 1;
      head.style.left = `${(audio.currentTime / T) * 100}%`;
      time.textContent = `${clock(audio.currentTime)} / ${clock(T)}`;
      playBtn.replaceChildren(icon(audio.paused ? 'i-play' : 'i-pause'));
      playBtn.setAttribute('aria-label', audio.paused ? '재생' : '일시 정지');
      scrub.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
    };
    const at = (e) => {
      const rect = scrub.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (total() || 0);
    };
    scrub.onpointerdown = (e) => {
      scrub.setPointerCapture(e.pointerId);
      audio.currentTime = at(e);
      scrub.onpointermove = (ev) => (audio.currentTime = at(ev));
    };
    scrub.onpointerup = () => (scrub.onpointermove = showHover);
    const showHover = (e) => {
      hover.hidden = false;
      const rect = scrub.getBoundingClientRect();
      hover.style.left = `${e.clientX - rect.left}px`;
      const t = at(e);
      hover.textContent = missingAt(t) ? `${clock(t)} · 녹취 없음` : clock(t);
    };
    scrub.onpointermove = showHover;
    scrub.onpointerleave = () => (hover.hidden = true);
    scrub.onkeydown = (e) => {
      if (e.key === 'ArrowRight') audio.currentTime += 5;
      if (e.key === 'ArrowLeft') audio.currentTime -= 5;
    };
    playBtn.onclick = () => (audio.paused ? audio.play() : audio.pause());
    speed.onclick = () => {
      audio.playbackRate = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length];
      speed.textContent = `${audio.playbackRate}×`;
    };
    followBtn.onclick = () => {
      follow = !follow;
      remember('follow', follow);
      followBtn.setAttribute('aria-pressed', String(follow));
      if (follow) syncPlaying(true);
    };
    // 녹취 없음 범례는 누를 때마다 다음 구간으로 이동한다
    const nextMissing = () => {
      const g = missing.find((x) => x.start > audio.currentTime + 1) ?? missing[0];
      if (g) audio.currentTime = g.start;
    };
    const legend = (order.length > 1 || missing.length > 0) && h('div', { class: 'player-legend' },
      order.length > 1 && order.slice(0, 6).map((who) => h('span', null, h('i', { style: `background:${color(who)}` }), who)),
      missing.length > 0 && h('button', { class: 'legend-missing', title: '말소리는 있는데 녹취 글이 없는 구간입니다. 누르면 다음 구간으로 이동합니다', onclick: nextMissing }, h('i', { class: 'hatch' }), `녹취 없음 ${missing.length}곳`));
    const el = h('div', { class: 'player' }, h('div', { class: 'player-inner' },
      playBtn,
      h('button', { class: 'icon-btn', 'aria-label': '10초 뒤로', title: '10초 뒤로', onclick: () => (audio.currentTime -= 10) }, icon('i-back10')),
      h('button', { class: 'icon-btn', 'aria-label': '10초 앞으로', title: '10초 앞으로', onclick: () => (audio.currentTime += 10) }, icon('i-fwd10')),
      scrub, time, h('div', { style: 'display:flex;gap:2px' }, speed, followBtn), legend));
    requestAnimationFrame(paint);
    tick();
    return { el, tick, paint };
  }

  // 재생 중인 줄 표시: 이진 탐색으로 지금 시각 직전의 줄을 찾는다
  function syncPlaying(force = false) {
    player?.tick();
    if (!lineTimes.length) return;
    const t = audio.currentTime;
    let lo = 0;
    let hi = lineTimes.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineTimes[mid] <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (audio.paused && audio.currentTime === 0) idx = -1;
    if (idx === playingIdx && !force) return;
    lineEls[playingIdx]?.classList.remove('playing');
    playingIdx = idx;
    const row = lineEls[idx];
    if (!row) return;
    row.classList.add('playing');
    if (follow && !audio.paused) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const onTime = () => syncPlaying();
  // 창 크기가 바뀌면 재생 막대를 다시 칠하고, 흐름도는 가로·세로 배치가 바뀔 수 있어 다시 그린다
  let resizeTimer = null;
  const onResize = () => {
    player?.paint();
    if (!docCache.get(id)?.flow?.flows?.length) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => draw(), 250);
  };
  // ── 본문 안 찾기 (⌘F): 지금 보고 있는 탭의 본문만. CSS Highlight로 표시만 하고 글은 고치지 않는다 ──
  let findScope = null; // draw()가 그린 탭 본문
  let findBar = null;
  let findHits = [];
  let findIdx = -1;
  const canHighlight = typeof Highlight !== 'undefined' && Boolean(CSS.highlights);
  const clearFindMarks = () => canHighlight && (CSS.highlights.delete('find'), CSS.highlights.delete('find-now'));
  function runFind({ keep = false } = {}) {
    if (!findBar) return;
    const q = findBar.querySelector('input').value.toLowerCase();
    findHits = [];
    if (q && findScope?.isConnected) {
      // 본문 글자를 이어 붙여 찾는다 (용어 밑줄·시각 칩 경계를 넘는 말도 찾게)
      const nodes = [];
      let text = '';
      const walker = document.createTreeWalker(findScope, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push({ n, at: text.length });
        text += n.nodeValue;
      }
      const hay = text.toLowerCase();
      const nodeAt = (i) => {
        let lo = 0;
        let hi = nodes.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (nodes[mid].at <= i) lo = mid;
          else hi = mid - 1;
        }
        return nodes[lo];
      };
      for (let i = hay.indexOf(q); i !== -1 && findHits.length < 5000; i = hay.indexOf(q, i + q.length)) {
        const a = nodeAt(i);
        const b = nodeAt(i + q.length - 1);
        const range = document.createRange();
        range.setStart(a.n, i - a.at);
        range.setEnd(b.n, i + q.length - b.at);
        findHits.push(range);
      }
    }
    findIdx = !findHits.length ? -1 : keep ? Math.min(Math.max(findIdx, 0), findHits.length - 1) : 0;
    showFind(!keep);
  }
  function stepFind(d) {
    if (!findHits.length) return;
    findIdx = (findIdx + d + findHits.length) % findHits.length;
    showFind(true);
  }
  function showFind(scroll) {
    clearFindMarks();
    const q = findBar.querySelector('input').value;
    findBar.querySelector('.find-count').textContent = !q ? '' : findHits.length ? `${findIdx + 1}/${findHits.length}` : '없음';
    findBar.classList.toggle('none', Boolean(q) && !findHits.length);
    if (!findHits.length || !canHighlight) return;
    CSS.highlights.set('find', new Highlight(...findHits));
    CSS.highlights.set('find-now', new Highlight(findHits[findIdx]));
    if (!scroll) return;
    const view = $('view');
    const vr = view.getBoundingClientRect();
    const rr = findHits[findIdx].getBoundingClientRect();
    if (rr.top < vr.top + 64 || rr.bottom > vr.bottom - 40) view.scrollTop += rr.top - vr.top - vr.height / 3;
  }
  function openFind() {
    if (!findBar) {
      const input = h('input', { type: 'search', placeholder: '이 탭에서 찾기', spellcheck: false, 'aria-label': '이 탭 본문에서 찾기' });
      input.oninput = () => runFind();
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          stepFind(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      };
      findBar = h('div', { class: 'find-bar', role: 'search' }, icon('i-search'), input, h('span', { class: 'find-count' }),
        h('button', { class: 'icon-btn find-up', title: '이전 (⇧↩)', 'aria-label': '이전', onclick: () => stepFind(-1) }, icon('i-left')),
        h('button', { class: 'icon-btn find-down', title: '다음 (↩)', 'aria-label': '다음', onclick: () => stepFind(1) }, icon('i-left')),
        h('button', { class: 'icon-btn', title: '닫기 (esc)', 'aria-label': '찾기 닫기', onclick: closeFind }, icon('i-x')));
      document.querySelector('.panel').append(findBar);
    }
    const input = findBar.querySelector('input');
    input.focus();
    input.select();
    if (input.value) runFind({ keep: true });
  }
  function closeFind() {
    clearFindMarks();
    findBar?.remove();
    findBar = null;
    findHits = [];
    findIdx = -1;
  }
  const onFindKey = (e) => {
    const k = e.key.toLowerCase();
    if (e.metaKey && k === 'f') {
      e.preventDefault();
      openFind();
    } else if (e.metaKey && k === 'g' && findBar) {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && findBar && !cardEl && !e.target.closest?.('input, textarea, dialog')) closeFind();
  };
  document.addEventListener('keydown', onFindKey);

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      audio.paused ? audio.play() : audio.pause();
    }
  };
  for (const ev of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'seeked']) audio.addEventListener(ev, onTime);
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);

  draw();
  api.watchMeeting(r0.dir); // 이 회의 파일이 바뀌면(앱 밖에서 고쳐도) 다시 읽어 그린다
  return {
    el,
    reload: () => {
      docCache.delete(id);
      draw();
    },
    // 진행률·상태·확인 필요 숫자가 바뀐 경우에만 다시 그린다
    update: () => {
      const r = history.find((m) => m.id === id);
      if (!r) return;
      if (stateKey(r) !== lastKey) draw();
    },
    leave: () => {
      for (const ev of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'seeked']) audio.removeEventListener(ev, onTime);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      closeTermCard();
      removeAddBtn();
      closeFind();
      document.removeEventListener('keydown', onFindKey);
      api.watchMeeting(null);
    },
  };
}

// ── 사전 ────────────────────────────────────────────────────────────────
const vocabWords = () => (settings?.vocabulary ?? '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

function pageDictionary() {
  const input = h('input', { type: 'text', placeholder: '단어나 이름 (예: PJY, Whisper, 김신우)', spellcheck: false });
  const words = h('div', { class: 'words' });
  const add = async () => {
    const list = vocabWords();
    const fresh = input.value.split(',').map((w) => w.trim()).filter((w) => w && !list.includes(w));
    if (!fresh.length) return input.focus();
    await saveDict({ vocabulary: [...list, ...fresh].join(', ') });
    input.value = '';
    input.focus();
    update();
  };
  // onkeydown 처리기가 false를 돌려주면 키 입력이 막히므로(영문·지우기 안 됨) 값을 돌려주지 않는다
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) add();
  };
  const update = () => {
    const list = vocabWords();
    $('countWords').textContent = list.length || '';
    if (!list.length) words.replaceChildren(h('div', { class: 'empty', style: 'width:100%' }, h('b', null, '아직 등록한 단어가 없습니다'), '사람 이름, 회사·제품 이름, 전문 용어를 넣어 두면 받아쓰기와 회의 녹취가 그 단어를 더 잘 알아듣습니다.'));
    else words.replaceChildren(...list.map((w) => h('span', { class: 'word' }, w, h('button', { class: 'icon-btn', 'aria-label': `${w} 지우기`, onclick: async () => {
      await saveDict({ vocabulary: vocabWords().filter((x) => x !== w).join(', ') });
      update();
    } }, icon('i-x')))));
  };
  const el = h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', { style: 'flex:1' }, h('h1', null, '사전'), h('p', { class: 'lead' }, 'Whisper가 자주 틀리는 이름과 용어를 알려 줍니다. 받아쓰기와 회의 녹취에 모두 쓰입니다.'))),
    h('div', { class: 'add-row' }, input, h('button', { class: 'btn primary', onclick: add }, icon('i-plus'), '추가')),
    words,
    h('ul', { class: 'tips' },
      h('li', null, h('b', null, '고유명사 위주로: '), '흔한 낱말보다 사람·회사·제품 이름이 효과가 큽니다.'),
      h('li', null, h('b', null, '적힌 그대로: '), '"PJY", "Electron"처럼 화면에 나와야 하는 모양 그대로 적으세요.'),
      h('li', null, h('b', null, '너무 많지 않게: '), '수십 개를 넘기면 오히려 엉뚱한 단어로 바꿔 듣는 일이 생깁니다.')));
  update();
  return { el, update };
}

// ── 통계 ────────────────────────────────────────────────────────────────
function pageStats() {
  const el = h('div', { class: 'page' });
  const items = dictations();
  const st = dictStats(items);
  const meets = meetings().filter((m) => m.minutes?.status === 'done');
  const meetSec = meetings().reduce((n, m) => n + (m.durationSec ?? 0), 0);

  const head = h('div', { class: 'page-head' }, h('div', { style: 'flex:1' }, h('h1', null, '통계'), h('p', { class: 'lead' }, '받아쓰기와 회의 기록에서 계산합니다. 음성은 남기지 않고 글과 숫자만 씁니다.')));
  const row = h('div', { class: 'stat-row' },
    h('div', { class: 'stat' }, h('span', null, '말로 쓴 글자'), h('b', null, fmt.format(st.total), h('small', null, '자'))),
    h('div', { class: 'stat' }, h('span', null, '평균 속도'), h('b', null, st.wpm ?? '–', h('small', null, 'WPM'))),
    h('div', { class: 'stat' }, h('span', null, '연속 사용'), h('b', null, st.streak, h('small', null, '일'))),
    h('div', { class: 'stat' }, h('span', null, '회의 녹음'), h('b', null, clock(meetSec), h('small', null, `${meetings().length}건`))));

  // 최근 14일 받아쓴 글자: 막대 하나 = 하루
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 13 + i);
    const list = items.filter((r) => dayKey(r.startedAt) === d.toDateString());
    return { d, chars: list.reduce((n, r) => n + st.chars(r), 0), count: list.length };
  });
  const chart = barChart(days);

  const byApp = new Map();
  for (const r of items) byApp.set(r.app ?? '알 수 없음', (byApp.get(r.app ?? '알 수 없음') ?? 0) + st.chars(r));
  const apps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxApp = apps[0]?.[1] || 1;

  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  const asr = avg(items.map((r) => r.transcript.timing?.transcribeMs).filter((v) => v !== undefined));
  const providers = new Map();
  for (const r of items) {
    const p = r.transcript.cleanupProvider;
    if (p && r.transcript.timing?.cleanupMs) providers.set(p, [...(providers.get(p) ?? []), r.transcript.timing.cleanupMs]);
  }
  const perHour = avg(meets.filter((m) => m.minutes.timing?.transcribeMs && m.durationSec > 60).map((m) => (m.minutes.timing.transcribeMs + (m.minutes.timing.writeMs ?? 0)) / 1000 / (m.durationSec / 3600)));

  el.append(head, row);
  if (!items.length) {
    el.append(h('div', { class: 'empty locked' }, h('b', null, '받아쓰기를 해 보면 통계가 쌓입니다'), h('kbd', null, 'fn'), '을 꾹 누른 채 말한 글자 수, 속도, 자주 쓰는 앱이 여기에 나타납니다.'));
  } else {
    el.append(
      h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', null, '최근 14일 받아쓴 글자'), h('p', { class: 'sub' }, '막대에 마우스를 올리면 그날의 글자 수와 횟수가 보입니다.'), chart),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h3', null, '어디에 썼나'), h('p', { class: 'sub' }, '받아쓴 글자 수, 입력한 앱 기준'),
          h('div', { class: 'hbars' }, apps.map(([app, n]) => h('div', { class: 'hbar' }, h('span', { title: app }, app), h('div', { class: 'track' }, h('i', { style: `width:${(n / maxApp) * 100}%` })), num(fmt.format(n)))))),
        h('div', { class: 'card' }, h('h3', null, '걸린 시간'), h('p', { class: 'sub' }, '손을 뗀 뒤부터의 평균'),
          h('dl', { class: 'kv' },
            asr !== null && [h('dt', null, '음성 인식 (Whisper turbo)'), h('dd', null, seconds(asr))],
            [...providers.entries()].map(([p, list]) => [h('dt', null, `다듬기 · ${PROVIDER_NAME[p] ?? p}`), h('dd', null, `${seconds(avg(list))} · ${list.length}회`)]),
            perHour !== null && [h('dt', null, '회의록 (녹음 1시간당)'), h('dd', null, `${Math.round(perHour / 60)}분`)]))));
  }
  return { el };
}

function barChart(days) {
  const W = 700;
  const H = 200;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const max = Math.max(...days.map((d) => d.chars), 10);
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / days.length;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '최근 14일 하루별 받아쓴 글자 수');
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    svg.append(n);
    return n;
  };
  for (const f of [0, 0.5, 1]) {
    const y = pad.t + ih - f * ih;
    add('line', { class: 'gridline', x1: pad.l, x2: W - pad.r, y1: y, y2: y });
    add('text', { class: 'axis', x: pad.l - 8, y: y + 3.5, 'text-anchor': 'end' }, fmt.format(Math.round(top * f)));
  }
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'tooltip', hidden: true });
  days.forEach((d, i) => {
    const x = pad.l + i * bw + bw * 0.22;
    const w = bw * 0.56;
    const bh = d.chars ? Math.max(3, (d.chars / top) * ih) : 2;
    const y = pad.t + ih - bh;
    const hit = add('rect', { class: 'hit', x: pad.l + i * bw, y: pad.t, width: bw, height: ih });
    // 위쪽 끝만 둥글게 (아래는 기준선에 붙는다)
    const r = Math.min(4, w / 2, bh);
    add('path', { class: `barmark${d.chars ? '' : ' zero'}`, d: `M${x},${y + bh}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + bh}Z` });
    if (i % 2 === 1 || i === 13) add('text', { class: 'axis', x: x + w / 2, y: H - 6, 'text-anchor': 'middle' }, i === 13 ? '오늘' : `${d.d.getMonth() + 1}/${d.d.getDate()}`);
    hit.addEventListener('mouseenter', () => {
      tip.hidden = false;
      tip.replaceChildren(`${DAY.format(d.d)} · `, num(`${fmt.format(d.chars)}자`), ` · ${d.count}회`);
      const rect = svg.getBoundingClientRect();
      tip.style.left = `${((x + w / 2) / W) * rect.width}px`;
      tip.style.top = `${(y / H) * rect.height}px`;
    });
    hit.addEventListener('mouseleave', () => (tip.hidden = true));
  });
  wrap.append(svg, tip);
  return wrap;
}

// ── 확인 창 ─────────────────────────────────────────────────────────────
function confirmBox(title, text, yes) {
  const dlg = $('confirm');
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmYes').textContent = yes;
  dlg.showModal();
  $('confirmNo').focus();
  return new Promise((resolve) => {
    const done = (v) => {
      dlg.close();
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
  });
}

// ── ⌘K 빠른 검색 ────────────────────────────────────────────────────────
let paletteItems = [];
let paletteSel = 0;

function paletteResults(q) {
  const go = (hash) => () => (location.hash = hash);
  const groups = [];
  const nav = [
    ['i-home', '홈', go('#home')], ['i-mic', '받아쓰기 기록', go('#dictations')], ['i-people', '회의', go('#meetings')],
    ['i-book', '사전', go('#dictionary')], ['i-chart', '통계', go('#stats')], ['i-gear', '설정', () => openSettings()],
  ].map(([ic, title, run]) => ({ icon: ic, title, run }));
  const actions = [
    { icon: 'i-rec', title: recordingMode === 'meeting' ? '회의 녹음 종료하고 저장' : '회의 녹음 시작', run: () => (recordingMode === 'meeting' ? api.toggle('meeting') : openMeetingStart()) },
    recordingMode === 'meeting' && { icon: liveClock.paused ? 'i-play' : 'i-pause', title: liveClock.paused ? '회의 녹음 재개' : '회의 녹음 일시정지', run: () => api.pause(!liveClock.paused) },
    recordingMode === 'meeting' && { icon: 'i-x', title: '회의 녹음 취소 (버리기)', run: () => $('cancelBtn').click() },
    { icon: 'i-mic', title: recordingMode === 'memo' ? '받아쓰기 정지' : '받아쓰기 시작', sub: 'fn을 꾹 눌러도 됩니다', run: () => api.toggle('memo') },
    { icon: 'i-key', title: '계정·토큰 연결', run: () => openSettings('accounts') },
    { icon: 'i-shield', title: 'macOS 권한', run: () => openSettings('perms') },
    { icon: 'i-folder', title: '녹음 폴더 열기', run: () => api.openRecordings() },
  ].filter(Boolean);
  const match = (s) => s.toLowerCase().includes(q);
  if (!q) {
    groups.push(['이동', nav], ['동작', actions]);
    const recent = meetings().filter((m) => m.minutes?.status === 'done').slice(0, 3);
    if (recent.length) groups.push(['최근 회의', recent.map(meetingResult)]);
    return groups;
  }
  const meet = meetings().filter((m) => match(`${m.minutes?.title ?? ''} ${m.summary ?? ''}`)).slice(0, 6).map(meetingResult);
  const dict = dictations().filter((r) => match(r.transcript.text ?? r.transcript.raw)).slice(0, 6).map((r) => ({
    icon: 'i-copy', title: r.transcript.text ?? r.transcript.raw, sub: `${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))}${r.app ? ` · ${r.app}` : ''} · 눌러서 복사`,
    run: async () => {
      await api.copy(r.transcript.text ?? r.transcript.raw);
      toast('복사했습니다');
    },
  }));
  const n = [...nav, ...actions].filter((i) => match(i.title));
  if (n.length) groups.push(['이동 · 동작', n]);
  if (meet.length) groups.push(['회의', meet]);
  if (dict.length) groups.push(['받아쓰기', dict]);
  return groups;
}

function meetingResult(m) {
  return { icon: 'i-people', title: m.minutes?.title ?? `${dayLabel(m.startedAt)} 회의`, sub: m.summary ?? statusText(m.minutes), meta: clock(m.durationSec), run: () => (location.hash = `#meeting/${encodeURIComponent(m.id)}`) };
}

function renderPalette() {
  const q = $('paletteInput').value.trim().toLowerCase();
  const list = $('paletteList');
  const groups = paletteResults(q);
  paletteItems = groups.flatMap((g) => g[1]);
  paletteSel = Math.min(paletteSel, Math.max(0, paletteItems.length - 1));
  list.replaceChildren();
  if (!paletteItems.length) return list.append(h('div', { class: 'pempty' }, `"${q}"에 맞는 것이 없습니다`));
  let i = 0;
  for (const [label, items] of groups) {
    list.append(h('div', { class: 'pgroup' }, label));
    for (const item of items) {
      const idx = i++;
      list.append(h('button', {
        class: 'pitem', role: 'option', 'aria-selected': String(idx === paletteSel),
        onmouseenter: () => { paletteSel = idx; markPalette(); },
        onclick: () => runPalette(idx),
      }, icon(item.icon), h('span', { class: 'ptext' }, h('b', null, item.title), item.sub && h('small', null, item.sub)), item.meta && num(item.meta)));
    }
  }
}

function markPalette() {
  $('paletteList').querySelectorAll('.pitem').forEach((el, i) => {
    el.setAttribute('aria-selected', String(i === paletteSel));
    if (i === paletteSel) el.scrollIntoView({ block: 'nearest' });
  });
}

function runPalette(i) {
  const item = paletteItems[i];
  $('palette').close();
  item?.run();
}

function openPalette() {
  if ($('palette').open) return $('palette').close();
  if ($('settings').open) $('settings').close();
  $('paletteInput').value = '';
  paletteSel = 0;
  renderPalette();
  $('palette').showModal();
  $('paletteInput').focus();
}

$('paletteInput').oninput = () => {
  paletteSel = 0;
  renderPalette();
};
$('paletteInput').onkeydown = (e) => {
  if (e.isComposing) return;
  if (e.key === 'ArrowDown') paletteSel = Math.min(paletteItems.length - 1, paletteSel + 1);
  else if (e.key === 'ArrowUp') paletteSel = Math.max(0, paletteSel - 1);
  else if (e.key === 'Enter') return runPalette(paletteSel);
  else return;
  e.preventDefault();
  markPalette();
};
$('palette').addEventListener('click', (e) => e.target === $('palette') && $('palette').close());
$('openPalette').onclick = openPalette;

document.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
  } else if (e.metaKey && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});

// ── 설정 ────────────────────────────────────────────────────────────────
function openSettings(sec = 'general') {
  if ($('palette').open) $('palette').close();
  for (const tab of document.querySelectorAll('.set-tab')) tab.setAttribute('aria-current', String(tab.dataset.sec === sec));
  for (const s of document.querySelectorAll('.set-sec')) s.hidden = s.dataset.sec !== sec;
  if (!$('settings').open) {
    $('settings').showModal();
    document.activeElement?.blur(); // 열자마자 첫 탭에 포커스 테두리가 그려지지 않게
  }
  if (sec === 'perms') renderPerms();
  if (sec === 'engine') api.setupStatus().then(renderSetup);
  if (sec === 'cleanup') renderProviders(true);
  if (sec === 'accounts') {
    for (const r of $('settings').querySelectorAll('[data-result]')) r.textContent = '';
    renderConnections();
  }
}
for (const tab of document.querySelectorAll('.set-tab')) tab.onclick = () => openSettings(tab.dataset.sec);
$('settingsClose').onclick = () => $('settings').close();
$('settings').addEventListener('click', (e) => e.target === $('settings') && $('settings').close());
$('openSettings').onclick = () => openSettings();
$('enginesBtn').onclick = () => {
  const bad = [...issues.values()].find((i) => i.sec);
  openSettings(bad?.sec ?? 'engine');
};

function setEngine(id, state, text) {
  const el = $(id);
  el.className = `engine ${state}`;
  el.querySelector('em').textContent = text;
}

function renderEngine(engine) {
  const mb = (n) => `${Math.round(n / 1e6)}MB`;
  const text = {
    ready: 'Whisper large-v3-turbo · 이 Mac 안에서 실행',
    loading: '모델을 메모리에 올리는 중…',
    stopped: '꺼져 있음',
    'no-engine': 'whisper.cpp가 설치되어 있지 않습니다. 터미널에서 brew install whisper-cpp',
    'no-model': '음성 인식 모델(약 0.9GB)을 받아야 합니다.',
    downloading: `모델 받는 중 ${mb(engine.received)}${engine.total ? ` / ${mb(engine.total)}` : ''}`,
    error: `오류: ${engine.error}`,
  }[engine.state] ?? engine.state;
  const bad = ['no-engine', 'no-model', 'error'].includes(engine.state);
  $('engineLine').textContent = text;
  $('engineLine').classList.toggle('bad', bad);
  const acts = $('engineActs');
  acts.replaceChildren();
  acts.append(h('button', { class: 'btn small', onclick: () => openSettings('engine') }, bad ? '설치하기' : '엔진 관리'));
  const short = { ready: '준비됨', loading: '불러오는 중', downloading: '받는 중', stopped: '꺼짐' }[engine.state] ?? '설정 필요';
  setEngine('engAsr', bad ? 'bad' : engine.state === 'ready' ? 'ok' : 'busy', short);
  setIssue('engine', bad ? {
    title: '받아쓰기를 쓸 수 없습니다', detail: text, sec: 'engine',
    action: '설치하기', onAction: () => openSettings('engine'),
  } : null);
}

let providers = null;
async function renderProviders(fresh = false) {
  providers = await api.providers({ fresh });
  const box = $('providers');
  box.replaceChildren();
  const rows = [
    ['auto', '자동', '로그인된 계정 중 가장 빠른 것'],
    ['claude-code', 'Claude Code', providers['claude-code']],
    ['codex', 'Codex', providers.codex],
    ['api', 'Anthropic API 키', providers.api],
  ];
  for (const [id, name, info] of rows) {
    const usable = typeof info === 'string' || info.loggedIn;
    const who = typeof info === 'string' ? info : !info.installed ? '설치 안 됨' : info.loggedIn ? info.account ?? (id === 'api' ? '키 저장됨' : '로그인됨') : id === 'api' ? '키 없음 · 계정·토큰에서 입력' : '로그인 필요';
    const input = h('input', { type: 'radio', name: 'provider', value: id, checked: settings.provider === id, disabled: !usable });
    input.onchange = () => saveDict({ provider: id });
    box.append(h('label', { class: `choice${usable ? '' : ' off'}` }, input, h('b', null, name), h('span', { class: 'who' }, who)));
  }
  renderSideCleanup();
}

function renderSideCleanup() {
  if (!settings || !providers) return;
  let label;
  if (!settings.cleanup) label = '꺼짐';
  else if (settings.provider !== 'auto') label = PROVIDER_NAME[settings.provider];
  else label = ['claude-code', 'codex', 'api'].map((id) => providers[id]?.loggedIn && PROVIDER_NAME[id]).find(Boolean) ?? '계정 없음';
  setEngine('engCleanup', label === '계정 없음' ? 'bad' : settings.cleanup ? 'ok' : '', label);
  setIssue('cleanup', label === '계정 없음' ? { title: '다듬기에 쓸 계정이 없습니다', detail: 'Claude Code·Codex에 로그인하거나 API 키를 넣으세요. 그 전까지는 들린 그대로 입력합니다.', action: '계정 연결', onAction: () => openSettings('accounts'), sec: 'accounts' } : null);
}

function renderDictSettings(s) {
  settings = s;
  $('minutesAuto').checked = s.minutes;
  $('diarizeOn').checked = s.diarize;
  const dl = $('diarizeLine');
  if (!s.diarizeReady) {
    dl.textContent = '화자 구분 엔진(pyannote)이 설치되어 있지 않습니다. 설정 › 엔진에서 설치하세요.';
    dl.className = 'bad';
  } else if (!s.hasHfToken) {
    dl.textContent = 'Hugging Face 토큰이 필요합니다. 계정·토큰에서 넣어 주세요.';
    dl.className = 'bad';
  } else {
    dl.textContent = '누가 말했는지 구분합니다 (pyannote community-1, 이 Mac 안에서 처리).';
    dl.className = '';
  }
  const dState = !s.diarize ? ['', '꺼짐'] : !s.diarizeReady ? ['bad', '설치 필요'] : s.hasHfToken ? ['ok', '준비됨'] : ['bad', '토큰 필요'];
  setEngine('engDiarize', ...dState);
  setIssue('hf', s.diarize && s.diarizeReady && !s.hasHfToken ? {
    title: '화자 구분에 Hugging Face 토큰이 필요합니다', detail: '토큰을 넣기 전까지 회의 스크립트에 화자가 표시되지 않습니다.',
    action: '토큰 넣기', onAction: () => openSettings('accounts'), sec: 'accounts',
  } : null);
  $('meetingSystem').checked = s.meetingSystemAudio;
  $('dictEnabled').checked = s.enabled;
  $('dictLanguage').value = s.language;
  $('dictCleanup').checked = s.cleanup;
  $('countWords').textContent = vocabWords().length || '';
  renderEngine(s.engine);
  renderSideCleanup();
}

async function saveDict(patch) {
  renderDictSettings(await api.dictSaveSettings(patch));
  if ('apiKey' in patch || 'provider' in patch || 'cleanup' in patch) renderProviders();
}

$('dictEnabled').onchange = (e) => saveDict({ enabled: e.target.checked });
$('dictLanguage').onchange = (e) => saveDict({ language: e.target.value });
$('dictCleanup').onchange = (e) => saveDict({ cleanup: e.target.checked });
$('minutesAuto').onchange = (e) => saveDict({ minutes: e.target.checked });
$('diarizeOn').onchange = (e) => saveDict({ diarize: e.target.checked });
$('meetingSystem').onchange = async (e) => {
  await saveDict({ meetingSystemAudio: e.target.checked });
  renderPerms();
};
$('openDir').onclick = () => api.openRecordings();

// 녹음 폴더: 기본은 ~/Documents/MeetingRecorder, 사용자가 고르면 바꾼다
const tilde = (p) => p?.replace(/^\/Users\/[^/]+/, '~') ?? '';
function showRecordingsDir(dir, def) {
  $('recDirPath').textContent = tilde(dir);
  $('recDirPath').title = dir;
  $('resetDir').hidden = dir === def;
}
$('chooseDir').onclick = async () => {
  try {
    const r = await api.chooseRecordings();
    if (!r) return;
    showRecordingsDir(r.dir, (await api.info()).defaultRecordingsDir);
    renderDictSettings(await api.dictSettings()); // 새 폴더에 있던 사전이 합쳐졌을 수 있다
    toast('녹음 폴더를 바꿨습니다', r.total ? (r.moved ? `기존 녹음 ${r.moved}개를 옮겼습니다${r.skipped ? ` · ${r.skipped}개는 같은 이름이 있거나 옮기지 못해 남겨 두었습니다` : ''}` : '기존 녹음은 원래 폴더에 남겨 두었습니다') : tilde(r.dir));
    docCache.clear();
    loadHistory();
  } catch (err) {
    toast('녹음 폴더를 바꾸지 못했습니다', err.message, { bad: true });
  }
};
$('resetDir').onclick = async () => {
  try {
    const r = await api.resetRecordings();
    showRecordingsDir(r.dir, r.dir);
    toast('기본 녹음 폴더로 돌렸습니다', '바꾼 폴더의 녹음은 그 자리에 남아 있습니다');
    docCache.clear();
    loadHistory();
  } catch (err) {
    toast('바꾸지 못했습니다', err.message, { bad: true });
  }
};

api.onDictEngine(renderEngine);
api.onDictStage(({ stage }) => showStage(stage));

api.onDictResult((r) => {
  setLive('idle');
  if (r.status === 'error') toast('받아쓰기 실패', r.error, { bad: true, ms: 7000 });
  else if (r.status === 'no-permission') toast('입력하지 못했습니다', '손쉬운 사용 권한이 없어 클립보드에만 복사했습니다. ⌘V로 붙여 넣으세요.', { bad: true, action: '권한 보기', onAction: () => openSettings('perms'), ms: 8000 });
  else if (r.status === 'failed') toast('입력하지 못했습니다', '클립보드에 복사해 두었습니다. ⌘V로 붙여 넣으세요.', { bad: true, ms: 7000 });
  freshId = r.id ?? null;
  loadHistory();
});

// ── 마이크 장치 ─────────────────────────────────────────────────────────
const BLUETOOTH_HINT = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

async function loadDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const select = $('micSelect');
  const cur = select.value;
  select.replaceChildren(new Option('시스템 기본값', ''));
  for (const d of devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')) select.append(new Option(d.label || '알 수 없는 마이크', d.deviceId));
  select.value = cur || store('micId', ''); // 없는 장치면 브라우저가 알아서 '시스템 기본값'으로 돌린다
  updateMicHint();
}

function updateMicHint() {
  const select = $('micSelect');
  const label = select.value ? select.selectedOptions[0]?.textContent : '';
  const bt = BLUETOOTH_HINT.test(label ?? '');
  $('micHint').textContent = bt ? '블루투스 마이크는 16kHz 이하로 녹음되고 스피커 음질도 떨어집니다. 내장·유선 마이크를 권장합니다.' : '받아쓰기와 회의 녹음에 쓰는 장치';
  $('micHint').classList.toggle('bad', bt);
}
$('micSelect').onchange = () => {
  remember('micId', $('micSelect').value);
  updateMicHint();
};
navigator.mediaDevices.addEventListener('devicechange', loadDevices);

// ── 권한 ────────────────────────────────────────────────────────────────
const PERMS = [
  { kind: 'microphone', name: '마이크', what: '내 목소리 녹음' },
  { kind: 'inputMonitoring', name: '입력 모니터링', what: 'fn 키 감지' },
  { kind: 'accessibility', name: '손쉬운 사용', what: '받아쓴 글을 커서 위치에 입력' },
  { kind: 'systemAudio', name: '시스템 오디오 녹음', what: '화상 회의 상대방 소리 녹음', optional: () => !settings?.meetingSystemAudio },
];

async function requestPerm(kind, btn) {
  if (btn) {
    btn.classList.add('busy'); // 흐리게 하지 않고 진행 중 표시
    btn.textContent = '기다리는 중…';
  }
  renderPerms(await api.permRequest(kind));
}

async function renderPerms(status) {
  status ??= await api.permStatus();
  const list = $('permList');
  list.replaceChildren();
  for (const p of PERMS) {
    const st = status[p.kind];
    const ok = st === 'granted' || st === 'unsupported';
    const optional = !ok && p.optional?.();
    const first = st === 'not-determined' || st === 'unknown';
    const row = h('div', { class: 'perm' },
      h('div', { class: 'field-text' }, h('b', null, p.name), h('span', null, optional ? `${p.what} · 화상 회의 녹음을 켤 때만 필요` : p.what)));
    if (ok) row.append(h('span', { class: 'pill ok' }, st === 'granted' ? '허용됨' : '이 macOS에서는 지원 안 됨'));
    else {
      const btn = h('button', { class: 'btn small primary' }, first ? '허용하기' : '시스템 설정 열기');
      btn.onclick = () => requestPerm(p.kind, btn);
      row.append(btn);
    }
    list.append(row);
    setIssue(`perm:${p.kind}`, ok || optional ? null : {
      title: `${p.name} 권한이 필요합니다`, detail: `${p.what}에 씁니다.`, sec: 'perms',
      action: first ? '허용하기' : '시스템 설정 열기', onAction: () => requestPerm(p.kind),
    });
  }
}

setInterval(() => document.visibilityState === 'visible' && renderPerms(), 3000);
window.addEventListener('focus', () => {
  renderPerms();
  loadHistory();
});
api.onPermChanged(() => renderPerms());

// ── 엔진: 설치 · 크기 · 지우기 ───────────────────────────────────────────
const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`);
let setupWasRunning = false;

function renderSetup(list) {
  const box = $('compList');
  box.replaceChildren();
  let total = 0;
  const running = list.some((c) => c.job?.running);
  $('engineDot').hidden = !list.some((c) => !c.installed && c.id !== 'large');
  for (const c of list) {
    if (c.installed && c.size) total += c.size;
    const job = c.job;
    const state = job?.running ? ['', '설치 중'] : job?.error ? ['bad', '실패'] : c.installed ? ['ok', '설치됨'] : c.partial ? ['bad', '모델 없음'] : ['', '없음'];
    const acts = h('div', { class: 'comp-acts' });
    if (!c.installed && !job?.running && !(c.blocker === 'brew')) {
      acts.append(h('button', { class: 'btn small primary', onclick: () => api.setupInstall(c.id) }, job?.error ? '다시 시도' : c.id === 'engine' ? '설치' : '받기'));
    }
    if (c.installed && c.removable && !job?.running) {
      acts.append(h('button', { class: 'btn small ghost', onclick: async () => {
        if (!(await confirmBox(`${c.name}을(를) 지울까요?`, `${gb(c.size)}를 확보합니다. 필요하면 언제든 다시 받을 수 있습니다.`, '지우기'))) return;
        try {
          await api.setupRemove(c.id);
          toast(`${c.name}을(를) 지웠습니다`);
          renderDictSettings(await api.dictSettings());
        } catch (err) {
          toast('지우지 못했습니다', err.message, { bad: true });
        }
      } }, '지우기'));
    }
    const row = h('div', { class: 'comp' },
      h('div', { class: 'comp-main' }, h('b', null, c.name), h('span', null, c.desc)),
      h('div', { class: 'comp-side' }, h('span', { class: `pill ${state[0]}` }, state[1]), c.size && (c.installed || c.id !== 'engine') && num(c.installed ? gb(c.size) : `약 ${gb(c.size)}`)),
      acts);
    if (job?.running) row.append(h('div', { class: 'comp-progress' }, h('div', { class: `bar${job.pct == null ? ' indeterminate' : ''}` }, h('i', { style: `width:${Math.round((job.pct ?? 0.3) * 100)}%` })), h('span', null, job.text ?? '')));
    if (job?.error) row.append(h('div', { class: 'comp-note bad' }, job.error, c.blocker === 'token' && h('button', { class: 'link', onclick: () => openSettings('accounts') }, '토큰 넣기')));
    if (!c.installed && c.blocker === 'brew') row.append(h('div', { class: 'comp-note' }, '터미널에서 Homebrew를 먼저 설치하세요.', h('button', { class: 'link', onclick: () => api.openExternal('https://brew.sh') }, 'brew.sh 열기')));
    if (!c.installed && c.blocker === 'token' && !job?.running && !job?.error) row.append(h('div', { class: 'comp-note' }, 'Hugging Face 토큰이 있어야 모델을 받을 수 있습니다.', h('button', { class: 'link', onclick: () => openSettings('accounts') }, '토큰 넣기')));
    box.append(row);
  }
  $('compTotal').textContent = `앱 폴더 사용량 ${gb(total)} · ~/Library/Application Support/meeting-recorder`;
  // 설치가 끝나면 화자 구분·엔진 상태를 다시 읽는다
  if (setupWasRunning && !running) api.dictSettings().then(renderDictSettings);
  setupWasRunning = running;
}
const setupListeners = new Set();
api.onSetup((list) => {
  if ($('settings').open) renderSetup(list);
  setupListeners.forEach((fn) => fn(list));
});

// ── 계정·토큰 ───────────────────────────────────────────────────────────
const SOURCE_TEXT = {
  hf: (s) => (s.app ? '앱에 저장됨' : s.cli ? '터미널 로그인 토큰 사용 중' : '없음'),
  anthropic: (s) => (s.app ? '앱에 저장됨' : s.env ? '환경 변수 사용 중' : '없음'),
};

async function renderConnections(status) {
  status ??= await api.tokenStatus();
  for (const block of $('settings').querySelectorAll('.conn-block[data-kind]')) {
    const kind = block.dataset.kind;
    const s = status[kind];
    const has = s.app || s.cli || s.env;
    const pill = block.querySelector('[data-state]');
    pill.textContent = SOURCE_TEXT[kind](s);
    pill.className = `pill ${has ? 'ok' : kind === 'hf' && settings?.diarize ? 'bad' : ''}`;
    block.querySelector('[data-clear]').disabled = !s.app;
    block.querySelector('[data-verify]').disabled = !has;
  }
  const p = await api.providers({ fresh: true });
  $('connAccounts').replaceChildren(...[['claude-code', 'Claude Code'], ['codex', 'Codex']].map(([id, name]) => {
    const info = p[id];
    return h('div', { class: 'account' }, h('b', null, name), h('span', { class: info.loggedIn ? 'ok' : '' }, !info.installed ? '설치 안 됨' : info.loggedIn ? `로그인됨${info.account ? ` · ${info.account}` : ''}` : '로그인 안 됨'));
  }));
}

for (const block of $('settings').querySelectorAll('.conn-block[data-kind]')) {
  const kind = block.dataset.kind;
  const input = block.querySelector('[data-input]');
  const result = block.querySelector('[data-result]');
  const show = (ok, text) => {
    result.textContent = text;
    result.className = `result ${ok ? 'ok' : 'bad'}`;
  };
  block.querySelector('[data-toggle]').onclick = (e) => {
    input.type = input.type === 'password' ? 'text' : 'password';
    e.target.textContent = input.type === 'password' ? '보기' : '숨기기';
  };
  const save = async () => {
    if (!input.value.trim()) return input.focus();
    await renderConnections(await api.saveToken(kind, input.value));
    input.value = '';
    input.type = 'password';
    block.querySelector('[data-toggle]').textContent = '보기';
    show(true, '저장했습니다. 확인 중…');
    const r = await api.verifyToken(kind);
    show(r.ok, r.message);
    renderDictSettings(await api.dictSettings());
    renderProviders(true);
  };
  block.querySelector('[data-save]').onclick = save;
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.isComposing) save();
  };
  block.querySelector('[data-verify]').onclick = async () => {
    show(true, '확인 중…');
    const r = await api.verifyToken(kind);
    show(r.ok, r.message);
  };
  block.querySelector('[data-clear]').onclick = async () => {
    await renderConnections(await api.clearToken(kind));
    show(true, '지웠습니다.');
    renderDictSettings(await api.dictSettings());
    renderProviders(true);
  };
}
for (const b of $('settings').querySelectorAll('[data-link]')) b.onclick = () => api.openExternal(b.dataset.link);
$('connRefresh').onclick = () => renderConnections();

// ── 시작 ────────────────────────────────────────────────────────────────
setRecording(null);

// 처음 설정: 끝내기 전까지는 본 화면 대신 온보딩을 보여 준다
const fnListeners = new Set();
const tapListeners = new Set();
api.onOnboardingFn((s) => fnListeners.forEach((fn) => fn(s)));
api.onOnboardingTap(() => tapListeners.forEach((fn) => fn()));
const onboardingCtx = {
  api, h, icon, toast, setupListeners, fnListeners, tapListeners,
  getMic: () => $('micSelect').value,
  setMic: (id) => {
    $('micSelect').value = id;
    remember('micId', id);
    updateMicHint();
  },
  onDone: async () => {
    renderDictSettings(await api.dictSettings());
    renderPerms();
    renderProviders(true);
    location.hash = '#home';
    loadHistory();
    toast('준비가 끝났습니다', 'fn을 꾹 누른 채 말해 보세요');
  },
};
$('rerunOnboarding').onclick = async () => {
  $('settings').close();
  startOnboarding(onboardingCtx, { ...(await api.onboardingGet()), step: 'welcome' });
};
// 본 화면은 처음에 숨겨 두고(index.html), 처음 설정을 마쳤는지 먼저 본 뒤에 보여 준다 → 본 화면이 잠깐 비쳤다가 바뀌지 않게
const onboarding = await api.onboardingGet();
if (!onboarding.completed) startOnboarding(onboardingCtx, onboarding);
else document.querySelector('.shell').hidden = false;
api.appReady(); // 보여 줄 화면이 정해졌으니 창을 띄운다

const info = await api.info();
showRecordingsDir(info.recordingsDir, info.defaultRecordingsDir);
renderDictSettings(await api.dictSettings());
renderPerms();
renderProviders();
await loadHistory();
navigate();
if (info.capability === 'unsupported') toast('이 macOS에서는 상대방 소리를 녹음할 수 없습니다', '회의도 마이크만 녹음합니다.', { ms: 7000 });
if (info.fnWarning) setIssue('fnUsage', { title: 'fn 키가 다른 동작과 겹칩니다', detail: info.fnWarning, sec: 'general', dismiss: true });
await loadDevices();

recorder.prepare().catch((err) => toast('오디오 엔진 준비 실패', err.message, { bad: true }));
