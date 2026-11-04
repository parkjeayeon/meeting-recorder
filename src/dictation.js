// 받아쓰기: fn 꾹 누르기로 녹음한 음성 → 로컬 Whisper → (선택) 다듬기 → 커서 위치에 붙여 넣기
const { app, clipboard, ClipboardItem, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const cleanupText = require('./cleanup');

const MODEL_FILE = 'ggml-large-v3-turbo-q8_0.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;
const WHISPER_SERVER_CANDIDATES = [
  process.env.WHISPER_SERVER,
  '/opt/homebrew/bin/whisper-server', // brew install whisper-cpp
  '/usr/local/bin/whisper-server',
].filter(Boolean);
const CLIPBOARD_RESTORE_MS = 600;
const sandbox = require('./sandbox');

// provider: auto | claude-code | codex | api
// meetingSystemAudio: 회의 녹음에 상대방 소리(시스템 오디오)도 함께 녹음 (화상 회의용, 기본은 오프라인 회의라 꺼 둠)
// minutes: 회의가 끝나면 녹취와 회의록을 자동으로 만든다
// diarize: 회의 화자 구분 (pyannote). 토큰은 `hf auth login`으로 저장한 것을 쓰거나 설정에 넣은 값을 쓴다
const DEFAULT_SETTINGS = { enabled: true, language: 'ko', cleanup: true, provider: 'auto', vocabulary: '', meetingSystemAudio: false, minutes: true, diarize: true };

let serverProc = null;
let serverPort = null;
let serverReady = null; // Promise
let download = null; // { received, total } while downloading
let onStatus = () => {};

// ── 설정 (API 키는 macOS 키체인 기반 safeStorage로 암호화해 저장) ─────────────
function settingsPath() {
  return path.join(app.getPath('userData'), 'dictation.json');
}

function readStored() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function getSettings() {
  const { apiKeyEnc, hfTokenEnc, ...rest } = readStored();
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    hasApiKey: Boolean(apiKeyEnc) || Boolean(process.env.ANTHROPIC_API_KEY),
    hasHfToken: Boolean(hfTokenEnc) || fs.existsSync(path.join(require('os').homedir(), '.cache', 'huggingface', 'token')),
  };
}

function hfToken() {
  const { hfTokenEnc } = readStored();
  return hfTokenEnc ? safeStorage.decryptString(Buffer.from(hfTokenEnc, 'base64')) : null;
}

// `hf auth login`으로 저장된 토큰 (앱에 저장한 토큰이 없을 때 pyannote가 이걸 쓴다)
function hfCliToken() {
  try {
    return fs.readFileSync(path.join(require('os').homedir(), '.cache', 'huggingface', 'token'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// 연결 설정 창용: 값은 넘기지 않고 어디에 저장돼 있는지만 알려 준다
function tokenSources() {
  const { apiKeyEnc, hfTokenEnc } = readStored();
  return {
    hf: { app: Boolean(hfTokenEnc), cli: Boolean(hfCliToken()) },
    anthropic: { app: Boolean(apiKeyEnc), env: Boolean(process.env.ANTHROPIC_API_KEY) },
  };
}

function saveSettings(patch) {
  const stored = readStored();
  const { apiKey, hfToken: hf, ...rest } = patch;
  Object.assign(stored, rest);
  if (hf !== undefined) {
    if (hf) stored.hfTokenEnc = safeStorage.encryptString(hf).toString('base64');
    else delete stored.hfTokenEnc;
  }
  if (apiKey !== undefined) {
    if (apiKey) stored.apiKeyEnc = safeStorage.encryptString(apiKey).toString('base64');
    else delete stored.apiKeyEnc;
  }
  fs.writeFileSync(settingsPath(), JSON.stringify(stored, null, 2));
  return getSettings();
}

function apiKey() {
  const { apiKeyEnc } = readStored();
  if (apiKeyEnc) return safeStorage.decryptString(Buffer.from(apiKeyEnc, 'base64'));
  return process.env.ANTHROPIC_API_KEY || null;
}

// ── Whisper 모델과 서버 ──────────────────────────────────────────────────
function modelPath() {
  return path.join(app.getPath('userData'), 'models', MODEL_FILE);
}

function whisperServerBin() {
  return WHISPER_SERVER_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

function engineStatus() {
  if (download) return { state: 'downloading', ...download };
  if (!whisperServerBin()) return { state: 'no-engine' };
  if (!fs.existsSync(modelPath())) return { state: 'no-model' };
  if (serverPort) return { state: 'ready' };
  return { state: serverProc ? 'loading' : 'stopped' };
}

function emit() {
  onStatus(engineStatus());
}

async function downloadModel() {
  if (download || fs.existsSync(modelPath())) return;
  const dest = modelPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  download = { received: 0, total: 0 };
  emit();
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`모델 다운로드 실패 (HTTP ${res.status})`);
    download.total = Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(`${dest}.part`);
    let lastEmit = 0;
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      download.received += chunk.length;
      if (Date.now() - lastEmit > 300) {
        lastEmit = Date.now();
        emit();
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    fs.renameSync(`${dest}.part`, dest);
  } finally {
    download = null;
    emit();
  }
  startServer();
}

// 앱이 강제 종료되면 서버가 고아로 남아 메모리(약 1GB)를 계속 차지하므로 pid를 기록해 두고 다음 실행 때 정리한다
function pidFile() {
  return path.join(app.getPath('userData'), 'whisper-server.pid');
}

// 회의용 서버는 회의록을 만드는 동안만 띄우는데, 앱이 그 사이에 꺼지면 고아로 남아 메모리를 차지한다.
// 띄운 것을 기억해 두었다가 앱이 끝날 때 함께 내리고, 시작할 때는 이 앱 모델을 쓰는 고아 서버를 정리한다.
const dedicated = new Set();

// SIGTERM 등으로 before-quit 없이 끝나는 경우도 서버를 남기지 않는다
process.on('exit', () => {
  serverProc?.kill();
  for (const proc of dedicated) proc.kill();
});

function killOrphanServers() {
  try {
    const out = require('child_process').execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString();
    const models = path.join(app.getPath('userData'), 'models');
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (m && m[2] === '1' && m[3].includes('whisper-server') && m[3].includes(models)) process.kill(Number(m[1]));
    }
  } catch {}
}

function killStaleServer() {
  try {
    const pid = Number(fs.readFileSync(pidFile(), 'utf8'));
    const cmd = require('child_process').execFileSync('ps', ['-o', 'command=', '-p', String(pid)]).toString();
    if (cmd.includes('whisper-server')) process.kill(pid);
  } catch {}
  fs.rmSync(pidFile(), { force: true });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// 모델을 메모리에 올려 둔 채로 서버를 띄워 두어야 손을 뗀 뒤 바로 결과가 나온다
function startServer() {
  if (serverReady) return serverReady; // 이미 시작했거나 시작하는 중
  const bin = whisperServerBin();
  if (!bin || !fs.existsSync(modelPath())) {
    emit();
    return null;
  }
  serverReady = (async () => {
    const port = await freePort();
    // 샌드박스: 이 컴퓨터 안(127.0.0.1) 연결만, 쓰기는 임시 폴더만 → 받아쓰기 음성이 밖으로 나갈 길이 없다
    serverProc = spawn(...sandbox.wrap(bin, ['-m', modelPath(), '--host', '127.0.0.1', '--port', String(port), '-sns', '-t', '8'], { network: 'local' }), {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const proc = serverProc;
    fs.writeFileSync(pidFile(), String(proc.pid));
    proc.stderr.on('data', () => {}); // 로그는 버린다 (버퍼가 차서 멈추지 않게)
    proc.on('exit', () => {
      if (serverProc === proc) {
        serverProc = null;
        serverPort = null;
        serverReady = null;
        emit();
      }
    });
    emit();
    for (let i = 0; i < 240 && serverProc === proc; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        serverPort = port;
        emit();
        return port;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error('Whisper 서버를 시작하지 못했습니다');
  })();
  serverReady.catch(() => {
    serverProc?.kill();
    serverReady = null;
    emit();
  });
  return serverReady;
}

function stopServer() {
  serverProc?.kill();
  fs.rmSync(pidFile(), { force: true });
}

// 회의용 고성능 서버: 지정한 모델로 따로 띄우고, 다 쓰면 stop()으로 내린다 (받아쓰기 서버는 그대로 둔다)
// -pp: 받아쓰는 도중 "progress = 27%"를 출력한다 → onProgress(cb)로 받은 콜백에 0~1로 넘긴다
async function startDedicatedServer(modelFile) {
  const bin = whisperServerBin();
  if (!bin || !fs.existsSync(modelFile)) return null;
  const port = await freePort();
  const proc = spawn(...sandbox.wrap(bin, ['-m', modelFile, '--host', '127.0.0.1', '--port', String(port), '-sns', '-t', '8', '-pp'], { network: 'local' }), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let progressCb = null;
  const parse = (chunk) => {
    for (const m of String(chunk).matchAll(/progress =\s*(\d+)%/g)) progressCb?.(Number(m[1]) / 100);
  };
  proc.stdout.on('data', parse);
  proc.stderr.on('data', parse);
  dedicated.add(proc);
  proc.on('exit', () => dedicated.delete(proc));
  const stop = () => proc.kill();
  const onProgress = (cb) => (progressCb = cb);
  for (let i = 0; i < 480 && proc.exitCode === null; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return { port, stop, onProgress };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  stop();
  throw new Error('회의용 음성 인식 모델을 불러오지 못했습니다');
}

// 회의용: 구간별 시작/끝 시각이 붙은 결과. port를 주면 그 서버(회의용 고성능 모델)를 쓴다
// noContext: 앞 문장을 이어 받지 않는다 (같은 문장 반복에 빠진 구간을 다시 받아쓸 때)
async function transcribeSegments(wavPath, { language, vocabulary }, port = null, { noContext = false } = {}) {
  port ??= serverPort ?? (await startServer());
  if (!port) throw new Error('음성 인식 엔진이 준비되지 않았습니다');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'verbose_json');
  form.append('language', language);
  form.append('temperature', '0');
  if (vocabulary) form.append('prompt', vocabulary);
  if (noContext) form.append('max_context', '0');
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Whisper 오류 (HTTP ${res.status})`);
  const { segments = [] } = await res.json();
  return segments
    .map((seg) => ({ start: seg.start ?? 0, end: seg.end ?? 0, text: (seg.text ?? '').trim() }))
    .filter((seg) => seg.text && !isHallucination(seg.text));
}

async function transcribe(wavPath, { language, vocabulary }) {
  const port = serverPort ?? (await startServer());
  if (!port) throw new Error('받아쓰기 엔진이 준비되지 않았습니다');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  form.append('language', language);
  form.append('temperature', '0');
  if (vocabulary) form.append('prompt', vocabulary); // 자주 쓰는 고유명사·용어를 알려 주면 인식률이 오른다
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Whisper 오류 (HTTP ${res.status})`);
  const { text = '' } = await res.json();
  return text.trim();
}

// Whisper가 무음·잡음에서 자주 지어내는 문장들
const HALLUCINATIONS = [
  /^(감사합니다|고맙습니다|감사드립니다|시청해 ?주셔서 감사합니다|시청해 ?주셔서 고맙습니다|다음 영상에서 만나요|구독과 좋아요.*|구독 ?좋아요.*|MBC 뉴스.*|KBS 뉴스.*|자막 제공.*|한글자막.*|\.+|thank you\.?|thanks for watching\.?)$/i,
  /^(감사합니다[.!\s]*){2,}$/,
];

function isHallucination(text) {
  return !text || HALLUCINATIONS.some((re) => re.test(text.replace(/[.!?\s]+$/, '').trim()) || re.test(text));
}

// ── 커서 위치에 붙여 넣기 ─────────────────────────────────────────────────
// Electron 45의 클립보드 API는 비동기 ClipboardItem 방식이다
async function snapshotClipboard() {
  const items = [];
  for (const item of await clipboard.read()) {
    const data = {};
    for (const type of item.types) {
      try {
        data[type] = await item.getType(type);
      } catch {}
    }
    if (Object.keys(data).length) items.push(data);
  }
  return items;
}

async function restoreClipboard(items) {
  if (items.length) await clipboard.write(items.map((data) => new ClipboardItem(data)));
  else clipboard.clear();
}

async function paste(text, helperBin) {
  const snap = await snapshotClipboard().catch(() => null);
  await clipboard.writeText(text);
  const result = await new Promise((resolve) => {
    const proc = spawn(helperBin, ['paste'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('exit', (code) => resolve(code === 0 ? 'pasted' : out.includes('permission') ? 'no-permission' : 'failed'));
  });
  // 붙여 넣기에 실패하면 클립보드에 남겨 두어 사용자가 직접 ⌘V 할 수 있게 한다
  if (result === 'pasted' && snap) {
    setTimeout(() => restoreClipboard(snap).catch(() => {}), CLIPBOARD_RESTORE_MS);
  }
  return result;
}

// ── 전체 흐름 ───────────────────────────────────────────────────────────
const MIN_VOICED_MS = 300; // 말소리가 이보다 짧으면 Whisper에 넘기지 않는다

async function dictate(wavPath, { helperBin, peak, voicedMs = Infinity, onStage = () => {} }) {
  const settings = getSettings();
  const timing = {};
  let t = Date.now();
  // 거의 무음이면 Whisper를 돌리지 않는다 (무음에서 문장을 지어내는 문제 방지)
  if (peak < 0.01 || voicedMs < MIN_VOICED_MS) return { status: 'silent' };

  onStage({ stage: 'transcribe' });
  const raw = await transcribe(wavPath, settings);
  timing.transcribeMs = Date.now() - t;
  if (isHallucination(raw)) return { status: 'empty', raw, timing };

  let text = raw;
  let cleanup = null;
  if (settings.cleanup) {
    onStage({ stage: 'cleanup' });
    t = Date.now();
    cleanup = await cleanupText.cleanup(raw, { provider: settings.provider, apiKey: apiKey() });
    text = cleanup.text;
    timing.cleanupMs = Date.now() - t;
  }

  onStage({ stage: 'paste' });
  t = Date.now();
  const pasted = await paste(text, helperBin);
  timing.pasteMs = Date.now() - t;
  return {
    status: pasted,
    raw,
    text,
    cleaned: text !== raw,
    cleanupProvider: cleanup?.provider ?? null,
    cleanupChunks: cleanup?.chunks ?? 0,
    cleanupError: cleanup?.error ?? null,
    timing,
  };
}

function init({ onEngineStatus }) {
  onStatus = onEngineStatus;
  killStaleServer();
  killOrphanServers();

  if (getSettings().enabled) startServer()?.catch(() => {}); // 실패는 engineStatus로 화면에 표시된다
}

function cleanupProviders(opts) {
  return cleanupText.providerStatus({ hasApiKey: getSettings().hasApiKey }, opts);
}

const engineInstalled = () => whisperServerBin();
// 사용자가 실제로 저장한 설정만 (기본값·토큰 제외)
const storedSettings = () => {
  const { apiKeyEnc, hfTokenEnc, ...rest } = readStored();
  return rest;
};

module.exports = { init, engineInstalled, storedSettings, dictate, paste, transcribeSegments, startDedicatedServer, apiKey, hfToken, hfCliToken, tokenSources, cleanupProviders, downloadModel, engineStatus, startServer, stopServer, getSettings, saveSettings };
