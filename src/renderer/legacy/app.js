import { Recorder } from './recorder.js';
import { startOnboarding } from './onboarding.js';
import { reactPage, mountReact } from '../shared/page-host/index.tsx'; // React로 옮긴 화면을 옛 라우터에 끼운다 (docs/renderer-architecture.md)
import { createVocabularyModel } from '../entities/vocabulary/index.ts';
import { DictionaryPage } from '../pages/dictionary/index.ts';
import { StatsPage } from '../pages/stats/index.ts';
import { HomePage } from '../pages/home/index.ts';
import { DictationsPage } from '../pages/dictations/index.ts';
import { MeetingsPage } from '../pages/meetings/index.ts';
import { createAskStore, AskWidget } from '../features/ask/index.ts';
import { meetingPage } from '../pages/meeting/index.ts';
import { createPlayback } from '../features/meeting-player/index.ts';
import { TIME, clock, sizeLabel, dayLabel, createSource, createJobs, store, remember } from '../shared/lib/index.ts'; // 숫자·시간 표시는 한 벌 (React 화면과 같이 씀)
import { createToaster, confirmBox, installTooltips } from '../shared/ui/index.tsx';
import { statusText } from '../entities/meeting/index.ts';
import { createIssueStore } from '../entities/issue/index.ts';
import { createSettingsStore } from '../entities/settings/index.ts';
import { mountSettings } from '../features/configuration/index.ts';

const api = window.recorderApi;
const settingsStore = createSettingsStore(api);
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

installTooltips();
const FULL = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });


const toast = createToaster((m) => api.log(m));

// ── 확인해야 할 문제 (권한·엔진·토큰): 홈 맨 위와 설정 점으로 계속 보인다 ─────────
// 주인은 entities/issue(issues.set). 바뀌면 여기서 창구·설정 점·홈을 그 자리에서 바꾼다
const issues = createIssueStore();
issues.subscribe(() => {
  homeSource.changed();
  dictationsSource.changed();
  meetingsSource.changed();
  const list = issues.getSnapshot().entries;
  const secs = new Set(list.map(([, i]) => i.sec));
  $('settingsDot').hidden = list.length === 0;
  $('permDot').hidden = !secs.has('perms');
  $('accountsDot').hidden = !secs.has('accounts');
  if (route.name === 'home') refresh();
});


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
        includeSystem: mode === 'meeting' && Boolean(settingsStore.getSnapshot().saved?.meetingSystemAudio),
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
  const savedSec = Math.max(0, ...Object.values(result.files ?? {}).map((f) => f.durationSec ?? 0));
  if (wasMode === 'meeting' && savedSec >= 10) toast('회의 녹음을 저장했습니다', settingsStore.getSnapshot().saved?.minutes ? '회의록을 만들기 시작합니다' : '');
  loadHistory();
  // 권한이 없으면 macOS는 에러 없이 완전한 무음(0)을 넘겨준다
  if (result.files.system && peakDb.system < -150) {
    issues.set('system-silent', { title: '상대방 소리가 녹음되지 않았습니다', detail: '시스템 오디오 녹음 권한을 허용한 뒤 앱을 다시 실행하세요.', action: '권한 보기', onAction: () => openSettings('perms'), sec: 'perms', dismiss: true });
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
  const kind = settingsStore.getSnapshot().saved?.meetingSystemAudio ? 'online' : 'offline';
  segPick($('startKind'), 'kind', kind);
  $('startMinutes').checked = Boolean(settingsStore.getSnapshot().saved?.minutes);
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
  if (online !== Boolean(settingsStore.getSnapshot().saved?.meetingSystemAudio)) patch.meetingSystemAudio = online;
  if ($('startMinutes').checked !== Boolean(settingsStore.getSnapshot().saved?.minutes)) patch.minutes = $('startMinutes').checked;
  if (Object.keys(patch).length) await settingsStore.save(patch);
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
api.onFnStatus((s) => issues.set('fn', s.ok ? null : { title: 'fn 키를 감지하지 못합니다', detail: s.reason, action: '권한 보기', onAction: () => openSettings('perms'), sec: 'perms' }));

// ── 기록 데이터 ─────────────────────────────────────────────────────────
let history = [];
let strays = []; // 녹음 폴더에 있지만 목록에 안 나오는 폴더 (recordings:stray)
let freshId = null;
const dictations = () => history.filter((r) => r.mode === 'memo' && r.transcript?.raw);
const meetings = () => history.filter((r) => r.mode === 'meeting');

// macOS가 녹음 폴더(기본은 문서 폴더 안) 접근을 막으면 목록이 비어 보인다. 녹음이 사라진 게 아니라고 알린다
const FOLDER_DENIED = new Set(['EPERM', 'EACCES']);
function folderIssue(access) {
  if (!access || access.ok) return null;
  const denied = FOLDER_DENIED.has(access.code);
  const tilde = (p) => p?.replace(/^\/Users\/[^/]+/, '~') ?? '';
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

async function loadHistory() {
  const [list, access, stray, totals] = await Promise.all([api.history(), api.recordingsAccess(), api.strayFolders(), api.dictStats()]);
  history = list;
  strays = stray ?? [];
  dictTotals = totals ?? null;
  statsSource.changed();
  homeSource.changed();
  dictationsSource.changed();
  meetingsSource.changed();
  issues.set('folder', folderIssue(access));
  $('countDict').textContent = dictTotals?.count || dictations().length || '';
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


// ── 라우터 ──────────────────────────────────────────────────────────────
const ROUTES = { home: () => reactPage(HomePage, { source: homeSource, actions: homeActions }), dictations: () => reactPage(DictationsPage, { source: dictationsSource, actions: dictationsActions }), meetings: openMeetingsPage, meeting: (mid) => meetingPage(mid, meetingDeps), dictionary: () => reactPage(DictionaryPage, { model: vocabulary }), stats: () => reactPage(StatsPage, { source: statsSource }) };
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
let dictTotals = null; // 본체가 전체 받아쓰기 기록으로 계산한 통계 (dict:stats)
// 통계 화면(React)이 읽는 창구: 주인은 여기(history·dictTotals), 둘이 바뀌는 loadHistory에서 changed()
const statsSource = createSource(() => ({ dictations: dictations(), totals: dictTotals, meetings: meetings() }), () => [history, dictTotals]);
// 받아쓰기 요약 (계산은 entities/dictation — 통계 화면과 한 벌). 본체 전체 통계(dictTotals)가 있으면 그것으로

// 홈: 왼쪽은 할 일(만드는 중 → 챙길 일 → 최근 회의), 오른쪽은 살펴볼 것(시작하기 → 녹음 공간 → 최근 받아쓰기).
// 처음 만들 땐 회의가 없어 안내 카드뿐이었다 — 이제는 쌓인 회의에서 손이 갈 곳을 먼저 보인다
let meetFilterPending = null; // 홈에서 회의 화면으로 가면서 고를 갈래
function openMeetings(filter) {
  meetFilterPending = filter;
  location.hash = '#meetings';
}
// 홈 화면(React)이 읽는 창구와 명령. 주인은 여기: 기록(history·dictTotals·strays)은 loadHistory, 문제는 issues 구독에서 changed().
// freshId·showMarks·openRaw는 바뀐 뒤 refresh()가 다시 그려 deps로 알아챈다 (openRaw는 바꿀 때 새 Set)
const homeSource = createSource(
  () => ({ meetings: meetings(), dictations: dictations(), totals: dictTotals, issues: issues.getSnapshot().entries, strayCount: strays.length, freshId, showMarks, openRaw }),
  () => [history, dictTotals, strays, issues.getSnapshot().revision, freshId, showMarks, openRaw],
);
const homeActions = {
  openSettings: (sec) => openSettings(sec),
  openMeetingStart: () => openMeetingStart(),
  openMeetings,
  dismissIssue: (key) => issues.set(key, null),
  copy: (text) => api.copy(text),
  repaste: async (text) => {
    const status = await api.repaste(text);
    if (status !== 'pasted') toast('클립보드에 복사했습니다', '⌘V로 붙여 넣으세요');
  },
};

async function trashMeetings(list) {
  const total = list.reduce((n, m) => n + m.durationSec, 0);
  const title = list.length > 1 ? `녹음 ${list.length}개를 휴지통으로 옮길까요?` : '이 녹음을 휴지통으로 옮길까요?';
  if (!(await confirmBox(title, `녹음 폴더째(총 ${clock(total)}) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.`, '휴지통으로'))) return;
  let failed = 0;
  for (const m of list) await api.trashMeeting(m.dir).catch(() => failed++);
  toast(failed ? `${list.length - failed}개를 옮기고 ${failed}개는 옮기지 못했습니다` : `${list.length}개를 휴지통으로 옮겼습니다`, failed ? '회의록을 만드는 중인 녹음은 옮길 수 없습니다' : '', { bad: Boolean(failed) });
  loadHistory();
}


async function trashStrays(list) {
  const bytes = list.reduce((n, f) => n + f.bytes, 0);
  const title = list.length > 1 ? `폴더 ${list.length}개를 휴지통으로 옮길까요?` : `'${list[0].id}' 폴더를 휴지통으로 옮길까요?`;
  if (!(await confirmBox(title, `폴더째(총 ${sizeLabel(bytes)}) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.`, '휴지통으로'))) return;
  let failed = 0;
  for (const f of list) await api.trashMeeting(f.dir).catch(() => failed++);
  toast(failed ? `${list.length - failed}개를 옮기고 ${failed}개는 옮기지 못했습니다` : `${list.length}개를 휴지통으로 옮겼습니다`, '', { bad: Boolean(failed) });
  loadHistory();
}

// ── 받아쓰기 ────────────────────────────────────────────────────────────
let openRaw = new Set(); // 바꿀 땐 새 Set으로 (창구가 바뀐 줄 안다)
let showMarks = store('showMarks', true);


// 받아쓰기 기록 화면(React)이 읽는 창구와 명령. 목록은 화면이 본체(dictPage)에서 이어 받고, 기록(history)이 바뀌면 다시 받는다.
// 고친 곳 표시(showMarks)·원문 펼침(openRaw)·녹음 폴더 문제는 주인인 여기 — 바꾸면 changed()
const dictationsSource = createSource(
  () => ({ version: history, folder: issues.get('folder') ?? null, freshId, showMarks, openRaw }),
  () => [history, issues.getSnapshot().revision, freshId, showMarks, openRaw],
);
const dictationsActions = {
  loadPage: (query) => api.dictPage(query),
  copy: (text) => api.copy(text),
  repaste: async (text) => {
    const status = await api.repaste(text);
    if (status !== 'pasted') toast('클립보드에 복사했습니다', '⌘V로 붙여 넣으세요');
  },
  toggleRaw: (id) => {
    openRaw = new Set(openRaw);
    openRaw.has(id) ? openRaw.delete(id) : openRaw.add(id);
    dictationsSource.changed();
  },
  remove: async (id) => {
    if (!(await confirmBox('이 받아쓰기를 지울까요?', '기록과 통계에서 빠집니다. 되돌릴 수 없습니다.', '지우기'))) return;
    await api.deleteDictation(id);
    toast('받아쓰기를 지웠습니다');
    loadHistory();
  },
  setShowMarks: (on) => {
    showMarks = on;
    remember('showMarks', showMarks);
    dictationsSource.changed();
  },
};

// ── 회의 목록 ────────────────────────────────────────────────────────────
const goMeeting = (r, review = false) => {
  if (review) openReviewNext = r.id;
  location.hash = `#meeting/${encodeURIComponent(r.id)}`;
};
// 회의 목록 화면(React)이 읽는 창구와 명령. 갈래(meetFilter)는 주인인 여기 — 질문으로 찾기가 탭을 열고 홈이 갈래를 골라 들어온다.
// 질문 탭은 질문으로 찾기 store를 읽는다 (질문이 바뀌면 store가 알린다)
let meetFilter = 'all';
// 닫은(없어진)·막힌 질문 탭이면 전체로
function currentMeetFilter() {
  if (meetFilter.startsWith('ask:')) {
    const t = askStore.get(meetFilter.slice(4));
    if (!t || t.status === 'blocked') meetFilter = 'all';
  }
  return meetFilter;
}
const meetingsSource = createSource(
  () => ({ meetings: meetings(), strays, folder: issues.get('folder') ?? null, filter: currentMeetFilter(), asks: askStore.getSnapshot().jobs.filter((t) => t.status !== 'blocked') }),
  () => [history, strays, issues.getSnapshot().revision, meetFilter, askStore.getSnapshot().jobs],
);
function setMeetFilter(id) {
  meetFilter = id;
  $('view').scrollTop = 0;
  meetingsSource.changed();
}
const meetingsActions = {
  setFilter: setMeetFilter,
  openMeeting: (r) => goMeeting(r),
  openReview: (r) => goMeeting(r, true),
  trash: (list) => trashMeetings(list),
  trashStrays: (list) => trashStrays(list),
  reveal: (dir) => api.reveal(dir),
  importMeeting: (paths) => importMeeting(paths ?? null),
  openMeetingStart: () => openMeetingStart(),
  filePath: (f) => api.filePath(f),
};
function openMeetingsPage() {
  // 둥근 버튼의 알림·채팅에서 '보기'로 들어오면 그 질문 탭, 홈의 챙길 일에서 오면 그 갈래, 아니면 전체
  meetFilter = askPending ? `ask:${askPending}` : meetFilterPending ?? 'all';
  askPending = null;
  meetFilterPending = null;
  return reactPage(MeetingsPage, { source: meetingsSource, ask: askStore, actions: meetingsActions });
}

// ── 질문으로 찾기 (결정 51) ── 찾기는 메인 프로세스(src/ask.js)에서 돌고, 상태 주인은 features/ask의 store.
// 여기는 화면 이동(회의 화면의 그 질문 탭)과 설정 같은 바깥 일만 넘긴다. 둥근 버튼·질문 창·알림은 React(AskWidget)
let askPending = null; // 회의 화면으로 가면서 열 질문 탭
const askStore = createAskStore({
  api,
  viewing: (id) => route.name === 'meetings' && currentMeetFilter() === `ask:${id}`,
  openTab: (id) => {
    if (route.name === 'meetings') setMeetFilter(`ask:${id}`);
    else {
      askPending = id;
      location.hash = '#meetings';
    }
  },
  notifyError: (title, detail) => toast(title, detail, { bad: true }),
});
askStore.connect();
askStore.subscribe(() => meetingsSource.changed());
const askRoot = h('div', { class: 'ask-root' });
document.body.append(askRoot);
// 이 기능이 실제로 쓸 계정 (메인 프로세스와 같은 규칙: Claude Code에 로그인돼 있으면 그것, 아니면 다듬기 계정)
const askUsesCodex = () => {
  const { saved: settings, providers } = settingsStore.getSnapshot();
  return providers && !providers['claude-code']?.loggedIn && (settings?.provider === 'codex' || (settings?.provider === 'auto' && providers.codex?.loggedIn));
};
const askWidgetDeps = {
  onMeetings: () => route.name === 'meetings',
  usesCodex: () => Boolean(askUsesCodex()),
  noteClosed: () => store('askNoteClosed', false),
  closeNote: () => remember('askNoteClosed', true),
  openSettings: (sec) => openSettings(sec),
};

// 녹음 파일 가져오기: 파일을 고르면(또는 끌어다 놓으면) 확인 창에서 순서·참석 인원·녹음에 담기지 않은 내용을 받고 가져온다
let importing = false;
let importPaths = [];
let importSpeakers = '';
async function importMeeting(paths = null) {
  if (importing) return;
  const picked = await api.pickAudio(paths);
  const files = picked?.files;
  if (!files?.length) return;
  importPaths = files.map((f) => f.path);
  $('importOrder').textContent = files.length > 1 ? `이름 순서대로 이어 붙여 회의 하나로 만듭니다` : '';
  $('importFiles').replaceChildren(...files.map((f) => h('li', null, f.name, f.durationSec ? h('span', { class: 'num' }, clock(f.durationSec)) : null)));
  const box = $('importSpeakers');
  box.replaceChildren(...SPEAKER_CHOICES.map((v) => h('button', { type: 'button', role: 'radio', 'data-n': v, onclick: () => { importSpeakers = v; segPick(box, 'n', v); } }, speakerLabel(v))));
  importSpeakers = '';
  segPick(box, 'n', '');
  $('importNotes').value = '';
  // 회의 날짜: 짐작한 시각을 채우고 어디서 짐작했는지 알린다 (고칠 수 있다)
  const at = new Date(picked.guess?.at ?? Date.now());
  const p2 = (n) => String(n).padStart(2, '0');
  $('importDate').value = `${at.getFullYear()}-${p2(at.getMonth() + 1)}-${p2(at.getDate())}`;
  $('importTime').value = `${p2(at.getHours())}:${p2(at.getMinutes())}`;
  const today = new Date();
  $('importDate').max = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
  $('importWhenSrc').textContent = { name: '파일 이름에서 읽었습니다', mtime: '파일 시각으로 짐작했습니다 · 다르면 고쳐 주세요', now: '녹음 시각을 알 수 없어 지금으로 넣었습니다 · 고쳐 주세요' }[picked.guess?.source] ?? '';
  $('importWhenSrc').classList.toggle('warn', picked.guess?.source !== 'name');
  $('importSheet').showModal();
  $('importYes').focus();
}
$('importNo').onclick = () => $('importSheet').close();
$('importClose').onclick = () => $('importSheet').close();
$('importSheet').addEventListener('click', (e) => e.target === $('importSheet') && $('importSheet').close());
$('importYes').onclick = async () => {
  if (importing) return;
  const startedAt = new Date(`${$('importDate').value}T${$('importTime').value || '00:00'}`);
  if (!$('importDate').value || Number.isNaN(startedAt.getTime())) return toast('회의 날짜를 넣어 주세요', '', { bad: true });
  if (startedAt.getTime() > Date.now() + 60e3) return toast('아직 오지 않은 시각입니다', '회의를 시작한 날짜와 시각을 넣어 주세요', { bad: true });
  if (startedAt.getFullYear() < 2000) return toast('날짜를 확인해 주세요', '2000년 이후 날짜만 넣을 수 있습니다', { bad: true });
  importing = true;
  const btn = $('importYes');
  btn.classList.add('busy');
  btn.lastChild.textContent = '가져오는 중…';
  try {
    const r = await api.importMeeting(importPaths, { notes: $('importNotes').value.trim(), speakers: importSpeakers || null, startedAt: startedAt.toISOString() });
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

// 오래 걸리는 LLM 작업(흐름도 만들기·다시 만들기, 액션 찾기)을 회의별로 기억한다.
// 탭을 옮기거나 화면을 다시 그리면 버튼이 새로 만들어져 '정리하는 중…'이 사라지고, 다시 누르면 같은 작업이 두 번 돌았다.
const jobs = createJobs(); // `${dir}|흐름도` 같은 키 → { promise, label } (React 부품도 구독해 '… 중'을 그린다)
const audio = new Audio(); // 문서 밖에 두어 화면을 다시 그려도 재생이 끊기지 않는다
audio.preload = 'metadata';
// 재생 상태(시각·멈춤·속도·따라가기)를 재생 막대와 스크립트가 같이 구독한다 (features/meeting-player)
const playback = createPlayback(audio, { initial: store('follow', true), save: (on) => remember('follow', on) });

let openReviewNext = null; // 알림에서 '확인하기'로 들어오면 확인 필요 탭을 연다

// 회의 페이지: 그리기는 pages/meeting(MeetingPage), 페이지 상태·명령·⌘F는 같은 곳의 주인(meetingPage). 앱 전체의 것만 여기서 넘긴다
const meetingDeps = {
  api,
  records: () => history,
  docs: docCache,
  toast,
  confirm: (title, text, yes) => confirmBox(title, text, yes),
  loadHistory: () => loadHistory(),
  refreshSettings: () => settingsStore.refresh(),
  replaceRoute: (hash) => replaceRoute(hash),
  canGoBack: () => navIndex > 0,
  setCrumbs: (title) => setCrumbs(title),
  takeOpenReview: (mid) => {
    if (openReviewNext !== mid) return false;
    openReviewNext = null;
    return true;
  },
  playback,
  jobs,
  fullDate: (d) => FULL.format(d),
};

// ── 사전 ────────────────────────────────────────────────────────────────
// 사전은 저장된 설정을 읽고, 설정을 그린 끝에서 changed()로 다시 알린다
const vocabulary = createVocabularyModel({ read: () => settingsStore.getSnapshot().saved?.vocabulary ?? '', save: (v) => settingsStore.save({ vocabulary: v }) });
const vocabWords = () => vocabulary.getSnapshot();

// ── 통계 ────────────────────────────────────────────────────────────────
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
const settingsUi = mountSettings({
  api, settings: settingsStore, issues, toast, confirm: confirmBox,
  closePalette: () => { if ($('palette').open) $('palette').close(); },
  recordingsChanged: () => { docCache.clear(); loadHistory(); },
  rerunOnboarding: async () => {
    startOnboarding(onboardingCtx, { ...(await api.onboardingGet()), step: 'welcome' });
  },
});
const openSettings = (sec) => settingsUi.open(sec);
settingsStore.subscribe((change) => {
  if (change === 'settings') {
    $('countWords').textContent = vocabWords().length || '';
    vocabulary.changed();
  }
});

api.onDictStage(({ stage }) => showStage(stage));

api.onDictResult((r) => {
  setLive('idle');
  if (r.status === 'error') toast('받아쓰기 실패', r.error, { bad: true, ms: 7000 });
  else if (r.status === 'no-permission') toast('입력하지 못했습니다', '손쉬운 사용 권한이 없어 클립보드에만 복사했습니다. ⌘V로 붙여 넣으세요.', { bad: true, action: '권한 보기', onAction: () => openSettings('perms'), ms: 8000 });
  else if (r.status === 'failed') toast('입력하지 못했습니다', '클립보드에 복사해 두었습니다. ⌘V로 붙여 넣으세요.', { bad: true, ms: 7000 });
  freshId = r.id ?? null;
  loadHistory();
});

window.addEventListener('focus', () => {
  settingsUi.refreshPermissions();
  loadHistory();
});

// ── 시작 ────────────────────────────────────────────────────────────────
setRecording(null);

// 처음 설정: 끝내기 전까지는 본 화면 대신 온보딩을 보여 준다
const fnListeners = new Set();
const tapListeners = new Set();
api.onOnboardingFn((s) => fnListeners.forEach((fn) => fn(s)));
api.onOnboardingTap(() => tapListeners.forEach((fn) => fn()));
const onboardingCtx = {
  api, h, icon, toast, setupListeners: settingsUi.setupListeners, fnListeners, tapListeners,
  getMic: () => $('micSelect').value,
  setMic: (id) => {
    $('micSelect').value = id;
    remember('micId', id);
    settingsUi.updateMicHint();
  },
  onDone: async () => {
    await settingsStore.refresh();
    settingsUi.refreshPermissions();
    settingsStore.refreshProviders(true);
    location.hash = '#home';
    loadHistory();
    toast('준비가 끝났습니다', 'fn을 꾹 누른 채 말해 보세요');
  },
};
// 본 화면은 처음에 숨겨 두고(index.html), 처음 설정을 마쳤는지 먼저 본 뒤에 보여 준다 → 본 화면이 잠깐 비쳤다가 바뀌지 않게
const onboarding = await api.onboardingGet();
if (!onboarding.completed) startOnboarding(onboardingCtx, onboarding);
else document.querySelector('.shell').hidden = false;
api.appReady(); // 보여 줄 화면이 정해졌으니 창을 띄운다

const info = await api.info();
settingsUi.showRecordingsDir(info.recordingsDir, info.defaultRecordingsDir);
await settingsStore.refresh();
settingsUi.refreshPermissions();
settingsStore.refreshProviders();
await loadHistory();
askStore.load(await api.askList()); // 창을 닫았다 열어도 찾던 질문·끝난 탭이 그대로
navigate();
mountReact(askRoot, AskWidget, { store: askStore, deps: askWidgetDeps });
if (info.capability === 'unsupported') toast('이 macOS에서는 상대방 소리를 녹음할 수 없습니다', '회의도 마이크만 녹음합니다.', { ms: 7000 });
if (info.fnWarning) issues.set('fnUsage', { title: 'fn 키가 다른 동작과 겹칩니다', detail: info.fnWarning, sec: 'general', dismiss: true });
await settingsUi.loadDevices();

recorder.prepare().catch((err) => toast('오디오 엔진 준비 실패', err.message, { bad: true }));
