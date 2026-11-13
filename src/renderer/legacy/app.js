import { mountRecording } from '../features/recording/index.ts';
import { mountReact } from '../shared/page-host/index.tsx';
import { AskWidget } from '../features/ask/index.ts';
import { remember } from '../shared/lib/index.ts';
import { createToaster, confirmBox, installTooltips } from '../shared/ui/index.tsx';
import { createIssueStore } from '../entities/issue/index.ts';
import { createSettingsStore } from '../entities/settings/index.ts';
import { mountSettings, startOnboarding } from '../features/configuration/index.ts';
import { mountPalette } from '../features/palette/index.ts';
import { mountImportMeeting } from '../features/import-meeting/index.ts';
import { createHistoryStore, createRouter, createSession, createMeeting, createPages } from '../app/index.ts';

const api = window.recorderApi;
const settingsStore = createSettingsStore(api);
const $ = (id) => document.getElementById(id);

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
  if (router.route().name === 'home') router.refresh();
});


// ── 녹음 ────────────────────────────────────────────────────────────────
let recordingDictStage, recordingDictResult;
const recording = mountRecording({
  api: {
    ...api,
    onDictStage: (handler) => { recordingDictStage = handler; },
    onDictResult: (handler) => { recordingDictResult = handler; },
  },
  settings: settingsStore, issues, toast, confirm: confirmBox,
  readInput: () => ({ deviceId: $('micSelect').value || undefined, echoCancellation: $('echo').checked }),
  openSettings: (sec) => openSettings(sec),
  historyChanged: () => { loadHistory(); },
  dictationFinished: (id) => { session.freshId = id; loadHistory(); },
});
api.onFnStatus((s) => issues.set('fn', s.ok ? null : { title: 'fn 키를 감지하지 못합니다', detail: s.reason, action: '권한 보기', onAction: () => openSettings('perms'), sec: 'perms' }));

// ── 기록 데이터 ─────────────────────────────────────────────────────────
const history = createHistoryStore(api);
history.subscribe(() => {
  statsSource.changed();
  homeSource.changed();
  dictationsSource.changed();
  meetingsSource.changed();
  issues.set('folder', folderIssue(history.getSnapshot().access));
  $('countDict').textContent = history.getSnapshot().totals?.count || dictations().length || '';
  $('countMeet').textContent = meetings().length || '';
  router.refresh();
});
const loadHistory = () => history.reload();
const session = createSession();
const dictations = () => history.getSnapshot().rows.filter((r) => r.mode === 'memo' && r.transcript?.raw);
const meetings = () => history.getSnapshot().rows.filter((r) => r.mode === 'meeting');

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

const meeting = createMeeting({ api, history, settingsStore, router: () => router, toast, confirm: confirmBox, fullDate: (d) => FULL.format(d) });
history.connect();


// ── 라우터 ──────────────────────────────────────────────────────────────
const pages = createPages({
  api, history, issues, settingsStore, session, router: () => router, meeting, recording,
  openSettings: (sec) => openSettings(sec),
  importMeeting: (paths) => importMeetingHandle.open(paths),
  toast, confirm: confirmBox, dictations, meetings,
});
const router = createRouter(pages.routes, { api });
router.connect();

const { statsSource, homeSource } = pages.createHome();
const { dictationsSource } = pages.createDictations();
const { meetingsSource } = pages.createMeetings();
const { askStore, askRoot, askWidgetDeps } = pages.createAsk();

// 녹음 파일 가져오기: 파일을 고르면(또는 끌어다 놓으면) 확인 창에서 순서·참석 인원·녹음에 담기지 않은 내용을 받고 가져온다
const importMeetingHandle = mountImportMeeting({ api, toast, historyChanged: () => { loadHistory(); } });

meeting.initialize();
const { vocabulary, vocabWords } = pages.createDictionary();

// ── 통계 ────────────────────────────────────────────────────────────────
// ── ⌘K 빠른 검색 ────────────────────────────────────────────────────────
const palette = mountPalette({
  api, meetings, dictations, toast,
  recording: () => recording.status(),
  openSettings: (sec) => openSettings(sec),
  openMeetingStart: () => recording.openStart(),
  cancelRecording: () => recording.cancel(),
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.open();
  } else if (e.metaKey && e.key === ',') {
    e.preventDefault();
    openSettings();
  }
});

// ── 설정 ────────────────────────────────────────────────────────────────
const settingsUi = mountSettings({
  api, settings: settingsStore, issues, toast, confirm: confirmBox,
  closePalette: () => { if ($('palette').open) $('palette').close(); },
  recordingsChanged: () => { meeting.docs.clear(); loadHistory(); },
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

api.onDictStage(recordingDictStage);
api.onDictResult(recordingDictResult);

window.addEventListener('focus', () => {
  settingsUi.refreshPermissions();
  loadHistory();
});

// ── 시작 ────────────────────────────────────────────────────────────────

// 처음 설정: 끝내기 전까지는 본 화면 대신 온보딩을 보여 준다
const fnListeners = new Set();
const tapListeners = new Set();
api.onOnboardingFn((s) => fnListeners.forEach((fn) => fn(s)));
api.onOnboardingTap(() => tapListeners.forEach((fn) => fn()));
const onboardingCtx = {
  api, toast, setupListeners: settingsUi.setupListeners, fnListeners, tapListeners,
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
router.navigate();
mountReact(askRoot, AskWidget, { store: askStore, deps: askWidgetDeps });
if (info.capability === 'unsupported') toast('이 macOS에서는 상대방 소리를 녹음할 수 없습니다', '회의도 마이크만 녹음합니다.', { ms: 7000 });
if (info.fnWarning) issues.set('fnUsage', { title: 'fn 키가 다른 동작과 겹칩니다', detail: info.fnWarning, sec: 'general', dismiss: true });
await settingsUi.loadDevices();

recording.prepare().catch((err) => toast('오디오 엔진 준비 실패', err.message, { bad: true }));
