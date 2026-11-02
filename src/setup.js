// 엔진 설치·삭제: 음성 인식 엔진(whisper.cpp), 받아쓰기·회의 모델, 화자 구분 환경을 앱 안에서 설치하고 크기를 보여 준다.
// 화자 구분 환경(uv → 파이썬 → pyannote → 모델)은 샌드박스 안에서 앱 폴더에만 쓰도록 설치한다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');
const sandbox = require('./sandbox');
const dictation = require('./dictation');

const PYANNOTE = 'pyannote.audio==4.0.7';
const DIARIZE_MODEL = 'pyannote/speaker-diarization-community-1';
const DIARIZE_MODEL_DIR = 'models--pyannote--speaker-diarization-community-1';
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const MODELS = {
  turbo: { file: 'ggml-large-v3-turbo-q8_0.bin', approx: 874e6 },
  large: { file: 'ggml-large-v3.bin', approx: 3.1e9 },
};

const root = () => app.getPath('userData');
const p = {
  models: () => path.join(root(), 'models'),
  model: (id) => path.join(root(), 'models', MODELS[id].file),
  env: () => path.join(root(), 'diarize-env'),
  envPython: () => path.join(root(), 'diarize-env', 'bin', 'python'),
  marker: () => path.join(root(), 'diarize-env', '.installed'),
  uv: () => path.join(root(), 'bin', 'uv'),
  python: () => path.join(root(), 'python'),
  uvCache: () => path.join(root(), 'uv-cache'),
  hfCache: () => path.join(root(), 'hf-cache'),
};

const jobs = new Map(); // id → { text, pct, error }
let onChange = () => {};

function init({ onStatus }) {
  onChange = onStatus;
}

function set(id, patch) {
  if (patch === null) jobs.delete(id);
  else jobs.set(id, { ...(jobs.get(id) ?? {}), ...patch });
  status().then(onChange);
}

async function sizeOf(target) {
  try {
    const st = await fs.promises.lstat(target);
    if (!st.isDirectory()) return st.size;
    let total = 0;
    for (const name of await fs.promises.readdir(target)) total += await sizeOf(path.join(target, name));
    return total;
  } catch {
    return 0;
  }
}

const brewBin = () => BREW_CANDIDATES.find((b) => fs.existsSync(b)) ?? null;
const diarizeInstalled = () => fs.existsSync(p.envPython()) && (fs.existsSync(p.marker()) || fs.existsSync(path.join(p.env(), 'lib')));
const diarizeModelReady = () => fs.existsSync(path.join(p.hfCache(), DIARIZE_MODEL_DIR, 'snapshots'));

async function status() {
  const job = (id) => jobs.get(id) ?? null;
  const diarizeDirs = [p.env(), p.python(), p.uvCache(), p.hfCache(), path.dirname(p.uv())];
  const list = [
    {
      id: 'engine', name: '음성 인식 엔진', desc: 'whisper.cpp (Homebrew로 설치)',
      installed: Boolean(dictation.engineInstalled()), size: null, removable: false,
      blocker: !dictation.engineInstalled() && !brewBin() ? 'brew' : null,
    },
    {
      id: 'turbo', name: '받아쓰기 모델', desc: 'Whisper large-v3-turbo · fn 받아쓰기에 씀',
      installed: fs.existsSync(p.model('turbo')), size: await sizeOf(p.model('turbo')) || MODELS.turbo.approx, removable: true,
    },
    {
      id: 'large', name: '회의 모델', desc: 'Whisper large-v3 · 회의 녹취에 씀 (없으면 받아쓰기 모델로 녹취)',
      installed: fs.existsSync(p.model('large')), size: await sizeOf(p.model('large')) || MODELS.large.approx, removable: true,
    },
    {
      id: 'diarize', name: '화자 구분', desc: 'pyannote · 파이썬 환경과 모델을 샌드박스 안에서 설치',
      installed: diarizeInstalled() && diarizeModelReady(), partial: diarizeInstalled() && !diarizeModelReady(),
      size: (await Promise.all(diarizeDirs.map(sizeOf))).reduce((a, b) => a + b, 0) || 1.2e9, removable: true,
      blocker: !dictation.hfToken() && !dictation.hfCliToken() && !diarizeModelReady() ? 'token' : null,
    },
  ];
  return list.map((c) => ({ ...c, job: job(c.id) }));
}

// 줄 단위로 진행 상황을 읽으며 실행한다
function run(cmd, args, { env = {}, sandboxed = null, onLine = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const [bin, argv] = sandboxed ? sandbox.wrap(cmd, args, sandboxed) : [cmd, args];
    const proc = spawn(bin, argv, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const feed = (d) => {
      tail = (tail + d).slice(-4000);
      for (const line of d.toString().split(/[\r\n]+/)) if (line.trim()) onLine(line.trim());
    };
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve(tail) : reject(new Error(tail.trim().split('\n').pop() || `종료 코드 ${code}`))));
  });
}

async function download(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패 (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(`${dest}.part`);
  let received = 0;
  let last = 0;
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    received += chunk.length;
    if (Date.now() - last > 300) {
      last = Date.now();
      onProgress(received, total);
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  fs.renameSync(`${dest}.part`, dest);
}

const mb = (n) => `${Math.round(n / 1e6)}MB`;

async function installEngine() {
  const brew = brewBin();
  if (!brew) throw new Error('Homebrew가 없습니다. 터미널에서 brew.sh의 설치 명령을 먼저 실행하세요');
  // Homebrew는 시스템 폴더에 설치하는 도구라 샌드박스에 넣지 않는다
  await run(brew, ['install', 'whisper-cpp'], {
    env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' },
    onLine: (line) => set('engine', { text: line.slice(0, 120) }),
  });
  dictation.startServer();
}

async function installModel(id) {
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODELS[id].file}`;
  await download(url, p.model(id), (got, total) => set(id, { pct: total ? got / total : null, text: `${mb(got)}${total ? ` / ${mb(total)}` : ''}` }));
  if (id === 'turbo') dictation.startServer();
}

async function installDiarize() {
  const box = { write: [root()], network: 'all' }; // 설치는 내려받아야 하므로 네트워크는 열고, 쓰기는 앱 폴더만
  const uvEnv = { UV_PYTHON_INSTALL_DIR: p.python(), UV_CACHE_DIR: p.uvCache(), UV_NO_CONFIG: '1', ...sandbox.cacheEnv(path.join(root(), 'tmp')) };
  const step = (n, text) => set('diarize', { text: `${n}/4 ${text}`, pct: null });

  if (!fs.existsSync(p.uv())) {
    step(1, 'uv 받는 중');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const url = `https://github.com/astral-sh/uv/releases/latest/download/uv-${arch}-apple-darwin.tar.gz`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-uv-'));
    try {
      await download(url, path.join(tmp, 'uv.tar.gz'), (got, total) => set('diarize', { text: `1/4 uv 받는 중 ${mb(got)}`, pct: total ? got / total : null }));
      await run('/usr/bin/tar', ['xzf', path.join(tmp, 'uv.tar.gz'), '-C', tmp], { sandboxed: { write: [tmp], network: 'none' } });
      fs.mkdirSync(path.dirname(p.uv()), { recursive: true });
      fs.copyFileSync(path.join(tmp, `uv-${arch}-apple-darwin`, 'uv'), p.uv());
      fs.chmodSync(p.uv(), 0o755);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(p.envPython())) {
    step(2, '파이썬 3.12 환경 만드는 중');
    // 컴퓨터에 깔린 파이썬이 아니라 앱 폴더에 받은 파이썬을 쓴다 (다른 설치와 엮이지 않게)
    await run(p.uv(), ['venv', '--python', '3.12', '--python-preference', 'only-managed', p.env()], { env: uvEnv, sandboxed: box, onLine: (l) => set('diarize', { text: `2/4 ${l.slice(0, 100)}` }) });
  }

  if (!fs.existsSync(p.marker())) {
    step(3, 'pyannote 설치 중 (약 1GB)');
    await run(p.uv(), ['pip', 'install', '--python', p.envPython(), PYANNOTE], { env: uvEnv, sandboxed: box, onLine: (l) => set('diarize', { text: `3/4 ${l.slice(0, 100)}` }) });
    fs.writeFileSync(p.marker(), new Date().toISOString());
    fs.rmSync(p.uvCache(), { recursive: true, force: true }); // 설치에 쓴 내려받기 캐시(약 1GB)는 지운다
  }

  if (!diarizeModelReady()) {
    const token = dictation.hfToken() ?? dictation.hfCliToken();
    if (!token) throw new Error('Hugging Face 토큰이 필요합니다. 설정 › 계정·토큰에서 넣은 뒤 다시 누르세요');
    step(4, '화자 구분 모델 받는 중 (33MB)');
    const code = `from pyannote.audio import Pipeline\nPipeline.from_pretrained(${JSON.stringify(DIARIZE_MODEL)}, token=__import__('os').environ['HF_TOKEN'])\nprint('ok')`;
    try {
      await run(p.envPython(), ['-I', '-c', code], { env: { ...uvEnv, HF_TOKEN: token, HF_HUB_CACHE: p.hfCache() }, sandboxed: box });
    } catch (err) {
      if (/gated|401|403|restricted|Unauthorized/i.test(err.message)) throw new Error('모델 약관에 동의하지 않았거나 토큰이 맞지 않습니다. 모델 페이지에서 약관에 동의하세요');
      throw err;
    }
  }
}

const INSTALLERS = { engine: installEngine, turbo: () => installModel('turbo'), large: () => installModel('large'), diarize: installDiarize };

async function install(id) {
  if (jobs.get(id)?.running) return;
  set(id, { running: true, text: '준비 중', pct: null, error: null });
  try {
    await INSTALLERS[id]();
    set(id, null);
  } catch (err) {
    set(id, { running: false, error: err.message.split('\n')[0].slice(0, 240) });
  }
}

async function remove(id) {
  if (jobs.get(id)?.running) throw new Error('설치 중에는 지울 수 없습니다');
  if (id === 'turbo') {
    dictation.stopServer();
    fs.rmSync(p.model('turbo'), { force: true });
  } else if (id === 'large') fs.rmSync(p.model('large'), { force: true });
  else if (id === 'diarize') {
    for (const dir of [p.env(), p.python(), p.uvCache(), p.hfCache(), path.dirname(p.uv()), path.join(root(), 'tmp')]) fs.rmSync(dir, { recursive: true, force: true });
  } else throw new Error('지울 수 없는 항목입니다');
  set(id, null);
}

module.exports = { init, status, install, remove };
