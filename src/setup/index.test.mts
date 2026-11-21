// 엔진 설치 항목 목록·진행 상태·삭제 (src/setup/index.mts, 결정 70)
// 임시 앱 데이터 폴더와 가짜 받아쓰기·가짜 Homebrew(셸 스크립트)·가짜 fetch로 — 네트워크·실제 Homebrew·uv는 쓰지 않는다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSetup, type SetupDeps, type SetupDictation, type SetupRow } from './index.mjs';

let dir: string;
let userData: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-setup-test-'));
  userData = path.join(dir, 'userData');
  fs.mkdirSync(userData);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

interface FakeDictation extends SetupDictation {
  engine: string | null;
  token: string | null;
  cliToken: string | null;
  started: number;
  stopped: number;
}

function fakeDictation(over: Partial<Pick<FakeDictation, 'engine' | 'token' | 'cliToken'>> = {}): FakeDictation {
  const d: FakeDictation = {
    engine: null,
    token: null,
    cliToken: null,
    started: 0,
    stopped: 0,
    ...over,
    engineInstalled: () => d.engine,
    hfToken: () => d.token,
    hfCliToken: () => d.cliToken,
    startServer: () => {
      d.started++;
      return null;
    },
    stopServer: () => {
      d.stopped++;
    },
  };
  return d;
}

const noBrew = path.join('/nonexistent', 'mr-setup-test', 'brew');

function make(over: { dictation?: FakeDictation; fetch?: typeof fetch; brew?: string[] } = {}) {
  const dictation = over.dictation ?? fakeDictation();
  const deps: SetupDeps = {
    userData: () => userData,
    dictation,
    sandbox: { wrap: (cmd, args) => [cmd, args], cacheEnv: () => ({}) },
    platform: {
      paths: {
        brew: over.brew ?? [noBrew],
        uvArchive: () => {
          throw new Error('시험에서는 uv를 받지 않는다');
        },
      },
    },
    fetch: over.fetch ?? (async () => {
      throw new Error('시험에서는 네트워크를 쓰지 않는다');
    }),
  };
  const setup = createSetup(deps);
  const seen: SetupRow[][] = [];
  setup.init({ onStatus: (list) => seen.push(list) });
  return { setup, dictation, seen };
}

const write = (rel: string, bytes = 0) => {
  const file = path.join(userData, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes));
  return file;
};
const exists = (rel: string) => fs.existsSync(path.join(userData, rel));
const row = (list: SetupRow[], id: string) => {
  const r = list.find((x) => x.id === id);
  if (!r) throw new Error(`${id} 줄이 없다`);
  return r;
};

// 가짜 Homebrew: 받은 인자를 적어 두고 줄 하나를 내고 끝 코드 code로 끝난다
function fakeBrew(code = 0, lastLine = '==> Pouring whisper-cpp') {
  const file = path.join(dir, 'brew');
  fs.writeFileSync(file, `#!/bin/sh\necho "$@" > "${path.join(dir, 'brew-args')}"\nenv > "${path.join(dir, 'brew-env')}"\necho "${lastLine}"\nexit ${code}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

// 기다리다가 풀어 줄 수 있는 fetch
function heldFetch(body = 'model-bytes') {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    await gate;
    return new Response(body, { headers: { 'content-length': String(body.length) } });
  };
  return { fetchImpl, calls, release: () => release() };
}

describe('status: 네 줄', () => {
  it('엔진·받아쓰기 모델·회의 모델·화자 구분 차례, 아무것도 없으면 어림 크기', async () => {
    const { setup } = make();
    const list = await setup.status();
    expect(list.map((r) => r.id)).toEqual(['engine', 'turbo', 'large', 'diarize']);
    expect(list).toEqual([
      { id: 'engine', name: '음성 인식 엔진', desc: 'whisper.cpp (Homebrew로 설치)', installed: false, size: null, removable: false, blocker: 'brew', job: null },
      { id: 'turbo', name: '받아쓰기 모델', desc: 'Whisper large-v3-turbo · fn 받아쓰기에 씀', installed: false, size: 874e6, removable: true, job: null },
      { id: 'large', name: '회의 모델', desc: 'Whisper large-v3 · 회의 녹취에 씀 (없으면 받아쓰기 모델로 녹취)', installed: false, size: 3.1e9, removable: true, job: null },
      { id: 'diarize', name: '화자 구분', desc: 'pyannote · 파이썬 환경과 모델을 샌드박스 안에서 설치', installed: false, partial: false, size: 1.2e9, removable: true, blocker: 'token', job: null },
    ]);
  });

  it('엔진: 설치돼 있으면 installed, 없으면 Homebrew가 있을 때만 막힘이 없다', async () => {
    expect(row(await make({ dictation: fakeDictation({ engine: '/x/whisper-server' }) }).setup.status(), 'engine')).toMatchObject({ installed: true, blocker: null });
    expect(row(await make().setup.status(), 'engine')).toMatchObject({ installed: false, blocker: 'brew' });
    const brew = fakeBrew();
    expect(row(await make({ brew: [noBrew, brew] }).setup.status(), 'engine')).toMatchObject({ installed: false, blocker: null });
  });

  it('모델: 파일이 있으면 installed와 실제 크기, 빈 파일이면 어림 크기', async () => {
    write('models/ggml-large-v3-turbo-q8_0.bin', 1234);
    write('models/ggml-large-v3.bin', 0);
    const list = await make().setup.status();
    expect(row(list, 'turbo')).toMatchObject({ installed: true, size: 1234 });
    expect(row(list, 'large')).toMatchObject({ installed: true, size: 3.1e9 });
  });

  it('화자 구분: 환경(파이썬 + 표시 파일이나 lib)과 모델이 다 있어야 installed, 환경만 있으면 partial', async () => {
    write('diarize-env/bin/python', 10);
    let r = row(await make().setup.status(), 'diarize');
    expect(r).toMatchObject({ installed: false, partial: false }); // 표시 파일도 lib도 없다

    fs.mkdirSync(path.join(userData, 'diarize-env', 'lib'));
    r = row(await make().setup.status(), 'diarize');
    expect(r).toMatchObject({ installed: false, partial: true });

    fs.rmSync(path.join(userData, 'diarize-env', 'lib'), { recursive: true });
    write('diarize-env/.installed', 5);
    expect(row(await make().setup.status(), 'diarize')).toMatchObject({ installed: false, partial: true });

    fs.mkdirSync(path.join(userData, 'hf-cache', 'models--pyannote--speaker-diarization-community-1', 'snapshots'), { recursive: true });
    expect(row(await make().setup.status(), 'diarize')).toMatchObject({ installed: true, partial: false, blocker: null });
  });

  it('화자 구분 크기: 환경·파이썬·uv 캐시·HF 캐시·bin을 더한다 (앱 폴더의 다른 것은 빼고)', async () => {
    write('diarize-env/bin/python', 100);
    write('python/cpython/lib.so', 20);
    write('uv-cache/a', 3);
    write('hf-cache/b', 4);
    write('bin/uv', 5);
    write('tmp/c', 1000);
    write('models/ggml-large-v3.bin', 1000);
    expect(row(await make().setup.status(), 'diarize').size).toBe(132);
  });

  it('화자 구분 막힘: 토큰(앱·hf 명령)이 하나도 없고 모델도 없을 때만 token', async () => {
    expect(row(await make().setup.status(), 'diarize').blocker).toBe('token');
    expect(row(await make({ dictation: fakeDictation({ token: 'hf_app' }) }).setup.status(), 'diarize').blocker).toBe(null);
    expect(row(await make({ dictation: fakeDictation({ cliToken: 'hf_cli' }) }).setup.status(), 'diarize').blocker).toBe(null);
    fs.mkdirSync(path.join(userData, 'hf-cache', 'models--pyannote--speaker-diarization-community-1', 'snapshots'), { recursive: true });
    expect(row(await make().setup.status(), 'diarize').blocker).toBe(null);
  });

  it('앱 데이터 폴더는 부를 때마다 읽는다', async () => {
    const { setup } = make();
    const other = path.join(dir, 'other');
    fs.mkdirSync(path.join(other, 'models'), { recursive: true });
    fs.writeFileSync(path.join(other, 'models', 'ggml-large-v3.bin'), Buffer.alloc(7));
    userData = other;
    expect(row(await setup.status(), 'large')).toMatchObject({ installed: true, size: 7 });
  });
});

describe('install: 진행 상태', () => {
  it('설치 중이면 running, 끝나면 지우고 onStatus로 알린다 (받아쓰기 모델은 서버를 켠다)', async () => {
    const held = heldFetch('abc');
    const { setup, dictation, seen } = make({ fetch: held.fetchImpl });
    const done = setup.install('turbo');
    expect(row(await setup.status(), 'turbo').job).toEqual({ running: true, text: '준비 중', pct: null, error: null });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(row(seen[0] ?? [], 'turbo').job).toMatchObject({ running: true });

    held.release();
    await done;
    expect(held.calls).toEqual(['https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin']);
    expect(fs.readFileSync(path.join(userData, 'models', 'ggml-large-v3-turbo-q8_0.bin'), 'utf8')).toBe('abc');
    expect(exists('models/ggml-large-v3-turbo-q8_0.bin.part')).toBe(false);
    expect(dictation.started).toBe(1);
    expect(row(await setup.status(), 'turbo')).toMatchObject({ installed: true, job: null });
    await vi.waitFor(() => expect(row(seen.at(-1) ?? [], 'turbo').job).toBe(null));
  });

  it('회의 모델은 서버를 켜지 않는다', async () => {
    const held = heldFetch();
    const { setup, dictation } = make({ fetch: held.fetchImpl });
    held.release();
    await setup.install('large');
    expect(exists('models/ggml-large-v3.bin')).toBe(true);
    expect(dictation.started).toBe(0);
  });

  it('설치 중에 다시 누르면 무시한다', async () => {
    const held = heldFetch();
    const { setup } = make({ fetch: held.fetchImpl });
    const first = setup.install('turbo');
    await setup.install('turbo'); // 곧바로 끝난다
    held.release();
    await first;
    expect(held.calls).toHaveLength(1);
  });

  it('실패하면 running을 끄고 오류 첫 줄(240자까지)을 남긴다', async () => {
    const long = 'x'.repeat(300);
    const { setup, seen } = make({
      fetch: async () => {
        throw new Error(`${long}\n둘째 줄`);
      },
    });
    await setup.install('turbo');
    const job = row(await setup.status(), 'turbo').job;
    expect(job).toEqual({ running: false, text: '준비 중', pct: null, error: 'x'.repeat(240) });
    await vi.waitFor(() => expect(row(seen.at(-1) ?? [], 'turbo').job?.error).toBe('x'.repeat(240)));
  });

  it('HTTP 오류는 상태 코드를 남긴다', async () => {
    const { setup } = make({ fetch: async () => new Response('no', { status: 404 }) });
    await setup.install('large');
    expect(row(await setup.status(), 'large').job?.error).toBe('다운로드 실패 (HTTP 404)');
  });

  it('실패한 뒤 다시 누르면 오류를 지우고 다시 설치한다', async () => {
    let fail = true;
    const { setup } = make({
      fetch: async () => {
        if (fail) throw new Error('끊김');
        return new Response('ok');
      },
    });
    await setup.install('large');
    expect(row(await setup.status(), 'large').job?.error).toBe('끊김');
    fail = false;
    await setup.install('large');
    expect(row(await setup.status(), 'large')).toMatchObject({ installed: true, job: null });
  });

  it('엔진: Homebrew가 없으면 그 안내로 실패한다', async () => {
    const { setup, dictation } = make();
    await setup.install('engine');
    expect(row(await setup.status(), 'engine').job?.error).toBe('Homebrew가 없습니다. 터미널에서 brew.sh의 설치 명령을 먼저 실행하세요');
    expect(dictation.started).toBe(0);
  });

  it('엔진: brew install whisper-cpp를 자동 업데이트 없이 돌리고 서버를 켠다', async () => {
    const brew = fakeBrew();
    const { setup, dictation, seen } = make({ brew: [noBrew, brew] });
    await setup.install('engine');
    expect(fs.readFileSync(path.join(dir, 'brew-args'), 'utf8').trim()).toBe('install whisper-cpp');
    const env = fs.readFileSync(path.join(dir, 'brew-env'), 'utf8');
    expect(env).toMatch(/^HOMEBREW_NO_AUTO_UPDATE=1$/m);
    expect(env).toMatch(/^HOMEBREW_NO_INSTALL_CLEANUP=1$/m);
    expect(dictation.started).toBe(1);
    expect(row(await setup.status(), 'engine').job).toBe(null);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('엔진: brew가 실패하면 마지막 줄을 남긴다', async () => {
    const brew = fakeBrew(1, 'Error: no bottle available');
    const { setup, dictation } = make({ brew: [brew] });
    await setup.install('engine');
    expect(row(await setup.status(), 'engine').job).toMatchObject({ running: false, error: 'Error: no bottle available' });
    expect(dictation.started).toBe(0);
  });

  it('화자 구분: 토큰이 없으면 (환경이 이미 있을 때) 모델 걸음에서 안내로 실패한다', async () => {
    write('bin/uv', 1);
    write('diarize-env/bin/python', 1);
    write('diarize-env/.installed', 1);
    const { setup } = make();
    await setup.install('diarize');
    expect(row(await setup.status(), 'diarize').job).toMatchObject({ running: false, error: 'Hugging Face 토큰이 필요합니다. 설정 › 계정·토큰에서 넣은 뒤 다시 누르세요' });
  });

  it('없는 항목도 던지지 않고 끝난다 (실패는 목록에 없는 줄에 남는다)', async () => {
    const { setup } = make();
    await expect(setup.install('nope')).resolves.toBeUndefined();
    expect((await setup.status()).map((r) => r.job)).toEqual([null, null, null, null]); // 목록에는 안 보인다
    await expect(setup.remove('nope')).rejects.toThrow('지울 수 없는 항목입니다');
  });
});

describe('remove', () => {
  it('설치 중에는 지우지 않는다', async () => {
    const held = heldFetch();
    const { setup, dictation } = make({ fetch: held.fetchImpl });
    const done = setup.install('turbo');
    await expect(setup.remove('turbo')).rejects.toThrow('설치 중에는 지울 수 없습니다');
    expect(dictation.stopped).toBe(0);
    held.release();
    await done;
  });

  it('지울 수 없는 항목(엔진·모르는 것)은 거절한다', async () => {
    const { setup } = make();
    await expect(setup.remove('engine')).rejects.toThrow('지울 수 없는 항목입니다');
    await expect(setup.remove('whatever')).rejects.toThrow('지울 수 없는 항목입니다');
  });

  it('받아쓰기 모델: 서버를 멈추고 그 파일만 지운다', async () => {
    write('models/ggml-large-v3-turbo-q8_0.bin', 3);
    write('models/ggml-large-v3.bin', 3);
    const { setup, dictation } = make();
    await setup.remove('turbo');
    expect(dictation.stopped).toBe(1);
    expect(exists('models/ggml-large-v3-turbo-q8_0.bin')).toBe(false);
    expect(exists('models/ggml-large-v3.bin')).toBe(true);
  });

  it('회의 모델: 그 파일만 지우고 서버는 그대로', async () => {
    write('models/ggml-large-v3-turbo-q8_0.bin', 3);
    write('models/ggml-large-v3.bin', 3);
    const { setup, dictation } = make();
    await setup.remove('large');
    expect(dictation.stopped).toBe(0);
    expect(exists('models/ggml-large-v3.bin')).toBe(false);
    expect(exists('models/ggml-large-v3-turbo-q8_0.bin')).toBe(true);
  });

  it('없는 파일을 지워도 괜찮다', async () => {
    await expect(make().setup.remove('large')).resolves.toBeUndefined();
  });

  it('화자 구분: 환경·파이썬·uv 캐시·HF 캐시·bin·tmp를 지우고 모델과 다른 파일은 남긴다', async () => {
    for (const f of ['diarize-env/bin/python', 'python/x', 'uv-cache/x', 'hf-cache/x', 'bin/uv', 'tmp/x', 'models/ggml-large-v3.bin', 'settings.json']) write(f, 1);
    const { setup, dictation } = make();
    await setup.remove('diarize');
    for (const d of ['diarize-env', 'python', 'uv-cache', 'hf-cache', 'bin', 'tmp']) expect(exists(d)).toBe(false);
    expect(exists('models/ggml-large-v3.bin')).toBe(true);
    expect(exists('settings.json')).toBe(true);
    expect(dictation.stopped).toBe(0);
  });

  it('지운 뒤 진행 상태(실패 기록)를 지우고 onStatus로 알린다', async () => {
    const { setup, seen } = make({
      fetch: async () => {
        throw new Error('끊김');
      },
    });
    await setup.install('large');
    expect(row(await setup.status(), 'large').job?.error).toBe('끊김');
    await setup.remove('large');
    expect(row(await setup.status(), 'large').job).toBe(null);
    await vi.waitFor(() => expect(row(seen.at(-1) ?? [], 'large').job).toBe(null));
  });
});
