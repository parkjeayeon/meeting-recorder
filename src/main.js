const { app, BrowserWindow, ipcMain, session, desktopCapturer, Tray, Menu, nativeImage, shell, screen, systemPreferences, clipboard, nativeTheme, protocol, dialog } = require('electron');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const { WavWriter } = require('./wav-writer');
const dictation = require('./dictation');
const minutes = require('./minutes');

const SELFTEST = process.argv.includes('--selftest');
const TAP_MAX_MS = 300; // 이보다 짧게 눌렀다 떼면 실수로 누른 것으로 보고 버린다
const DEBOUNCE_MS = 500; // 두 번 누르기·짧은 탭 판단 (Wispr Flow DICTATION_DEBOUNCE_DELAY와 같은 값)
const VOICE_RMS = 0.003; // 이 크기 이상이면 말소리로 센다 (-50dBFS, 조용한 방 잡음 -63dBFS보다 13dB 위)
const DICTATION_MAX_MS = 20 * 60 * 1000; // 받아쓰기 한 번의 최대 길이 (Wispr Flow와 같은 20분)
const RECORDINGS_DIR = path.join(os.homedir(), 'Documents', 'MeetingRecorder');
// 받아쓰기는 음성을 남기지 않는다: 임시 폴더에 녹음 → 변환·입력 → 음성 삭제, 데이터만 이 파일에 한 줄씩 쌓는다
const DICTATION_LOG = path.join(RECORDINGS_DIR, 'dictations.jsonl');

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
// 꾹 누르기 : 누르는 동안 녹음, 떼면 받아써서 커서 위치에 입력
// 짧게 눌렀다 떼거나 fn+다른 키 단축키를 쓰면 녹음을 버린다
let fnState = 'idle'; // idle | holding | tapped(짧게 뗀 뒤 두 번째 누름 대기) | handsfree(잠금·버튼으로 시작한 녹음)
let handsfreeMode = null;
let fnDownAt = 0;
let ignoreNextUp = false;
let dictationStartAt = 0;
let memoStopping = false; // 받아쓰기를 멈추고 파일을 넘기는 사이 (이때부터 입력이 끝날 때까지는 처리 중)
let lastBusyNotice = 0;
let tapTimer = null;

function command(action, mode) {
  if (action === 'stop' && recording?.mode === 'memo') {
    memoStopping = true;
    setTimeout(() => (memoStopping = false), 5000); // 창 쪽에서 멈추기에 실패해도 fn이 막혀 있지 않게
  }
  send('rec:cmd', { action, mode });
}

// Wispr Flow와 같은 규칙 (DICTATION_DEBOUNCE_DELAY = 500ms):
// - 누르면 바로 듣기 시작. 0.5초 이상 누르고 있다 떼면 받아써서 입력
// - 0.5초 안에 뗐다면 0.5초 더 기다렸다가 두 번째 누름이 없으면 버린다
// - 시작 후 0.5초 안에 다시 누르면 지금 녹음을 그대로 이어서 잠금(손을 떼도 계속 듣기)
// - 잠긴 상태에서 다시 누르면 끝내고 입력, 시작 후 0.5초 안에 세 번째로 누르면 취소
// 앞 받아쓰기를 아직 처리하는 중이면 새로 시작하지 않는다 (Wispr Flow와 같이, 알림은 0.5초에 한 번만)
function dictationBusy() {
  return transcribing > 0 || memoStopping;
}

function onFnDown() {
  fnDownAt = Date.now();
  if (fnState === 'idle' && dictationBusy()) {
    if (fnDownAt - lastBusyNotice > DEBOUNCE_MS) sendOverlay('overlay:stage', { stage: 'busy' });
    if (SELFTEST) console.log('SELFTEST busy-ignored');
    lastBusyNotice = fnDownAt;
    ignoreNextUp = true;
    return;
  }
  if (fnState === 'handsfree') {
    // 버튼으로 시작한 받아쓰기는 fn으로도 끝낼 수 있지만, 회의 녹음은 fn에 반응하지 않는다
    if (handsfreeMode !== 'memo') return;
    command(fnDownAt - dictationStartAt < DEBOUNCE_MS ? 'cancel' : 'stop');
    fnState = 'idle';
    handsfreeMode = null;
    ignoreNextUp = true;
  } else if (fnState === 'tapped') {
    if (fnDownAt - dictationStartAt < DEBOUNCE_MS) {
      clearTimeout(tapTimer);
      fnState = 'handsfree';
      handsfreeMode = 'memo';
      ignoreNextUp = true;
      sendOverlayState();
    }
  } else if (fnState === 'idle' && dictation.getSettings().enabled) {
    command('start', 'memo'); // 누르는 즉시 시작해야 첫 음절이 잘리지 않는다
    dictationStartAt = fnDownAt;
    fnState = 'holding';
  }
}

function onFnUp({ chord }) {
  if (ignoreNextUp) {
    ignoreNextUp = false;
    return;
  }
  if (fnState !== 'holding') return;
  if (chord) {
    fnState = 'idle';
    command('cancel');
  } else if (Date.now() - dictationStartAt < DEBOUNCE_MS) {
    fnState = 'tapped'; // 두 번째 누름을 기다린다
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      if (fnState !== 'tapped') return;
      fnState = 'idle';
      command('cancel');
    }, DEBOUNCE_MS);
  } else {
    fnState = 'idle';
    command('stop');
  }
}

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
  if (!recording) return;
  command('cancel');
  fnState = 'idle';
  handsfreeMode = null;
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
  clearTimeout(tapTimer);
  if (fnState === 'holding' || fnState === 'tapped' || fnState === 'handsfree') {
    command('stop');
    fnState = 'idle';
    handsfreeMode = null;
  } else {
    command('start', mode);
    fnState = 'handsfree';
    handsfreeMode = mode;
  }
}

function handleFnLine(line) {
  if (line === 'ready') send('fn:status', { ok: true });
  else if (line === 'error:permission') send('perm:changed'); // 권한 패널이 안내한다
  else if (line === 'down') onFnDown();
  else if (line === 'up') onFnUp({ chord: false });
  else if (line === 'chord') onFnUp({ chord: true });
}

function helperPath(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(__dirname, '..', 'native', name);
}

function startFnListener() {
  if (fnProc) return;
  const bin = helperPath('fn-listener');
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
      command('stop');
      fnState = 'idle';
      handsfreeMode = null;
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
  if (!recording || recording.mode !== 'memo' || discard) memoStopping = false;
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
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
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
  memoStopping = false;
  sendOverlayState();
  const onStage = (stage) => {
    sendOverlay('overlay:stage', stage);
    send('dict:stage', stage);
  };
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
    language: settings.language,
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

function runMinutes(dir, speakers = null) {
  activeMinutes.add(dir);
  return minutes.makeMinutes(dir, {
    speakers,
    onStage: (s) => {
      send('minutes:status', { id: path.basename(dir), ...s });
      if (s.status === 'queued') sendOverlay('overlay:stage', { stage: 'done', status: 'meeting-saved' });
      if (s.status === 'done') {
        const rv = reviewSummary(dir);
        sendOverlay('overlay:stage', { stage: 'done', status: 'minutes-done', text: `${s.title ?? ''}${rv?.open ? ` · 확인 필요 ${rv.open}개` : ''}` });
      }
      if (s.status === 'error') sendOverlay('overlay:stage', { stage: 'done', status: 'minutes-error', error: s.error });
      if (['done', 'error', 'empty'].includes(s.status)) activeMinutes.delete(dir);
    },
  });
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
ipcMain.handle('speaker:rename', (_e, dir, from, to) => minutes.renameSpeaker(recordingDir(dir), from, to));
ipcMain.handle('minutes:read', (_e, dir) => {
  const d = recordingDir(dir);
  const read = (f) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8') : null);
  return { minutes: read('minutes.md'), transcript: read('transcript.txt'), scriptClean: read('script-clean.txt'), review: minutes.readReview(d) };
});
ipcMain.handle('review:make', (_e, dir) => minutes.makeReview(recordingDir(dir)));
ipcMain.handle('review:apply', (_e, dir, fixes) => minutes.applyReview(recordingDir(dir), fixes));
ipcMain.handle('review:status', (_e, dir, ids, status) => minutes.setReviewStatus(recordingDir(dir), ids, status === 'open' ? 'open' : 'kept'));
ipcMain.handle('review:finalize', (_e, dir) => minutes.finalizeReview(recordingDir(dir)));
ipcMain.handle('review:chat', (_e, dir, ids, messages) => minutes.chatReview(recordingDir(dir), ids, messages));
// 회의록의 할 일 체크: minutes.md에서 n번째 "- [ ]" 줄을 뒤집는다
ipcMain.handle('minutes:todo', (_e, dir, index, done) => {
  const file = path.join(recordingDir(dir), 'minutes.md');
  let n = -1;
  const md = fs.readFileSync(file, 'utf8').replace(/^(\s*- \[)( |x)(\])/gim, (all, a, mark, b) => (++n === index ? `${a}${done ? 'x' : ' '}${b}` : all));
  fs.writeFileSync(file, md);
  return md;
});
// 회의 삭제는 휴지통으로 옮긴다 (Finder에서 되살릴 수 있다)
ipcMain.handle('meeting:trash', async (_e, dir) => {
  const d = recordingDir(dir);
  if (activeMinutes.has(d)) throw new Error('회의록을 만드는 중에는 지울 수 없습니다');
  await shell.trashItem(d);
});
ipcMain.handle('dict:delete', (_e, id) => {
  const lines = fs.readFileSync(DICTATION_LOG, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(DICTATION_LOG, lines.filter((l) => !l.includes(`"id":${JSON.stringify(id)}`)).map((l) => `${l}\n`).join(''));
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

function readDictationLog() {
  let lines = [];
  try {
    lines = fs.readFileSync(DICTATION_LOG, 'utf8').split('\n');
  } catch {}
  return lines
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((d) => d?.raw && d.status !== 'empty') // 말이 없었거나 지어낸 문장으로 걸러진 시도는 통계용으로만 남긴다
    .map((d) => ({
      id: d.id,
      mode: 'memo',
      startedAt: d.startedAt,
      durationSec: d.durationSec,
      app: d.app,
      words: d.words,
      chars: d.chars,
      wpm: d.wpm,
      transcript: { raw: d.raw, text: d.text, cleanupProvider: d.cleanupProvider, cleanupError: d.cleanupError, timing: d.timing },
    }));
}

// 회의 목록에 '초안 · 확인 N개' / '확정'을 표시하기 위한 요약
function reviewSummary(dir) {
  const review = readJson(path.join(dir, 'review.json'));
  if (!review) return null;
  return { open: review.items.filter((it) => it.status === 'open').length, total: review.items.length, finalized: Boolean(review.finalizedAt) };
}

function listHistory(limit = 300) {
  const items = [...readDictationLog(), ...listFolders(limit)];
  return items.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
}

function listFolders(limit) {
  let names = [];
  try {
    names = fs.readdirSync(RECORDINGS_DIR).filter((n) => /^\d{4}-\d{2}-\d{2}_/.test(n));
  } catch {}
  return names
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      const dir = path.join(RECORDINGS_DIR, name);
      const meta = readJson(path.join(dir, 'meta.json'));
      if (!meta) return null; // 녹음 중이거나 깨진 폴더
      const transcript = readJson(path.join(dir, 'transcript.json'));
      let minutesState = readJson(path.join(dir, 'minutes.json'));
      // 이전 실행에서 만들다 끊긴 회의록은 실패로 보여 줘서 다시 만들 수 있게 한다
      if (minutesState && ['queued', 'transcribe', 'write'].includes(minutesState.status) && !activeMinutes.has(dir)) {
        minutesState = { ...minutesState, status: 'error', error: '앱이 종료되어 중단됨' };
      }
      const durationSec = Math.max(0, ...Object.values(meta.files ?? {}).map((f) => f.durationSec ?? 0));
      let summary = null;
      try {
        summary = /^## 요약\s*\n([\s\S]*?)(?=\n## |(?![\s\S]))/m.exec(fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8'))?.[1].trim() ?? null;
      } catch {}
      return {
        id: name,
        dir,
        mode: meta.mode,
        startedAt: meta.startedAt,
        durationSec,
        tracks: Object.keys(meta.files ?? {}),
        speakersHint: meta.speakers ?? null,
        firstFile: Object.values(meta.files ?? {})[0]?.file ?? null,
        transcript,
        minutes: minutesState,
        summary,
        review: reviewSummary(dir),
      };
    })
    .filter(Boolean);
}

ipcMain.handle('history:list', () => listHistory());
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

// ── 연결 설정 창: 토큰·키 저장, 삭제, 확인 ─────────────────────────────────
const DIARIZE_MODEL = 'pyannote/speaker-diarization-community-1';
const EXTERNAL_LINKS = new Set([
  'https://huggingface.co/settings/tokens',
  `https://huggingface.co/${DIARIZE_MODEL}`,
  'https://console.anthropic.com/settings/keys',
]);

ipcMain.handle('tokens:status', () => dictation.tokenSources());
ipcMain.handle('tokens:save', (_e, kind, value) => {
  const v = String(value ?? '').trim();
  if (!v) return dictation.tokenSources();
  dictation.saveSettings(kind === 'hf' ? { hfToken: v } : { apiKey: v });
  return dictation.tokenSources();
});
ipcMain.handle('tokens:clear', (_e, kind) => {
  dictation.saveSettings(kind === 'hf' ? { hfToken: '' } : { apiKey: '' });
  return dictation.tokenSources();
});
ipcMain.handle('tokens:verify', async (_e, kind) => {
  try {
    if (kind === 'hf') {
      const token = dictation.hfToken() ?? dictation.hfCliToken();
      if (!token) return { ok: false, message: '저장된 토큰이 없습니다' };
      const headers = { Authorization: `Bearer ${token}` };
      const who = await fetch('https://huggingface.co/api/whoami-v2', { headers, signal: AbortSignal.timeout(10000) });
      if (!who.ok) return { ok: false, message: '토큰이 맞지 않습니다 (만료되었거나 잘못 입력됨)' };
      const user = (await who.json()).name;
      // 약관에 동의하지 않은 계정은 모델 파일을 받을 수 없다 (403)
      const model = await fetch(`https://huggingface.co/${DIARIZE_MODEL}/resolve/main/config.yaml`, {
        method: 'HEAD',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const access = model.status < 400;
      return {
        ok: access,
        user,
        message: access ? `${user} 계정 · 화자 구분 모델 사용 가능` : `${user} 계정 · 모델 약관에 아직 동의하지 않았습니다`,
      };
    }
    const key = dictation.apiKey();
    if (!key) return { ok: false, message: '저장된 API 키가 없습니다' };
    const Anthropic = require('@anthropic-ai/sdk').default;
    await new Anthropic({ apiKey: key, timeout: 10000, maxRetries: 0 }).models.list({ limit: 1 });
    return { ok: true, message: 'API 키 사용 가능' };
  } catch (err) {
    const status = err?.status;
    if (status === 401) return { ok: false, message: 'API 키가 맞지 않습니다' };
    if (status === 403) return { ok: false, message: '이 키로는 접근 권한이 없습니다' };
    return { ok: false, message: `확인하지 못했습니다: ${err.message}` };
  }
});
ipcMain.on('app:openExternal', (_e, url) => {
  if (EXTERNAL_LINKS.has(url)) shell.openExternal(url);
});

function pasteLast() {
  const text = lastTranscript ?? listHistory(50).find((r) => r.transcript?.text || r.transcript?.raw)?.transcript;
  const value = typeof text === 'string' ? text : text?.text ?? text?.raw;
  if (value) dictation.paste(value, helperPath('permissions'));
}

ipcMain.handle('dict:settings', () => ({ ...dictation.getSettings(), engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() }));
ipcMain.handle('dict:saveSettings', (_e, patch) => {
  const settings = dictation.saveSettings(patch);
  if (settings.enabled) dictation.startServer();
  return { ...settings, engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() };
});
ipcMain.handle('dict:download', () => dictation.downloadModel().catch((err) => send('dict:engine', { state: 'error', error: err.message })));

ipcMain.handle('app:info', async () => ({
  capability,
  fnWarning: fnUsageWarning(),
  micAccess: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted',
  recordingsDir: RECORDINGS_DIR,
  selftest: SELFTEST,
}));

// ── 권한 확인 / 요청 ─────────────────────────────────────────────────────
const SETTINGS_PANE = {
  microphone: 'Privacy_Microphone',
  inputMonitoring: 'Privacy_ListenEvent',
  systemAudio: 'Privacy_AudioCapture',
  accessibility: 'Privacy_Accessibility',
};

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

function openPrivacySettings(kind) {
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${SETTINGS_PANE[kind]}`);
}

ipcMain.handle('perm:status', permissionStatus);
ipcMain.handle('perm:request', async (_e, kind) => {
  const before = (await permissionStatus())[kind];
  if (kind === 'microphone' && before === 'not-determined') await systemPreferences.askForMediaAccess('microphone');
  else if (kind === 'inputMonitoring' && before !== 'granted') {
    await runPermissionsHelper(['request', 'input']); // 시스템 설정 목록에 앱을 추가
    openPrivacySettings(kind); // 입력 모니터링은 사용자가 직접 켜야 한다
  } else if (kind === 'accessibility' && before !== 'granted') {
    await runPermissionsHelper(['request', 'accessibility']); // 시스템 설정 목록에 앱을 추가
    openPrivacySettings(kind);
  } else if (kind === 'systemAudio' && before === 'unknown') await runPermissionsHelper(['request', 'audio']);
  else if (before !== 'granted') openPrivacySettings(kind);
  return permissionStatus();
});
ipcMain.on('perm:openSettings', (_e, kind) => openPrivacySettings(kind));

ipcMain.on('app:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('app:openRecordings', () => {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  shell.openPath(RECORDINGS_DIR);
});
ipcMain.on('rec:toggle', (_e, mode) => uiToggle(mode));
ipcMain.on('rec:pause', (_e, on) => setPaused(Boolean(on)));
ipcMain.on('rec:cancel', () => uiCancel());
// 참석 인원: 녹음 전에는 다음 회의에, 녹음 중이면 지금 회의에 적용한다 (null = 자동)
ipcMain.on('rec:speakers', (_e, n) => {
  const v = Number(n) || null;
  if (recording?.mode === 'meeting') recording.speakers = v;
  else nextSpeakers = v;
});
ipcMain.on('rec:failed', () => {
  fnState = 'idle';
});
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
const OVERLAY_SIZE = { width: 320, height: 160 }; // 독 + 오른쪽으로 펼쳐지는 진행 띠

function createOverlay() {
  overlay = new BrowserWindow({
    ...OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false, // 클릭해도 지금 쓰던 앱의 포커스를 빼앗지 않는다
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
    overlay.webContents.send('overlay:state', { recording: recording?.mode ?? null, transcribing: transcribing > 0, clock: clockInfo(), handsfree: recording?.mode === 'memo' && fnState === 'handsfree' });
  }
}

ipcMain.on('overlay:interactive', (_e, on) => overlay?.setIgnoreMouseEvents(!on, { forward: true }));
ipcMain.on('overlay:action', (_e, name) => {
  if (name === 'open') showWindow();
  else uiToggle(name);
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
  if (path.dirname(path.dirname(file)) !== RECORDINGS_DIR || !/\.wav$/i.test(file) || !fs.existsSync(file)) {
    return new Response('not found', { status: 404 });
  }
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
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
  // 권한 대화상자를 기다리느라 fn 감지·독·로그인 항목 설정이 멈추지 않게 await하지 않는다
  if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone');
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

  // 패키징된 앱은 처음 실행할 때 로그인 항목에 등록
  const FIRST_RUN_FLAG = path.join(app.getPath('userData'), '.login-item-configured');
  if (app.isPackaged && !fs.existsSync(FIRST_RUN_FLAG)) {
    app.setLoginItemSettings({ openAtLogin: true });
    fs.writeFileSync(FIRST_RUN_FLAG, '');
  }
  const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;

  installDisplayMediaHandler();
  dictation.init({ onEngineStatus: (status) => send('dict:engine', status) });

  createOverlay();
  if (!SELFTEST) overlay.once('ready-to-show', showOverlay);
  tray = new Tray(nativeImage.createEmpty());
  updateTray();

  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: !openedAtLogin && !SELFTEST,
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
