// 화자 구분 환경 설치: uv → 파이썬 3.12 → pyannote → 화자 구분 모델, 네 걸음 (src/setup.js에서 옮김, 결정 70)
// 샌드박스 안에서 앱 폴더에만 쓰도록 설치한다. 이미 된 걸음은 건너뛴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Paths, SandboxOptions } from '../platform/index.mjs';
import type { SetupPaths } from './paths.mjs';
import type { RunOptions } from './run.mjs';

const PYANNOTE = 'pyannote.audio==4.0.7';
const DIARIZE_MODEL = 'pyannote/speaker-diarization-community-1';

export interface DiarizeContext {
  root: () => string; // 앱 데이터 폴더
  p: SetupPaths;
  uvArchive: Paths['uvArchive'];
  cacheEnv: (dir: string) => Record<string, string>;
  run: (cmd: string, args: string[], opts?: RunOptions) => Promise<string>;
  download: (url: string, dest: string, onProgress: (received: number, total: number) => void) => Promise<void>;
  progress: (patch: { text: string; pct?: number | null }) => void; // set('diarize', …)
  token: () => string | null; // 앱에 저장한 토큰, 없으면 hf auth login 토큰
  modelReady: () => boolean;
}

const mb = (n: number) => `${Math.round(n / 1e6)}MB`;

export async function installDiarize(c: DiarizeContext): Promise<void> {
  const { p } = c;
  const box: SandboxOptions = { write: [c.root()], network: 'all' }; // 설치는 내려받아야 하므로 네트워크는 열고, 쓰기는 앱 폴더만
  const uvEnv = { UV_PYTHON_INSTALL_DIR: p.python(), UV_CACHE_DIR: p.uvCache(), UV_NO_CONFIG: '1', ...c.cacheEnv(path.join(c.root(), 'tmp')) };
  const step = (n: number, text: string) => c.progress({ text: `${n}/4 ${text}`, pct: null });

  if (!fs.existsSync(p.uv())) {
    step(1, 'uv 받는 중');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const { url, dir: uvDir } = c.uvArchive(arch);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-uv-'));
    try {
      await c.download(url, path.join(tmp, 'uv.tar.gz'), (got, total) => c.progress({ text: `1/4 uv 받는 중 ${mb(got)}`, pct: total ? got / total : null }));
      await c.run('/usr/bin/tar', ['xzf', path.join(tmp, 'uv.tar.gz'), '-C', tmp], { sandboxed: { write: [tmp], network: 'none' } });
      fs.mkdirSync(path.dirname(p.uv()), { recursive: true });
      fs.copyFileSync(path.join(tmp, uvDir, 'uv'), p.uv());
      fs.chmodSync(p.uv(), 0o755);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(p.envPython())) {
    step(2, '파이썬 3.12 환경 만드는 중');
    // 컴퓨터에 깔린 파이썬이 아니라 앱 폴더에 받은 파이썬을 쓴다 (다른 설치와 엮이지 않게)
    await c.run(p.uv(), ['venv', '--python', '3.12', '--python-preference', 'only-managed', p.env()], { env: uvEnv, sandboxed: box, onLine: (l) => c.progress({ text: `2/4 ${l.slice(0, 100)}` }) });
  }

  if (!fs.existsSync(p.marker())) {
    step(3, 'pyannote 설치 중 (약 1GB)');
    await c.run(p.uv(), ['pip', 'install', '--python', p.envPython(), PYANNOTE], { env: uvEnv, sandboxed: box, onLine: (l) => c.progress({ text: `3/4 ${l.slice(0, 100)}` }) });
    fs.writeFileSync(p.marker(), new Date().toISOString());
    fs.rmSync(p.uvCache(), { recursive: true, force: true }); // 설치에 쓴 내려받기 캐시(약 1GB)는 지운다
  }

  if (!c.modelReady()) {
    const token = c.token();
    if (!token) throw new Error('Hugging Face 토큰이 필요합니다. 설정 › 계정·토큰에서 넣은 뒤 다시 누르세요');
    step(4, '화자 구분 모델 받는 중 (33MB)');
    const code = `from pyannote.audio import Pipeline\nPipeline.from_pretrained(${JSON.stringify(DIARIZE_MODEL)}, token=__import__('os').environ['HF_TOKEN'])\nprint('ok')`;
    try {
      await c.run(p.envPython(), ['-I', '-c', code], { env: { ...uvEnv, HF_TOKEN: token, HF_HUB_CACHE: p.hfCache() }, sandboxed: box });
    } catch (err) {
      // 던진 것이 Error가 아니면 message가 없어 예전처럼 그대로 다시 던진다
      if (/gated|401|403|restricted|Unauthorized/i.test((err as Error).message)) throw new Error('모델 약관에 동의하지 않았거나 토큰이 맞지 않습니다. 모델 페이지에서 약관에 동의하세요');
      throw err;
    }
  }
}
