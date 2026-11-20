const { app, BrowserWindow, ipcMain, session, desktopCapturer, Tray, Menu, nativeImage, shell, screen, systemPreferences, clipboard, nativeTheme, protocol, dialog, net } = require('electron');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const { WavWriter } = require('../lib/meeting/wav-writer.mjs'); // 녹음 파일 쓰기 (src/meeting, 결정 70)
const dictation = require('./dictation');
const minutes = require('./minutes');
const importAudio = require('../lib/meeting/import-audio.mjs'); // 녹음 파일 가져오기 (src/meeting, 결정 70)
// 용어 설명·흐름도·액션은 src/meeting (TypeScript, 결정 70). LLM 호출·설정은 위의 minutes.js가 이어 준다
const glossary = require('../lib/meeting/glossary.mjs');
const flowMod = require('../lib/meeting/flow.mjs');
const actionsMod = require('../lib/meeting/actions.mjs');
const usageMod = require('./usage');
const askMod = require('./ask');
const compress = require('./compress');
const setup = require('./setup');
// 회의 데이터 읽기는 명령줄 도구(mr)와 같이 쓰는 코어(TypeScript·ESM, npm run build:ts → lib/)로 (결정 43)
const core = require('../lib/core/index.mjs');
// IPC 처리기 중 공유 상태가 적은 구역(기록·질문으로 찾기·토큰·권한·처음 설정·녹음 폴더 바꾸기)은 src/app (TypeScript, 결정 70)
const appIpc = require('../lib/app/index.mjs');

const SELFTEST = process.argv.includes('--selftest');
const TAP_MAX_MS = 300; // 이보다 짧게 눌렀다 떼면 실수로 누른 것으로 보고 버린다
const DEBOUNCE_MS = 500; // 두 번 누르기·짧은 탭 판단 (Wispr Flow DICTATION_DEBOUNCE_DELAY와 같은 값)
const VOICE_RMS = 0.003; // 이 크기 이상이면 말소리로 센다 (-50dBFS, 조용한 방 잡음 -63dBFS보다 13dB 위)
const DICTATION_MAX_MS = 20 * 60 * 1000; // 받아쓰기 한 번의 최대 길이 (Wispr Flow와 같은 20분)
const DEFAULT_RECORDINGS_DIR = path.join(os.homedir(), 'Documents', 'MeetingRecorder');
let RECORDINGS_DIR = DEFAULT_RECORDINGS_DIR; // 설정 › 받아쓰기 › 녹음 폴더에서 바꿀 수 있다
// 받아쓰기는 음성을 남기지 않는다: 임시 폴더에 녹음 → 변환·입력 → 음성 삭제, 데이터만 이 파일에 한 줄씩 쌓는다
let DICTATION_LOG = path.join(RECORDINGS_DIR, 'dictations.jsonl');

// ── 사전·설정 백업: 녹음 폴더의 settings.json에 같이 적어 두어, 녹음 폴더만 옮겨도 이어 쓸 수 있게 한다 (토큰·키는 넣지 않는다)
const PORTABLE_KEYS = ['vocabulary', 'language', 'meetingLanguage', 'enabled', 'cleanup', 'provider', 'minutes', 'diarize', 'meetingSystemAudio'];
const portableFile = () => path.join(RECORDINGS_DIR, 'settings.json');
const vocabList = (v) => (v ?? '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

function writePortableSettings() {
  const s = dictation.getSettings();
  try {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    core.writeJsonAtomic(portableFile(), { ...Object.fromEntries(PORTABLE_KEYS.map((k) => [k, s[k]])), savedAt: new Date() });
  } catch {}
}

// 녹음 폴더에 저장된 설정을 읽어 온다. 앱 설정이 비어 있으면(새 컴퓨터) 그대로 쓰고, 아니면 사전 단어만 합친다
function mergePortableSettings() {
  const saved = readJson(portableFile());
  if (!saved) return false;
  const stored = dictation.storedSettings();
  const fresh = !('vocabulary' in stored) && !('language' in stored);
  const patch = {};
  if (fresh) for (const k of PORTABLE_KEYS) if (saved[k] !== undefined) patch[k] = saved[k];
  const words = [...new Set([...vocabList(stored.vocabulary), ...vocabList(saved.vocabulary)])];
  if (words.join(', ') !== vocabList(stored.vocabulary).join(', ')) patch.vocabulary = words.join(', ');
  if (Object.keys(patch).length) dictation.saveSettings(patch);
  return Object.keys(patch).length > 0;
}

function setRecordingsDir(dir) {
  RECORDINGS_DIR = dir;
  DICTATION_LOG = path.join(dir, 'dictations.jsonl');
  if (recordingsWatch) watchRecordings(); // 앱 실행 중 녹음 폴더를 바꾸면 새 폴더를 지켜본다
}

// ── 시스템 오디오 캡처 경로 (Wispr Flow와 같은 분기) ──────────────────────
// macOS 14.4+ : Core Audio Process Tap / 13~14.3 : ScreenCaptureKit / 그 이하 : 미지원
function systemAudioCapability() {
  if (process.platform === 'win32') return 'wasapi_loopback';
  if (process.platform !== 'darwin') return 'unsupported';
  const [major, minor] = process.getSystemVersion().split('.').map(Number);
  if (major < 13) return 'unsupported';
  if (major > 14 || (major === 14 && minor >= 4)) return 'process_tap';
  return 'screen_capture_kit';
}

const capability = systemAudioCapability();
if (capability === 'process_tap') {
  app.commandLine.appendSwitch('enable-features', 'MacCatapSystemAudioLoopbackCapture,MacLoopbackAudioForScreenShare');
} else if (capability === 'screen_capture_kit') {
  app.commandLine.appendSwitch('enable-features', 'MacSckSystemAudioLoopbackOverride,MacLoopbackAudioForScreenShare');
}

let win;
let overlay;
let tray;
let fnProc;
let recording = null; // { dir, mode, writers: { mic, system }, startedAt, micPeak, pausedMs, pausedAt, speakers }
let nextSpeakers = null; // 창의 시작 시트에서 고른 참석 인원 (다음 회의 녹음에 쓴다)
let transcribing = 0; // 진행 중인 받아쓰기 수
let quitting = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function installDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (capability === 'wasapi_loopback') {
      callback({ audio: 'loopback' });
      return;
    }
    if (capability === 'process_tap') {
      // Wispr Flow와 동일: Core Audio Tap으로 모든 출력 장치의 소리를 받는다
      callback({ audio: { id: process.env.LOOPBACK_ID || 'loopbackAllDevices', name: 'All loopback devices' } });
      return;
    }
    if (capability === 'screen_capture_kit') {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => callback(sources.length ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
      return;
    }
    callback({});
  });
}

// ── fn 키 동작: 받아쓰기 전용 (회의 녹음은 창·독·메뉴바 버튼으로만) ────────────
// 규칙과 상태(fnState 등)는 src/app/fn.mts (결정 70). 여기서는 한 번 만들어 두고, fn-listener 줄·버튼·녹음 저장 쪽에서 일어난 일을 알린다.
// 지금 시각·타이머·창으로 보내기·녹음 상태는 부를 때 읽게 넘긴다
const fnMachine = appIpc.createFnMachine({
  now: () => Date.now(),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (t) => clearTimeout(t),
  debounceMs: DEBOUNCE_MS,
  selftest: SELFTEST,
  sendCommand: (action, mode) => send('rec:cmd', { action, mode }),
  transcribing: () => transcribing,
  recording: () => recording,
  dictationEnabled: () => dictation.getSettings().enabled,
  onboarding: () => dictation.storedSettings().onboarding,
  busyNotice: () => sendOverlay('overlay:stage', { stage: 'busy' }),
  overlayState: () => sendOverlayState(),
  onboardingTap: () => send('onboarding:tap'),
  onboardingFn: (down) => send('onboarding:fn', { down }),
  log: (line) => console.log(line),
});

// 회의 녹음 일시정지: 그동안 들어오는 소리를 파일에 쓰지 않는다 (재개하면 바로 이어서 기록)
function elapsedMs(rec = recording) {
  if (!rec) return 0;
  const now = Date.now();
  return now - rec.startedAt - rec.pausedMs - (rec.pausedAt ? now - rec.pausedAt : 0);
}

function clockInfo() {
  return recording ? { mode: recording.mode, paused: Boolean(recording.pausedAt), elapsedMs: elapsedMs() } : null;
}

function setPaused(on) {
  if (!recording || recording.mode !== 'meeting' || Boolean(recording.pausedAt) === on) return;
  if (on) recording.pausedAt = Date.now();
  else {
    recording.pausedMs += Date.now() - recording.pausedAt;
    recording.pausedAt = null;
  }
  updateTray();
  send('rec:clock', clockInfo());
}

// 녹음 취소: 저장하지 않고 버린다
function uiCancel() {
  fnMachine.uiCancel();
}

async function confirmCancel() {
  if (!recording) return;
  const min = Math.round(elapsedMs() / 60000);
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['녹음 버리기', '계속 녹음'],
    defaultId: 1,
    cancelId: 1,
    message: '회의 녹음을 취소할까요?',
    detail: `지금까지 녹음한 ${min ? `${min}분` : '내용'}이 저장되지 않고 지워집니다.`,
  });
  if (response === 0) uiCancel();
}

function uiToggle(mode) {
  fnMachine.uiToggle(mode);
}

function handleFnLine(line) {
  if (line === 'ready') send('fn:status', { ok: true });
  else if (line === 'error:permission') send('perm:changed'); // 권한 패널이 안내한다
  else if (line === 'down') fnMachine.fnDown();
  else if (line === 'up') fnMachine.fnUp({ chord: false });
  else if (line === 'chord') fnMachine.fnUp({ chord: true });
}

function helperPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'native', name);
}

// before-quit 없이 끝나면(강제 종료·크래시) fn-listener가 고아로 남는다. 종료 때 끄고, 시작할 때 남은 것을 정리한다
process.on('exit', () => fnProc?.kill());
let orphanFnChecked = false;
function killOrphanFnListeners(bin) {
  if (orphanFnChecked) return;
  orphanFnChecked = true;
  try {
    for (const line of execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString().split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (m && m[2] === '1' && m[3].trim() === bin) process.kill(Number(m[1]));
    }
  } catch {}
}

function startFnListener() {
  if (fnProc) return;
  const bin = helperPath('fn-listener');
  killOrphanFnListeners(bin);
  if (!fs.existsSync(bin)) {
    send('fn:status', { ok: false, reason: 'fn-listener 바이너리가 없습니다. npm run build:fn 을 실행하세요.' });
    return;
  }
  fnProc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  fnProc.stdout.on('data', (data) => {
    buf += data.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      handleFnLine(buf.slice(0, idx).trim());
      buf = buf.slice(idx + 1);
    }
  });
  fnProc.on('exit', (code) => {
    fnProc = null;
    if (code !== 2 && !quitting) send('fn:status', { ok: false, reason: `fn 감지기가 종료됨 (code ${code})` });
  });
}

// 셀프테스트: 실제 키 대신 fn 이벤트를 흉내 내서 상태 머신 전체를 검증
function runFnSimulation() {
  const steps = [
    [500, 'down'], [2000, 'up+down'], [2080, 'up'], // 꾹 누르기 1.5초 → 받아쓰기, 떼자마자 다시 누름은 처리 중이라 무시
    [3000, 'down'], [3100, 'up'], // 짧은 탭 → 버림
    [4500, 'down'], [4600, 'up'], [4750, 'down'], [4850, 'up'], // 두 번 탭 → 손을 떼도 계속 받아쓰기
    [6200, 'down'], [6300, 'up'], // 한 번 더 누르면 끝내고 받아쓰기
    [7000, 'down'], [7100, 'up'], [7250, 'down'], [7350, 'up'], [7400, 'down'], [7450, 'up'], // 빠르게 세 번 → 취소
  ];
  for (const [t, line] of steps) setTimeout(() => line.split('+').forEach(handleFnLine), t);
  // 회의는 버튼으로만 시작/정지하고, 녹음 중 fn은 무시돼야 한다
  setTimeout(() => uiToggle('meeting'), 9000);
  setTimeout(() => { handleFnLine('down'); handleFnLine('up'); }, 10500);
  setTimeout(() => uiToggle('meeting'), 12000);
  setTimeout(() => app.quit(), 13500);
}

function fnUsageWarning() {
  // 0: 아무것도 안 함, 1: 입력 소스 변경, 2: 이모지, 3: 받아쓰기
  try {
    const v = execFileSync('defaults', ['read', 'com.apple.HIToolbox', 'AppleFnUsageType']).toString().trim();
    if (v !== '0') return '시스템 설정 › 키보드 › "🌐 키를 누르면"을 "아무것도 안 함"으로 바꾸세요. 지금은 fn을 누를 때 다른 동작도 함께 실행됩니다.';
  } catch {}
  return null;
}

// ── 녹음 파일 저장 ───────────────────────────────────────────────────────
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

ipcMain.handle('rec:start', (_e, { mode, sampleRate, tracks, devices }) => {
  // 받아쓰기 음성은 임시 폴더에만 두고, 처리 후 지운다
  const base = mode === 'memo' ? path.join(app.getPath('temp'), 'meeting-recorder-dictation') : RECORDINGS_DIR;
  const dir = path.join(base, `${timestamp()}_${mode}`);
  fs.mkdirSync(dir, { recursive: true });
  const writers = {};
  for (const t of tracks) writers[t] = new WavWriter(path.join(dir, `${t}.wav`), { sampleRate });
  recording = { dir, mode, writers, sampleRate, devices, startedAt: new Date(), micPeak: 0, voicedMs: 0, app: null, pausedMs: 0, pausedAt: null, speakers: mode === 'meeting' ? nextSpeakers : null };
  if (mode === 'meeting') nextSpeakers = null;
  if (mode === 'memo') {
    // 받아쓰기가 너무 길어지면 19분에 미리 알리고 20분에서 끝내고 입력한다
    const rec = recording;
    setTimeout(() => {
      if (recording === rec) sendOverlay('overlay:stage', { stage: 'limit' });
    }, DICTATION_MAX_MS - 60 * 1000);
    setTimeout(() => {
      if (recording !== rec) return;
      fnMachine.dictationLimitReached();
    }, DICTATION_MAX_MS);
  }
  if (mode === 'memo') {
    // 통계용: 어느 앱에 입력하려고 했는지 (fn을 누른 순간 앞에 있던 앱)
    const rec = recording;
    runPermissionsHelper(['frontapp']).then((out) => {
      try {
        rec.app = JSON.parse(out);
      } catch {}
    });
  }
  updateTray();
  // 셀프테스트: 시스템 소리 트랙에 실제로 소리가 잡히는지 확인용 효과음 재생
  if (SELFTEST && mode === 'meeting') setTimeout(() => spawn('afplay', ['/System/Library/Sounds/Submarine.aiff']), 1000);
  return { dir };
});

ipcMain.on('rec:chunk', (_e, { track, samples }) => {
  const w = recording?.writers[track];
  if (!w || recording.pausedAt) return;
  const pcm = new Float32Array(samples.buffer, samples.byteOffset, samples.length);
  w.append(pcm);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    peak = Math.max(peak, Math.abs(pcm[i]));
    sum += pcm[i] * pcm[i];
  }
  if (track === 'mic') {
    recording.micPeak = Math.max(recording.micPeak, peak);
    // 말소리 크기(-50dBFS 이상)가 들어온 시간. 딸깍 소리 하나로 Whisper가 '감사합니다'를 지어내는 것을 막는다
    if (Math.sqrt(sum / Math.max(1, pcm.length)) > VOICE_RMS) recording.voicedMs += (pcm.length / recording.sampleRate) * 1000;
  }
  // 플로팅 독의 레벨 막대 (100ms마다 한 칸)
  const db = 10 * Math.log10(sum / Math.max(1, pcm.length) + 1e-12);
  sendOverlay('overlay:level', { track, db });
});

ipcMain.handle('rec:stop', (_e, { discard = false } = {}) => {
  fnMachine.stopReceived({ discard }); // 받아쓰기가 아니거나 버리면 '멈추는 중'을 푼다
  if (!recording) return null;
  const { dir, mode, writers, sampleRate, devices, startedAt, micPeak, voicedMs, speakers } = recording;
  const rec = recording;
  if (discard) {
    for (const w of Object.values(writers)) w.close();
    fs.rmSync(dir, { recursive: true, force: true });
    recording = null;
    updateTray();
    if (SELFTEST) console.log('SELFTEST discarded', path.basename(dir));
    return null;
  }
  const files = {};
  for (const [track, w] of Object.entries(writers)) {
    w.close();
    files[track] = { file: path.basename(w.filePath), durationSec: Number(w.durationSec.toFixed(2)) };
  }
  const meta = { mode, sampleRate, bitDepth: 16, startedAt, endedAt: new Date(), devices, files, ...(speakers ? { speakers } : {}) };
  // meta.json이 있어야 회의 목록에 나온다. 반쯤 쓰이면 녹음은 남아도 앱이 회의로 알아보지 못한다
  core.writeJsonAtomic(path.join(dir, 'meta.json'), meta);
  recording = null;
  updateTray();
  if (SELFTEST) console.log('SELFTEST saved', path.basename(dir), JSON.stringify(files));
  if (mode === 'memo') runDictation({ dir, peak: micPeak, voicedMs, startedAt, durationSec: files.mic?.durationSec ?? 0, rec });
  if (mode === 'meeting' && dictation.getSettings().minutes) runMinutes(dir, speakers ?? null);
  return { dir, ...meta };
});

// 받아쓰기 한 건의 데이터 (나중에 통계·분석용). 음성은 남기지 않는다.
function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function logDictation(entry) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  fs.appendFileSync(DICTATION_LOG, `${JSON.stringify(entry)}\n`);
}

async function runDictation({ dir, peak, voicedMs, startedAt, durationSec, rec }) {
  transcribing++;
  fnMachine.dictationHandedOff();
  sendOverlayState();
  const onStage = (stage) => {
    sendOverlay('overlay:stage', stage);
    send('dict:stage', stage);
  };
  // 단계는 본체가 차례대로 알린다. 예전엔 화면이 녹음 저장 답을 받은 뒤 스스로 '인식'으로 바꿨는데, 말소리가 없어(silent) 결과가 저장 답보다
  // 먼저 도착하면 화면이 결과로 '끝'을 그린 뒤 다시 '인식'으로 돌아가 멈춰 있었다 (2026-11-07)
  send('dict:stage', { stage: 'transcribe' });
  let result;
  try {
    result = await dictation.dictate(path.join(dir, 'mic.wav'), { helperBin: helperPath('permissions'), peak, voicedMs, onStage });
  } catch (err) {
    result = { status: 'error', error: err.message };
  }
  transcribing--;
  sendOverlayState();
  const id = path.basename(dir);
  const settings = dictation.getSettings();
  const final = result.text ?? result.raw ?? null;
  logDictation({
    id,
    startedAt,
    durationSec,
    voicedSec: Number((voicedMs / 1000).toFixed(2)),
    status: result.status, // pasted | no-permission | failed | silent | empty | error
    app: rec.app?.name || null,
    bundleId: rec.app?.bundleId || null,
    language: result.language ?? settings.language, // 실제로 받아쓴 언어
    languageSetting: settings.language, // 고른 언어 (auto면 자동)
    raw: result.raw ?? null,
    text: result.text ?? null,
    chars: final?.length ?? 0,
    words: countWords(final),
    rawWords: countWords(result.raw),
    wpm: final && durationSec > 0 ? Math.round((countWords(final) / durationSec) * 60) : null,
    cleaned: Boolean(result.cleaned),
    cleanupProvider: result.cleanupProvider ?? null,
    cleanupChunks: result.cleanupChunks ?? 0,
    cleanupError: result.cleanupError ?? null,
    error: result.error ?? null,
    timing: result.timing ?? null,
  });
  // 검증(변환)이 끝났으니 음성은 지운다
  fs.rmSync(dir, { recursive: true, force: true });
  if (result.text) lastTranscript = result.text;
  if (SELFTEST) console.log('SELFTEST dictation', JSON.stringify(result));
  sendOverlay('overlay:stage', { stage: 'done', status: result.status, text: result.text ?? null, error: result.error ?? null });
  send('dict:result', { id, ...result });
  updateTray();
}

// ── 회의록 ──────────────────────────────────────────────────────────────
const activeMinutes = new Set(); // 지금 이 실행에서 만들고 있는 회의 폴더

const MIN_MEETING_SEC = 10; // 이보다 짧은 회의 녹음은 회의록을 만들지 않는다 (시험·실수 녹음)

function runMinutes(dir, speakers = null, { resume = false } = {}) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const durationSec = Math.max(0, ...Object.values(meta?.files ?? {}).map((f) => f.durationSec ?? 0));
  if (durationSec < MIN_MEETING_SEC) {
    core.writeJsonAtomic(path.join(dir, 'minutes.json'), { status: 'short', durationSec, updatedAt: new Date() });
    send('minutes:status', { id: path.basename(dir), status: 'short' });
    sendOverlay('overlay:stage', { stage: 'done', status: 'meeting-short' });
    return Promise.resolve();
  }
  activeMinutes.add(dir);
  waitingOnline.delete(dir);
  return minutes.makeMinutes(dir, {
    speakers,
    resume,
    onStage: (s) => {
      if (s.status === 'error' && s.offline) waitForOnline(dir);
      send('minutes:status', { id: path.basename(dir), ...s });
      if (s.status === 'queued') sendOverlay('overlay:stage', { stage: 'done', status: 'meeting-saved' });
      if (s.status === 'done') {
        const rv = core.reviewSummary(dir);
        sendOverlay('overlay:stage', { stage: 'done', status: 'minutes-done', text: `${s.title ?? ''}${rv?.open ? ` · 확인 필요 ${rv.open}개` : ''}` });
      }
      if (s.status === 'error') sendOverlay('overlay:stage', { stage: 'done', status: 'minutes-error', error: s.error });
      if (['done', 'error', 'empty'].includes(s.status)) activeMinutes.delete(dir);
    },
  });
}

// 인터넷이 끊겨 회의록을 못 쓴 회의는 연결이 돌아오면 저장된 녹취로 이어서 쓴다
const waitingOnline = new Set();
let onlineTimer = null;
function waitForOnline(dir) {
  waitingOnline.add(dir);
  onlineTimer ??= setInterval(() => {
    if (!net.isOnline()) return;
    clearInterval(onlineTimer);
    onlineTimer = null;
    for (const d of [...waitingOnline]) if (!activeMinutes.has(d) && minutes.canResume(d)) runMinutes(d, null, { resume: true });
    waitingOnline.clear();
  }, 15000);
}

// 렌더러가 넘긴 경로는 녹음 폴더 안의 것만 받는다
function recordingDir(dir) {
  const resolved = path.resolve(dir);
  if (path.dirname(resolved) !== RECORDINGS_DIR) throw new Error('녹음 폴더가 아닙니다');
  return resolved;
}

ipcMain.handle('minutes:make', (_e, dir, speakers) => {
  runMinutes(recordingDir(dir), Number(speakers) || null);
});
// 다른 앱에서 녹음한 파일을 회의로 가져온다 (여러 개면 이름 순서대로 이어 붙임)
// meeting:pick — 파일 고르기 창(또는 끌어다 놓은 파일)을 확인 창에 보여 줄 목록으로. meeting:import — 실제로 가져와 회의록 시작
ipcMain.handle('meeting:pick', async (_e, paths = null) => {
  let files = paths;
  if (!files?.length) {
    const picked = await dialog.showOpenDialog(win, {
      title: '녹음 파일 가져오기',
      buttonLabel: '고르기',
      message: '여러 파일을 고르면 이름 순서대로 이어 붙여 회의 하나로 만듭니다',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '녹음 파일', extensions: importAudio.EXTS.map((e) => e.slice(1)) }],
    });
    if (picked.canceled || !picked.filePaths.length) return null;
    files = picked.filePaths;
  }
  // 확인 창: 파일 목록(순서·길이)과 짐작한 녹음 시각
  const [list, guess] = await Promise.all([importAudio.describe(files), importAudio.guessStart(files)]);
  return { files: list, guess: { at: guess.at.toISOString(), source: guess.source } };
});
ipcMain.handle('meeting:import', async (_e, paths, { notes = '', speakers = null, startedAt = null } = {}) => {
  if (!paths?.length) throw new Error('가져올 파일이 없습니다');
  const n = Number(speakers) || null;
  const dir = await importAudio.importAudio(paths, RECORDINGS_DIR, { notes: String(notes ?? ''), speakers: n, startedAt: typeof startedAt === 'string' ? startedAt : null });
  runMinutes(dir, n);
  return { id: path.basename(dir), count: paths.length };
});
ipcMain.handle('minutes:resume', (_e, dir) => {
  const d = recordingDir(dir);
  if (activeMinutes.has(d)) return;
  if (!minutes.canResume(d)) throw new Error('이어서 쓸 녹취가 없습니다. 녹취부터 다시 만들어 주세요');
  runMinutes(d, null, { resume: true });
});
// 회의 녹음 압축 (확인을 마친 회의, 사용자가 고를 때만): WAV → AAC 96kbps. 녹음 중·회의록을 만드는 중인 회의는 막는다
const compressing = new Set();
ipcMain.handle('meeting:compress', async (_e, dir) => {
  const d = recordingDir(dir);
  if (recording?.dir === d || activeMinutes.has(d)) throw new Error('녹음 중이거나 회의록을 만드는 중에는 압축할 수 없습니다');
  if (compressing.has(d)) throw new Error('이미 압축하고 있습니다');
  compressing.add(d);
  try {
    return await compress.compressMeeting(d);
  } finally {
    compressing.delete(d);
  }
});
ipcMain.handle('meeting:compressDecline', (_e, dir, declined = true) => compress.declineCompress(recordingDir(dir), declined));
ipcMain.handle('speaker:rename', (_e, dir, from, to) => minutes.renameSpeaker(recordingDir(dir), from, to));
ipcMain.handle('minutes:read', (_e, dir) => {
  const d = recordingDir(dir);
  const read = (f) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8') : null);
  const names = readJson(path.join(d, 'meta.json'))?.speakerNames;
  const review = minutes.readReview(d);
  const rawTranscript = read('transcript.txt') ?? '';
  for (const it of review?.items ?? []) {
    it.at = core.stampFor(it, rawTranscript); // 예전에 만든 항목도 시각이 비어 있으면 녹취에서 찾아 보여 준다 (파일은 그대로)
    it.note = minutes.nameSpeakers(it.note, names, { prose: true });
    for (const c of it.chat ?? []) c.assistant = minutes.nameSpeakers(c.assistant, names, { prose: true });
  }
  return {
    minutes: minutes.nameSpeakers(read('minutes.md'), names, { prose: true }),
    transcript: minutes.nameSpeakers(read('transcript.txt'), names),
    scriptClean: minutes.nameSpeakers(read('script-clean.txt'), names),
    review,
    glossary: glossaryWithNames(d, names),
    speech: minutes.speakerTurns(d),
    flow: flowWithNames(d, names),
    actions: core.readActionsNamed(d, names),
  };
});
ipcMain.handle('actions:make', (_e, dir) => actionsMod.makeActions(recordingDir(dir)));
ipcMain.handle('actions:toggle', (_e, dir, id, done) => actionsMod.toggleAction(recordingDir(dir), id, done));
// 흐름도 글의 '화자 N'도 바꾼 이름으로 보여 준다 (파일은 그대로)
function flowWithNames(d, names) {
  const data = flowMod.readFlow(d);
  const fix = (t) => minutes.nameSpeakers(t, names, { prose: true });
  for (const f of data?.flows ?? []) {
    Object.assign(f, { title: fix(f.title), summary: fix(f.summary) });
    for (const st of f.steps ?? []) Object.assign(st, { title: fix(st.title), detail: fix(st.detail) });
    for (const n of [...(f.notes ?? []), ...(f.annotations ?? [])]) n.text = fix(n.text);
    for (const l of f.lanes ?? []) l.name = fix(l.name);
  }
  const h = data?.handoff;
  if (h) {
    Object.assign(h, { from: fix(h.from), to: fix(h.to) });
    for (const x of [...h.give, ...h.todo, ...h.decided]) Object.assign(x, { text: fix(x.text), owner: fix(x.owner) });
  }
  return data;
}
ipcMain.handle('flow:make', (_e, dir, focus) => flowMod.makeFlows(recordingDir(dir), { focus }));
ipcMain.handle('flow:remake', (_e, dir, id, instruction) => flowMod.remakeFlow(recordingDir(dir), id, instruction));
ipcMain.handle('flow:remove', (_e, dir, id) => flowMod.removeFlow(recordingDir(dir), id));
// 흐름도를 SVG 파일로: 저장할 곳은 사용자가 고른다 (기본은 다운로드 폴더, 이름은 흐름도 제목). 고르지 않으면 null
ipcMain.handle('flow:saveSvg', async (_e, name, svg) => {
  if (typeof svg !== 'string' || !svg.startsWith('<?xml') || svg.length > 20 * 1024 * 1024) throw new Error('저장할 그림이 올바르지 않습니다');
  const safe = String(name ?? '흐름도').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || '흐름도';
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), `${safe}.svg`), filters: [{ name: 'SVG 그림', extensions: ['svg'] }] });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, svg);
  return filePath;
});
ipcMain.handle('flow:chat', (_e, dir, id, messages) => flowMod.chatFlow(recordingDir(dir), id, messages));
ipcMain.handle('flow:apply', (_e, dir, id, revision) => flowMod.applyRevision(recordingDir(dir), id, revision));
function glossaryWithNames(d, names) {
  const g = glossary.readGlossary(d);
  for (const t of g?.terms ?? []) t.note = minutes.nameSpeakers(t.note, names, { prose: true });
  return g;
}
ipcMain.handle('glossary:make', (_e, dir) => glossary.makeGlossary(recordingDir(dir)));
ipcMain.handle('glossary:explain', (_e, dir, term) => glossary.explainTerm(recordingDir(dir), term));
ipcMain.handle('glossary:update', (_e, dir, id, patch) => glossary.updateTerm(recordingDir(dir), id, patch));
// 파일이 바뀌면 화면을 다시 그린다: 열려 있는 회의 폴더(회의록·녹취·정리본·확인 필요·용어·화자 이름)와 녹음 폴더(회의가 생기거나 사라짐).
// 앱 안 작업은 원래 바로 다시 그리지만, 앱 밖에서 고치거나 다른 경로로 바뀐 경우에도 다시 열 필요가 없게 한다
const WATCHED = new Set(['minutes.md', 'transcript.txt', 'script-clean.txt', 'review.json', 'glossary.json', 'flow.json', 'actions.json', 'meta.json']);
let meetingWatch = null;
let recordingsWatch = null;
function debounced(fn, ms = 400) {
  let t = null;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
function watchRecordings() {
  recordingsWatch?.close();
  try {
    const changed = debounced(() => send('recordings:changed', {}));
    recordingsWatch = fs.watch(RECORDINGS_DIR, (_ev, name) => name && /^\d{4}-\d{2}-\d{2}_/.test(String(name)) && changed());
  } catch {
    recordingsWatch = null;
  }
}
ipcMain.handle('meeting:watch', (_e, dir) => {
  meetingWatch?.close();
  meetingWatch = null;
  if (!dir) return;
  const d = recordingDir(dir);
  const changed = debounced(() => send('meeting:changed', { id: path.basename(d) }));
  try {
    meetingWatch = fs.watch(d, (_ev, name) => WATCHED.has(String(name)) && changed());
  } catch {}
});
ipcMain.handle('review:make', (_e, dir) => minutes.makeReview(recordingDir(dir)));
ipcMain.handle('review:add', (_e, dir, request) => minutes.addReview(recordingDir(dir), request));
// 확인 필요에서 오인식 단어·이름을 고치면 고친 말을 사전에 넣는다 → 다음 녹음부터 Whisper가 그 말을 더 잘 알아듣는다.
// 짧은 낱말만 (문장·설명은 넣지 않음). 사전 화면에서 언제든 지울 수 있다
const VOCAB_KINDS = new Set(['word', 'name']);
function addCorrectionsToVocab(review, fixes) {
  const words = vocabList(dictation.getSettings().vocabulary);
  const have = new Set(words.map((w) => w.toLowerCase()));
  const added = [];
  for (const f of fixes) {
    const it = review.items.find((x) => x.id === f.id);
    const w = it?.status === 'applied' && VOCAB_KINDS.has(it.kind) ? String(it.applied ?? '').trim() : '';
    if (!w || w.length > 30 || w.split(/\s+/).length > 4 || /[.,!?。\n]/.test(w) || have.has(w.toLowerCase())) continue;
    have.add(w.toLowerCase());
    added.push(w);
  }
  if (added.length) {
    dictation.saveSettings({ vocabulary: [...words, ...added].join(', ') });
    writePortableSettings();
  }
  return added;
}
ipcMain.handle('review:apply', (_e, dir, fixes) => {
  const d = recordingDir(dir);
  const review = minutes.applyReview(d, fixes);
  const addedWords = addCorrectionsToVocab(review, fixes);
  const ids = review.items.filter((it) => fixes.some((f) => f.id === it.id) && addedWords.includes(String(it.applied ?? '').trim())).map((it) => it.id);
  if (ids.length) minutes.markReviewItems(d, ids, { vocabAdded: true });
  return { ...review, addedWords };
});
// 확인 마치기 전 되돌리기: 사전에 자동으로 넣었던 단어도 뺀다
ipcMain.handle('review:revert', (_e, dir, id) => {
  const d = recordingDir(dir);
  const before = minutes.readReview(d)?.items.find((it) => it.id === id);
  const review = minutes.revertReview(d, id);
  const word = before?.vocabAdded ? String(before.applied ?? '').trim() : '';
  if (word) {
    const words = vocabList(dictation.getSettings().vocabulary);
    const next = words.filter((w) => w.toLowerCase() !== word.toLowerCase());
    if (next.length !== words.length) {
      dictation.saveSettings({ vocabulary: next.join(', ') });
      writePortableSettings();
    }
    minutes.markReviewItems(d, [id], { vocabAdded: false });
  }
  return { ...review, removedWord: word || null };
});
ipcMain.handle('review:status', (_e, dir, ids, status) => minutes.setReviewStatus(recordingDir(dir), ids, status === 'open' ? 'open' : 'kept'));
ipcMain.handle('review:finalize', (_e, dir) => minutes.finalizeReview(recordingDir(dir)));
ipcMain.handle('review:reopen', (_e, dir) => minutes.reopenReview(recordingDir(dir)));
ipcMain.handle('review:redo', (_e, dir, id, start, end) => minutes.retranscribeRange(recordingDir(dir), id, start, end));
ipcMain.handle('review:redoApply', (_e, dir, id) => minutes.applyRetranscribe(recordingDir(dir), id));
ipcMain.handle('review:chat', (_e, dir, ids, messages) => minutes.chatReview(recordingDir(dir), ids, messages));
// 회의록의 할 일 체크: minutes.md에서 n번째 "- [ ]" 줄을 뒤집는다
ipcMain.handle('minutes:todo', (_e, dir, index, done) => {
  const file = path.join(recordingDir(dir), 'minutes.md');
  let n = -1;
  const md = fs.readFileSync(file, 'utf8').replace(/^(\s*- \[)( |x)(\])/gim, (all, a, mark, b) => (++n === index ? `${a}${done ? 'x' : ' '}${b}` : all));
  core.writeFileAtomic(file, md);
  return md;
});
// 회의 삭제는 휴지통으로 옮긴다 (Finder에서 되살릴 수 있다)
ipcMain.handle('meeting:trash', async (_e, dir) => {
  const d = recordingDir(dir);
  if (activeMinutes.has(d)) throw new Error('회의록을 만드는 중에는 지울 수 없습니다');
  if (recording?.dir === d) throw new Error('녹음 중인 폴더는 지울 수 없습니다');
  if (!fs.statSync(d).isDirectory()) throw new Error('회의 폴더가 아닙니다'); // 녹음 폴더 안의 설정·기록 파일은 지우지 않는다
  await shell.trashItem(d);
});
ipcMain.handle('dict:delete', (_e, id) => {
  const lines = fs.readFileSync(DICTATION_LOG, 'utf8').split('\n').filter(Boolean);
  // 기록 전체를 다시 쓰므로 중간에 끊기면 받아쓰기 기록을 통째로 잃는다 → 원자적으로
  core.writeFileAtomic(DICTATION_LOG, lines.filter((l) => !l.includes(`"id":${JSON.stringify(id)}`)).map((l) => `${l}\n`).join(''));
});
ipcMain.handle('script:clean', async (_e, dir) => {
  const r = await minutes.makeCleanScript(recordingDir(dir));
  return { failed: r.failed, chunks: r.chunks };
});

// ── 기록 (녹음 폴더를 읽어 창에 보여 준다) ─────────────────────────────────
let lastTranscript = null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// 받아쓰기 기록·회의 목록 읽기(읽어 둔 것 포함)와 history:list·recordings:stray·recordings:access·dict:page·dict:stats는 src/app/history.mts.
// 녹음 폴더·받아쓰기 기록 경로·녹음 중인 것은 부를 때 읽게 getter로 넘긴다. 목록 둘은 메뉴바(pasteLast)와 질문으로 찾기가 쓴다
const { listFolders, listHistory } = appIpc.registerHistory(ipcMain, {
  recordingsDir: () => RECORDINGS_DIR,
  dictationLog: () => DICTATION_LOG,
  recording: () => recording,
  activeMinutes,
  waitingOnline,
  waitForOnline,
  readJson,
  compress,
});
ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(text));
ipcMain.handle('dict:repaste', async (_e, text) => {
  win.hide();
  if (process.platform === 'darwin') app.hide(); // 직전에 쓰던 앱이 다시 앞으로 온다
  await new Promise((r) => setTimeout(r, 350));
  const status = await dictation.paste(text, helperPath('permissions'));
  showOverlay();
  return status;
});
ipcMain.handle('dict:providers', (_e, opts) => dictation.cleanupProviders(opts));
ipcMain.handle('usage:get', (_e, opts) => usageMod.usage(opts));

// ── 질문으로 회의 찾기 (src/ask.js, 결정 51): 메인 프로세스에서 돌아 화면을 옮기거나 창을 닫아도 이어진다 ──
// 처리기와 엔진에 넘길 회의 목록(askMeetings)은 src/app/ask.mts. 엔진은 init()에서 켠다
const { askMeetings } = appIpc.registerAsk(ipcMain, { ask: askMod, listFolders });

// ── 연결 설정 창: 토큰·키 저장, 삭제, 확인 ─────────────────────────────────
// 처리기(tokens:status·save·clear·verify, app:openExternal)와 열어도 되는 링크 목록은 src/app/tokens.mts
appIpc.registerTokens(ipcMain, { dictation, shell, anthropic: () => require('@anthropic-ai/sdk').default });

function pasteLast() {
  const text = lastTranscript ?? listHistory(50).find((r) => r.transcript?.text || r.transcript?.raw)?.transcript;
  const value = typeof text === 'string' ? text : text?.text ?? text?.raw;
  if (value) dictation.paste(value, helperPath('permissions'));
}

// ── 받아쓰기 설정·음성 인식 설치·앱 정보 ───────────────────────────────────
ipcMain.handle('dict:settings', () => ({ ...dictation.getSettings(), engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() }));
ipcMain.handle('dict:saveSettings', (_e, patch) => {
  const settings = saveDictSettings(patch);
  if (settings.enabled) dictation.startServer();
  return { ...settings, engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() };
});
ipcMain.handle('setup:status', () => setup.status());
ipcMain.handle('setup:install', (_e, id) => {
  setup.install(id); // 오래 걸리므로 기다리지 않고, 진행 상황은 setup:status로 보낸다
});
ipcMain.handle('setup:remove', (_e, id) => setup.remove(id));
ipcMain.handle('dict:download', () => dictation.downloadModel().catch((err) => send('dict:engine', { state: 'error', error: err.message })));

ipcMain.handle('app:info', async () => ({
  capability,
  fnWarning: fnUsageWarning(),
  micAccess: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted',
  recordingsDir: RECORDINGS_DIR,
  defaultRecordingsDir: DEFAULT_RECORDINGS_DIR,
  selftest: SELFTEST,
}));

// ── 권한 확인 / 요청 ─────────────────────────────────────────────────────
// 처리기(perm:status·fnKey·openKeyboard·request·openSettings)와 시스템 설정 창 열기는 src/app/permissions.mts.
// 권한 상태 읽기와 권한 도우미는 녹음 시작(rec:start)·창 띄우기(init)도 써서 여기 둔다
function runPermissionsHelper(args) {
  return new Promise((resolve) => {
    execFile(helperPath('permissions'), args, { timeout: 130000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

async function permissionStatus() {
  const native = JSON.parse((await runPermissionsHelper(['status'])) ?? '{}');
  const status = {
    microphone: systemPreferences.getMediaAccessStatus('microphone'), // granted | denied | not-determined | restricted
    inputMonitoring: native.inputMonitoring ?? 'unknown',
    systemAudio: capability === 'unsupported' ? 'unsupported' : native.systemAudio ?? 'unknown',
    accessibility: native.accessibility ?? 'unknown',
  };
  // 입력 모니터링이 방금 허용됐으면 앱 재시작 없이 fn 감지를 시작
  if (status.inputMonitoring === 'granted' && !SELFTEST) startFnListener();
  return status;
}

appIpc.registerPermissions(ipcMain, { permissionStatus, runPermissionsHelper, fnUsageWarning, systemPreferences, shell });

// ── 처음 설정(온보딩): 어디까지 했는지 저장해 두고, 끝나면 본 화면으로 ─────────
// 처리기(onboarding:get·set·fnTest, app:focus)는 src/app/onboarding.mts. fn 키 확인 단계 표시(fnTestMode)는 fn 상태 머신(src/app/fn.mts)이 갖는다
appIpc.registerOnboarding(ipcMain, { dictation, setFnTestMode: (on) => fnMachine.setFnTestMode(on), win: () => win, app });

ipcMain.on('app:reveal', (_e, p) => shell.showItemInFolder(p));
// ── 녹음 폴더 바꾸기: 고른 폴더로 기존 녹음을 옮기거나, 옮기지 않고 새 폴더만 쓴다 ──
// 처리기(recordings:choose·reset, app:openRecordings)와 옮기기(moveEntry)는 src/app/recordings.mts.
// 녹음 폴더·녹음 중인지·창은 부를 때 읽게 getter로, 폴더 바꾸기·설정 백업·메뉴바 갱신은 여기 함수를 넘긴다
appIpc.registerRecordingsFolder(ipcMain, {
  recordingsDir: () => RECORDINGS_DIR,
  defaultRecordingsDir: DEFAULT_RECORDINGS_DIR,
  setRecordingsDir,
  recording: () => recording,
  activeMinutes,
  mergePortableSettings,
  writePortableSettings,
  updateTray,
  win: () => win,
  dialog,
  shell,
  dictation,
});

// ── 녹음 버튼·참석 인원·화면 알림 (창에서) ─────────────────────────────────
ipcMain.on('rec:toggle', (_e, mode) => uiToggle(mode));
ipcMain.on('rec:pause', (_e, on) => setPaused(Boolean(on)));
ipcMain.on('rec:cancel', () => uiCancel());
// 참석 인원: 녹음 전에는 다음 회의에, 녹음 중이면 지금 회의에 적용한다 (null = 자동)
ipcMain.on('rec:speakers', (_e, n) => {
  const v = Number(n) || null;
  if (recording?.mode === 'meeting') recording.speakers = v;
  else nextSpeakers = v;
});
ipcMain.on('rec:failed', () => fnMachine.recordingFailed());
ipcMain.on('app:log', (_e, msg) => {
  if (SELFTEST) console.log('SELFTEST alert', msg);
});

// ── 메뉴바 (창을 닫아도 앱은 여기서 계속 실행된다) ─────────────────────────
let trayTimer;

// 플로팅 독은 앱이 켜져 있는 동안 창을 열든 닫든 항상 보인다
function showWindow() {
  win.show();
  win.focus();
}

function hideWindow() {
  win.hide(); // Dock 아이콘은 남겨 둔다 (클릭하면 창 열기, 우클릭 › 종료)
  showOverlay();
}

// ── 플로팅 독 (Wispr Flow처럼 화면 왼쪽 가장자리에 붙는 작은 알약) ───────────
const OVERLAY_SIZE = { width: 320, height: 200 }; // 독(받아쓰기·회의·기록·언어 버튼, 펼치면 약 165px) + 오른쪽으로 펼쳐지는 진행 띠

function createOverlay() {
  overlay = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false, // 클릭해도 지금 쓰던 앱의 포커스를 빼앗지 않는다
    // macOS: 앱을 깨우지 않는 패널(NSPanel). 일반 창이면 막대를 마우스로 누를 때 앱 전체가 활성화되며 메인 창까지 올라온다
    // (fn으로는 안 올라오고 마우스로 누를 때만 그랬다). Wispr Flow의 막대("Flow Status Indicator")도 type: 'panel'
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    acceptFirstMouse: true, // 다른 앱을 쓰던 중 첫 클릭도 버튼으로 받는다
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'overlay', 'preload.js') },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  // skipTransformProcessType: 이게 없으면 macOS에서 앱이 UIElement로 바뀌어 Dock 아이콘이 사라진다
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'overlay', 'index.html'));
  overlay.webContents.on('did-finish-load', sendOverlayState);
  screen.on('display-metrics-changed', positionOverlay);
  screen.on('display-removed', positionOverlay);
}

function positionOverlay() {
  if (!overlay) return;
  const { workArea } = screen.getPrimaryDisplay();
  overlay.setPosition(workArea.x, Math.round(workArea.y + (workArea.height - OVERLAY_SIZE.height) / 2));
}

function showOverlay() {
  positionOverlay();
  overlay.showInactive();
}

function sendOverlay(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}

function sendOverlayState() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('overlay:state', { recording: recording?.mode ?? null, transcribing: transcribing > 0, clock: clockInfo(), handsfree: recording?.mode === 'memo' && fnMachine.state() === 'handsfree', language: dictation.getSettings().language });
  }
}

ipcMain.on('overlay:interactive', (_e, on) => overlay?.setIgnoreMouseEvents(!on, { forward: true }));
// 받아쓰기 언어 바꾸기 (떠 있는 막대의 언어 버튼): 한국어 → English → 日本語 → 자동 → 한국어
const LANG_CYCLE = ['ko', 'en', 'ja', 'auto'];
function saveDictSettings(patch) {
  const settings = dictation.saveSettings(patch);
  if (PORTABLE_KEYS.some((k) => k in patch)) writePortableSettings();
  if ('language' in patch) sendOverlayState(); // 막대의 언어 표시도
  return settings;
}
ipcMain.on('overlay:action', (_e, name) => {
  if (name === 'open') showWindow();
  else if (name === 'lang-next') {
    const now = dictation.getSettings().language;
    const settings = saveDictSettings({ language: LANG_CYCLE[(LANG_CYCLE.indexOf(now) + 1) % LANG_CYCLE.length] });
    send('dict:settingsChanged', { ...settings, engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() }); // 메인 창의 왼쪽 아래·설정도
  } else uiToggle(name);
});

function updateTray() {
  clearInterval(trayTimer);
  sendOverlayState();
  const menu = recording?.mode === 'meeting'
    ? [
        { label: recording.pausedAt ? '녹음 재개' : '일시정지', click: () => setPaused(!recording?.pausedAt) },
        { label: '종료하고 저장', click: () => uiToggle('meeting') },
        { label: '녹음 취소 (버리기)…', click: confirmCancel },
      ]
    : recording
    ? [{ label: '받아쓰기 정지', click: () => uiToggle(recording?.mode) }]
    : [
        { label: '받아쓰기 시작 (fn 꾹 누르기)', click: () => uiToggle('memo') },
        { label: '마지막 받아쓰기 붙여넣기', click: pasteLast },
        { label: '회의 녹음 시작', click: () => uiToggle('meeting') },
      ];
  tray.setContextMenu(Menu.buildFromTemplate([
    ...menu,
    { type: 'separator' },
    { label: '창 열기', click: showWindow },
    { label: '녹음 폴더 열기', click: () => shell.openPath(RECORDINGS_DIR) },
    {
      label: '로그인 시 자동 실행',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.isPackaged && app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: '종료', accelerator: 'Command+Q', click: () => app.quit() },
  ]));

  if (!recording) {
    tray.setTitle('🎙');
    return;
  }
  const label = recording.mode === 'meeting' ? '회의' : '메모';
  const tick = () => {
    const s = Math.floor(elapsedMs() / 1000);
    tray.setTitle(`${recording.pausedAt ? '❚❚' : '●'} ${label} ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
  };
  tick();
  trayTimer = setInterval(() => recording && tick(), 1000);
}

// 회의 녹음 재생용: rec://m/<회의 폴더 이름>/<파일>. 2시간 WAV(수백 MB)도 원하는 곳부터 재생되게 Range 요청을 받는다
protocol.registerSchemesAsPrivileged([{ scheme: 'rec', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

function serveRecording(request) {
  const [, folder = '', name = ''] = new URL(request.url).pathname.split('/');
  const file = path.resolve(RECORDINGS_DIR, decodeURIComponent(folder), decodeURIComponent(name));
  if (path.dirname(path.dirname(file)) !== RECORDINGS_DIR || !/\.(wav|m4a)$/i.test(file) || !fs.existsSync(file)) {
    return new Response('not found', { status: 404 });
  }
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  const headers = { 'Content-Type': /\.m4a$/i.test(file) ? 'audio/mp4' : 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: range ? 206 : 200, headers });
}

if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && showWindow());
  app.whenReady().then(init);
}

async function init() {
  protocol.handle('rec', serveRecording);
  // 개발 모드에서도 Dock에 앱 아이콘을 쓴다 (설치본은 build/icon.icns가 앱에 들어간다)
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  const saved = dictation.getSettings().recordingsDir;
  if (saved && fs.existsSync(saved)) setRecordingsDir(saved); // 지정한 폴더가 사라졌으면(외장 디스크 분리 등) 기본 폴더를 쓴다
  // 셀프테스트는 실제 녹음 폴더·받아쓰기 기록에 쓰지 않는다 (예전에는 끝나고 손으로 지워야 했다)
  if (SELFTEST) {
    setRecordingsDir(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-selftest-')));
    console.log('SELFTEST recordings', RECORDINGS_DIR);
  }
  mergePortableSettings();
  writePortableSettings();
  askMod.init({ getMeetings: askMeetings, onChange: (job) => send('ask:update', job) }); // 질문으로 찾기: 회의 목록과 진행 소식을 화면에
  // 권한 대화상자를 기다리느라 fn 감지·독·로그인 항목 설정이 멈추지 않게 await하지 않는다
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone');
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  watchRecordings();

  // 패키징된 앱은 처음 실행할 때 로그인 항목에 등록
  const FIRST_RUN_FLAG = path.join(app.getPath('userData'), '.login-item-configured');
  if (app.isPackaged && !fs.existsSync(FIRST_RUN_FLAG)) {
    app.setLoginItemSettings({ openAtLogin: true });
    fs.writeFileSync(FIRST_RUN_FLAG, '');
  }
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;

  installDisplayMediaHandler();
  dictation.init({ onEngineStatus: (status) => send('dict:engine', status) });
  setup.init({ onStatus: (list) => send('setup:status', list) });

  createOverlay();
  if (!SELFTEST) overlay.once('ready-to-show', showOverlay);
  tray = new Tray(nativeImage.createEmpty());
  updateTray();

  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false, // 렌더러가 보여 줄 화면(처음 설정 또는 본 화면)을 정한 뒤 app:ready에서 띄운다
    title: 'Meeting Recorder',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111214' : '#eceef1',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // 창이 숨겨져도 녹음이 끊기지 않게
    },
  });
  if (openedAtLogin) hideWindow();
  let shown = false;
  const showOnce = () => {
    if (shown || openedAtLogin || SELFTEST) return;
    shown = true;
    win.show();
  };
  ipcMain.once('app:ready', showOnce);
  setTimeout(showOnce, 4000); // 렌더러가 늦거나 오류가 나도 창은 띄운다
  if (SELFTEST) app.dock?.hide();
  // X 버튼은 창만 숨긴다. 종료는 메뉴바 › 종료 또는 ⌘Q
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    hideWindow();
  });
  win.on('swipe', (_e, dir) => send('nav:swipe', dir)); // 트랙패드로 페이지 넘기기 (시스템 설정에서 켠 경우)
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    if (SELFTEST) runFnSimulation();
    else permissionStatus(); // 입력 모니터링이 허용돼 있으면 fn 감지 시작
    // 개발용: SCREENSHOT=경로 를 주면 창을 캡처해 저장
    if (!app.isPackaged && process.env.SCREENSHOT) {
      setTimeout(async () => fs.writeFileSync(process.env.SCREENSHOT, (await win.webContents.capturePage()).toPNG()), 2500);
    }
  });
}

app.on('activate', () => win && showWindow()); // Dock 아이콘 클릭
app.on('before-quit', () => {
  quitting = true;
  fnProc?.kill();
  dictation.stopServer();
  if (recording) {
    for (const w of Object.values(recording.writers)) w.close();
    recording = null;
  }
});
