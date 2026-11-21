// 엔진 설치·삭제: 음성 인식 엔진(whisper.cpp), 받아쓰기·회의 모델, 화자 구분 환경을 앱 안에서 설치하고 크기를 보여 준다.
// 화자 구분 환경(uv → 파이썬 → pyannote → 모델)은 샌드박스 안에서 앱 폴더에만 쓰도록 설치한다 (diarize.mts).
// src/setup.js에서 옮김 (결정 70): 자리(paths.mts), 명령 실행·내려받기(run.mts), 화자 구분 네 걸음(diarize.mts), 항목 목록·진행 상태·설치·삭제(여기).
// Electron을 가져오지 않는다 — 앱 데이터 폴더·받아쓰기(엔진 있는지·토큰·서버 켜고 끄기)·샌드박스는 createSetup에 넘긴다.
// 본체는 src/setup.js가 불러올 때 한 번 만들어 예전 이름 그대로 내보낸다.
import fs from 'node:fs';
import path from 'node:path';
import { platform as hostPlatform, type Paths, type Sandbox } from '../platform/index.mjs';
import { installDiarize } from './diarize.mjs';
import { DIARIZE_MODEL_DIR, MODELS, setupPaths, type ModelId } from './paths.mjs';
import { download, run, type RunOptions } from './run.mjs';

export type SetupId = 'engine' | 'turbo' | 'large' | 'diarize';

// 설치 중·실패한 항목의 진행 상태 (끝나면 지운다)
export interface SetupJob {
  running?: boolean;
  text?: string;
  pct?: number | null; // 0~1, 모르면 null
  error?: string | null; // 실패했을 때 오류 첫 줄 (240자까지)
}

// 설정 › 엔진·처음 설정에 보이는 한 줄
export interface SetupRow {
  id: SetupId;
  name: string;
  desc: string;
  installed: boolean;
  partial?: boolean; // 화자 구분: 환경은 있고 모델이 없다
  size: number | null; // 바이트 (없으면 받을 크기의 어림값), 엔진은 null
  removable: boolean;
  blocker?: 'brew' | 'token' | null; // 설치하려면 먼저 필요한 것 (엔진: Homebrew, 화자 구분: Hugging Face 토큰)
  job: SetupJob | null;
}

// 받아쓰기(src/dictation.js)에서 쓰는 것만
export interface SetupDictation {
  engineInstalled(): unknown; // whisper-server 자리 (없으면 null) — 참·거짓으로만 본다
  hfToken(): string | null; // 앱에 저장한 Hugging Face 토큰
  hfCliToken(): string | null; // `hf auth login`으로 저장된 토큰
  startServer(): unknown;
  stopServer(): void;
}

export interface SetupDeps {
  userData: () => string; // app.getPath('userData'), 부를 때 읽는다
  dictation: SetupDictation;
  sandbox: Pick<Sandbox, 'wrap' | 'cacheEnv'>;
  platform?: { paths: Pick<Paths, 'brew' | 'uvArchive'> }; // 시험용 (기본은 src/platform)
  fetch?: typeof fetch; // 시험용 (기본은 전역 fetch, 부를 때 읽는다)
}

export interface Setup {
  init(opts: { onStatus: (list: SetupRow[]) => void }): void;
  status(): Promise<SetupRow[]>;
  install(id: string): Promise<void>; // 기다리지 않아도 된다 — 진행은 onStatus로 알린다. 실패는 job.error로 남기고 던지지 않는다
  remove(id: string): Promise<void>; // 설치 중이거나 지울 수 없는 항목이면 던진다
}

const mb = (n: number) => `${Math.round(n / 1e6)}MB`;

async function sizeOf(target: string): Promise<number> {
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

export function createSetup(deps: SetupDeps): Setup {
  const { dictation, sandbox } = deps;
  const platform = deps.platform ?? hostPlatform;
  const BREW_CANDIDATES = platform.paths.brew;
  const root = deps.userData;
  const p = setupPaths(root);

  const jobs = new Map<string, SetupJob>(); // id → { running, text, pct, error }
  let onChange: (list: SetupRow[]) => void = () => {};

  function init({ onStatus }: { onStatus: (list: SetupRow[]) => void }): void {
    onChange = onStatus;
  }

  function set(id: string, patch: SetupJob | null): void {
    if (patch === null) jobs.delete(id);
    else jobs.set(id, { ...(jobs.get(id) ?? {}), ...patch });
    status().then(onChange);
  }

  const brewBin = () => BREW_CANDIDATES.find((b) => fs.existsSync(b)) ?? null;
  const diarizeInstalled = () => fs.existsSync(p.envPython()) && (fs.existsSync(p.marker()) || fs.existsSync(path.join(p.env(), 'lib')));
  const diarizeModelReady = () => fs.existsSync(path.join(p.hfCache(), DIARIZE_MODEL_DIR, 'snapshots'));

  async function status(): Promise<SetupRow[]> {
    const job = (id: string) => jobs.get(id) ?? null;
    const diarizeDirs = [p.env(), p.python(), p.uvCache(), p.hfCache(), path.dirname(p.uv())];
    const list: Omit<SetupRow, 'job'>[] = [
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

  const runIn = (cmd: string, args: string[], opts: RunOptions = {}) => run(cmd, args, opts, sandbox.wrap);
  const downloadTo = (url: string, dest: string, onProgress: (received: number, total: number) => void) => download(url, dest, onProgress, deps.fetch ?? fetch);

  async function installEngine(): Promise<void> {
    const brew = brewBin();
    if (!brew) throw new Error('Homebrew가 없습니다. 터미널에서 brew.sh의 설치 명령을 먼저 실행하세요');
    // Homebrew는 시스템 폴더에 설치하는 도구라 샌드박스에 넣지 않는다
    await runIn(brew, ['install', 'whisper-cpp'], {
      env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' },
      onLine: (line) => set('engine', { text: line.slice(0, 120) }),
    });
    dictation.startServer();
  }

  async function installModel(id: ModelId): Promise<void> {
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODELS[id].file}`;
    await downloadTo(url, p.model(id), (got, total) => set(id, { pct: total ? got / total : null, text: `${mb(got)}${total ? ` / ${mb(total)}` : ''}` }));
    if (id === 'turbo') dictation.startServer();
  }

  // 예전 코드처럼 평범한 객체에서 찾는다 (없는 id면 아래에서 TypeError로 실패를 남긴다)
  const INSTALLERS: Record<string, (() => Promise<void>) | undefined> = {
    engine: installEngine,
    turbo: () => installModel('turbo'),
    large: () => installModel('large'),
    diarize: () =>
      installDiarize({
        root,
        p,
        uvArchive: (arch) => platform.paths.uvArchive(arch),
        cacheEnv: (dir) => sandbox.cacheEnv(dir),
        run: runIn,
        download: downloadTo,
        progress: (patch) => set('diarize', patch),
        token: () => dictation.hfToken() ?? dictation.hfCliToken(),
        modelReady: diarizeModelReady,
      }),
  };

  async function install(id: string): Promise<void> {
    if (jobs.get(id)?.running) return;
    set(id, { running: true, text: '준비 중', pct: null, error: null });
    try {
      const installer = INSTALLERS[id];
      if (typeof installer !== 'function') throw new TypeError('INSTALLERS[id] is not a function');
      await installer.call(INSTALLERS); // INSTALLERS[id]()와 같은 this
      set(id, null);
    } catch (err) {
      // 던진 것이 Error가 아니면(message 없음) 예전처럼 여기서 TypeError가 난다
      set(id, { running: false, error: ((err as Error).message.split('\n')[0] ?? '').slice(0, 240) });
    }
  }

  async function remove(id: string): Promise<void> {
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

  return { init, status, install, remove };
}
