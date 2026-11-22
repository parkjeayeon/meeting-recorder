// 받아쓰기 엮기 (src/dictation/index.mts)와 Whisper 서버·엔진 상태 (server.mts)
// 임시 앱 데이터 폴더, 가짜 플랫폼, 가짜 샌드박스로 돈다. whisper-server 대신 Node로 띄운 작은 가짜 서버(--port로 듣기만 함)를 쓴다.
import { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDictation, MODEL_FILE, type Dictation, type DictationDeps, type EngineStatus } from './index.mjs';

// 가짜 whisper-server: --port 다음 값으로 127.0.0.1에서 듣는다. DELAY 밀리초 뒤에 듣기 시작하고, -pp면 진행률 줄을 낸다
const FAKE_SERVER = `
const http = require('http');
const a = process.argv;
const port = Number(a[a.indexOf('--port') + 1]);
setTimeout(() => http.createServer((q, r) => r.end('ok')).listen(port, '127.0.0.1'), Number(process.env.FAKE_DELAY || 0));
if (a.includes('-pp')) setTimeout(() => { process.stdout.write('progress = 27%\\n'); process.stderr.write('whisper: progress =  100%\\n'); }, 400);
`;

let root: string;
let userData: string;
let bin: string;
let calls: string[];
let exitFns: (() => void)[];
let wrapped: [string, string[], unknown][];
let made: Dictation[];

function make(over: Partial<DictationDeps> & { orphans?: { pid: number; command: string }[]; commandOf?: (pid: number) => string | null } = {}): Dictation {
  const { orphans = [], commandOf = () => null, ...rest } = over;
  const d = createDictation({
    userData: () => userData,
    encrypt: (s) => Buffer.from(s),
    decrypt: (b) => b.toString(),
    clipboard: { read: async () => [], write: async () => {}, writeText: async () => {}, clear: () => {} },
    ClipboardItem: class {},
    sandboxWrap: (cmd, args, opts) => {
      wrapped.push([cmd, args, opts]);
      return [process.execPath, ['-e', FAKE_SERVER, '--', ...args]];
    },
    cleanup: async (raw) => ({ text: raw, provider: null, error: null }),
    providerStatus: async (q) => ({ 'claude-code': { installed: false, loggedIn: false }, codex: { installed: false, loggedIn: false }, api: { installed: true, loggedIn: q.hasApiKey } }),
    platform: {
      paths: { whisperServer: [path.join(root, 'none'), bin], brew: [], cli: () => [], uvArchive: () => ({ url: '', dir: '' }) },
      processes: {
        orphans: () => (calls.push('orphans'), orphans),
        commandOf: (pid) => (calls.push(`commandOf ${pid}`), commandOf(pid)),
      },
      paster: { sendPaste: async () => 'pasted' },
    },
    env: {},
    homedir: () => root,
    onExit: (fn) => exitFns.push(fn),
    ...rest,
  });
  made.push(d);
  return d;
}

const putModel = () => {
  fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'models', MODEL_FILE), 'model');
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-dictation-'));
  userData = path.join(root, 'userData');
  fs.mkdirSync(userData);
  bin = path.join(root, 'whisper-server');
  fs.writeFileSync(bin, '');
  calls = [];
  exitFns = [];
  wrapped = [];
  made = [];
});
afterEach(() => {
  for (const fn of exitFns) fn(); // 띄운 가짜 서버를 내린다 (앱이 끝날 때와 같은 길)
  for (const d of made) d.stopServer();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('createDictation', () => {
  it('예전 src/dictation.js가 내보내던 이름 19개를 그대로', () => {
    expect(Object.keys(make()).sort()).toEqual(
      ['init', 'engineInstalled', 'storedSettings', 'dictate', 'paste', 'transcribe', 'transcribeSegments', 'startDedicatedServer', 'apiKey', 'hfToken', 'hfCliToken', 'tokenSources', 'cleanupProviders', 'downloadModel', 'engineStatus', 'startServer', 'stopServer', 'getSettings', 'saveSettings'].sort(),
    );
  });

  it('끝날 때 처리는 만들 때 한 번 붙인다', () => {
    make();
    expect(exitFns).toHaveLength(1);
  });

  it('whisper-server 자리: WHISPER_SERVER가 먼저, 만들 때 한 번 정한다', () => {
    const own = path.join(root, 'own-server');
    fs.writeFileSync(own, '');
    const env: NodeJS.ProcessEnv = { WHISPER_SERVER: own };
    const d = make({ env });
    expect(d.engineInstalled()).toBe(own);
    env.WHISPER_SERVER = path.join(root, 'none'); // 나중에 바꿔도 그대로
    expect(d.engineInstalled()).toBe(own);
    fs.rmSync(own);
    expect(d.engineInstalled()).toBe(bin); // 파일은 부를 때 본다 → 다음 자리
    fs.rmSync(bin);
    expect(d.engineInstalled()).toBeNull();
  });

  it('cleanupProviders는 지금 설정의 API 키 여부와 opts를 넘긴다', async () => {
    const seen: unknown[] = [];
    const d = make({ providerStatus: async (q, opts) => (seen.push([q, opts]), { 'claude-code': { installed: true, loggedIn: true }, codex: { installed: true, loggedIn: true }, api: { installed: true, loggedIn: q.hasApiKey } }) });
    await d.cleanupProviders({ fresh: true });
    d.saveSettings({ apiKey: 'sk' });
    await d.cleanupProviders();
    expect(seen).toEqual([
      [{ hasApiKey: false }, { fresh: true }],
      [{ hasApiKey: true }, undefined],
    ]);
  });
});

describe('engineStatus', () => {
  it('엔진 없음 → 모델 없음 → 멈춤', () => {
    fs.rmSync(bin);
    const d = make();
    expect(d.engineStatus()).toEqual({ state: 'no-engine' });
    fs.writeFileSync(bin, '');
    expect(d.engineStatus()).toEqual({ state: 'no-model' });
    putModel();
    expect(d.engineStatus()).toEqual({ state: 'stopped' });
  });

  it('모델을 내려받는 동안 downloading, 실패하면 던지고 원래 상태로', async () => {
    let answer: (r: Response) => void = () => {};
    const fetches: unknown[] = [];
    vi.stubGlobal('fetch', (url: unknown) => (fetches.push(url), new Promise<Response>((r) => (answer = r))));
    const d = make();
    const seen: EngineStatus[] = [];
    d.init({ onEngineStatus: (s) => seen.push(s) });
    const p = d.downloadModel();
    expect(d.engineStatus()).toEqual({ state: 'downloading', received: 0, total: 0 });
    await d.downloadModel(); // 내려받는 중엔 그냥 돌아온다
    expect(fetches).toEqual([`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`]);
    answer(new Response(null, { status: 503 }));
    await expect(p).rejects.toThrow('모델 다운로드 실패 (HTTP 503)');
    expect(d.engineStatus()).toEqual({ state: 'no-model' });
    expect(seen).toEqual([{ state: 'no-model' }, { state: 'downloading', received: 0, total: 0 }, { state: 'no-model' }]);
    expect(fs.existsSync(path.join(userData, 'models'))).toBe(true); // 폴더는 먼저 만든다
  });

  it('모델을 받다 끊기면 .part를 지우고 그 오류를 던지고 원래 상태로', async () => {
    const cut = new Error('연결이 끊김');
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 20)); // 그사이 .part가 열린다
        if (n++ < 2) c.enqueue(new Uint8Array(7));
        else c.error(cut);
      },
    });
    vi.stubGlobal('fetch', async () => new Response(stream, { headers: { 'content-length': '100' } }));
    const d = make();
    const seen: EngineStatus[] = [];
    d.init({ onEngineStatus: (s) => seen.push(s) });
    await expect(d.downloadModel()).rejects.toBe(cut);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.readdirSync(path.join(userData, 'models'))).toEqual([]); // .part가 남지 않는다
    expect(d.engineStatus()).toEqual({ state: 'no-model' });
    expect(seen.at(-1)).toEqual({ state: 'no-model' });
  });

  it('모델을 다 받으면 마지막으로 다 받은 값을 알리고, 이름을 바꾼 뒤 서버를 띄운다', async () => {
    // 두 조각이 0.3초 안에 와서 두 번째 알림은 걸러진다 → 다 받은 뒤 한 번 더 알려야 마지막 값이 6
    let n = 0;
    const two = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 20));
        if (n++ < 2) c.enqueue(new TextEncoder().encode(n === 1 ? 'mod' : 'el!'));
        else c.close();
      },
    });
    vi.stubGlobal('fetch', async (url: unknown) => (String(url).startsWith('https://') ? new Response(two, { headers: { 'content-length': '6' } }) : Promise.reject(new Error('not yet'))));
    const d = make();
    const seen: EngineStatus[] = [];
    d.init({ onEngineStatus: (s) => seen.push(s) });
    await d.downloadModel();
    expect(fs.readFileSync(path.join(userData, 'models', MODEL_FILE), 'utf8')).toBe('model!');
    const downloading = seen.filter((s) => s.state === 'downloading');
    expect(downloading.at(-1)).toEqual({ state: 'downloading', received: 6, total: 6 });
    expect(seen[seen.lastIndexOf(downloading.at(-1) as EngineStatus) + 1]).toEqual({ state: 'stopped' }); // finally의 알림
    await vi.waitFor(() => expect(d.engineStatus().state).toBe('loading')); // 그다음 서버를 띄운다
  });

  it('모델이 있으면 내려받지 않는다', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    putModel();
    await make().downloadModel();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('서버를 띄우면 loading → ready, 내리면 stopped (pid 파일도 지운다)', async () => {
    vi.stubEnv('FAKE_DELAY', '300');
    putModel();
    const d = make();
    const seen: string[] = [];
    d.init({ onEngineStatus: (s) => seen.push(s.state) });
    await vi.waitFor(() => expect(d.engineStatus().state).toBe('loading'));
    const pidFile = path.join(userData, 'whisper-server.pid');
    expect(Number(fs.readFileSync(pidFile, 'utf8'))).toBeGreaterThan(0);
    expect(d.startServer()).toBe(d.startServer()); // 시작하는 중이면 같은 약속
    const port = await d.startServer();
    expect(port).toBeGreaterThan(0);
    expect(d.engineStatus()).toEqual({ state: 'ready' });
    expect(wrapped[0]).toEqual([bin, ['-m', path.join(userData, 'models', MODEL_FILE), '--host', '127.0.0.1', '--port', String(port), '-sns', '-t', '8'], { network: 'local' }]);
    d.stopServer();
    expect(fs.existsSync(pidFile)).toBe(false);
    await vi.waitFor(() => expect(d.engineStatus()).toEqual({ state: 'stopped' }));
    expect(seen).toEqual(['loading', 'ready', 'stopped']);
  });
});

describe('init', () => {
  it('남은 pid 파일 정리 → 고아 정리 → 켜져 있으면 서버 띄우기 차례', () => {
    fs.writeFileSync(path.join(userData, 'whisper-server.pid'), '4242');
    const d = make();
    d.init({ onEngineStatus: (s) => calls.push(`status ${s.state}`) });
    expect(calls).toEqual(['commandOf 4242', 'orphans', 'status no-model']); // 모델이 없어 띄우지 못하고 상태만 알린다
    expect(fs.existsSync(path.join(userData, 'whisper-server.pid'))).toBe(false);
  });

  it('받아쓰기를 꺼 두었으면 서버를 띄우지 않는다', () => {
    putModel();
    const d = make();
    d.saveSettings({ enabled: false });
    d.init({ onEngineStatus: (s) => calls.push(`status ${s.state}`) });
    expect(calls).toEqual(['orphans']); // pid 파일이 없으면 commandOf도 없음
    expect(wrapped).toEqual([]);
  });

  it('고아 정리는 이 앱 모델 폴더를 쓰는 whisper-server만 끈다', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const models = path.join(userData, 'models');
      make({
        orphans: [
          { pid: 11, command: `/x/whisper-server -m ${models}/a.bin` },
          { pid: 12, command: '/x/whisper-server -m /elsewhere/a.bin' },
          { pid: 13, command: `/x/other -m ${models}/a.bin` },
        ],
      }).init({ onEngineStatus: () => {} });
      expect(kill.mock.calls).toEqual([[11]]);
    } finally {
      kill.mockRestore();
    }
  });

  it('고아 하나를 끄다 던져도(EPERM) 나머지는 끈다', () => {
    const killed: number[] = [];
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 21) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      killed.push(pid);
      return true;
    });
    try {
      const models = path.join(userData, 'models');
      make({
        orphans: [
          { pid: 21, command: `/x/whisper-server -m ${models}/a.bin` },
          { pid: 22, command: `/x/whisper-server -m ${models}/b.bin` },
        ],
      }).init({ onEngineStatus: () => {} });
      expect(killed).toEqual([22]);
    } finally {
      kill.mockRestore();
    }
  });
});

describe('whisper-server를 띄우지 못하면 (spawn 실패)', () => {
  const missing = (cmd: string, args: string[]): [string, string[]] => (wrapped.push([cmd, args, null]), [path.join(root, 'no-such-server'), args]);

  it('받아쓰기 서버: 까닭을 담아 거절하고, 상태를 되돌리고, pid 파일을 쓰지 않는다', async () => {
    putModel();
    const d = make({ sandboxWrap: missing });
    const seen: string[] = [];
    d.init({ onEngineStatus: (s) => seen.push(s.state) });
    const p = d.startServer();
    if (!p) throw new Error('startServer가 약속을 주지 않음');
    await expect(p).rejects.toThrow(/Whisper 서버를 띄우지 못했습니다 \(.*ENOENT/);
    expect(d.engineStatus()).toEqual({ state: 'stopped' });
    expect(seen.at(-1)).toBe('stopped');
    expect(fs.existsSync(path.join(userData, 'whisper-server.pid'))).toBe(false);
    const again = d.startServer(); // 다시 시작할 수 있다 (또 실패한다)
    expect(again).not.toBe(p);
    await again?.catch(() => {});
  });

  it('회의용 서버: 2분 기다리지 않고 바로 까닭을 담아 거절하고, 끝날 때 끌 목록에서 뺀다', async () => {
    const model = path.join(root, 'big.bin');
    fs.writeFileSync(model, '');
    const d = make({ sandboxWrap: missing });
    const kill = vi.spyOn(ChildProcess.prototype, 'kill');
    const t0 = Date.now();
    await expect(d.startDedicatedServer(model)).rejects.toThrow(/회의용 음성 인식 서버를 띄우지 못했습니다 \(.*ENOENT/);
    expect(Date.now() - t0).toBeLessThan(2000);
    for (const fn of exitFns) fn(); // 앱이 끝날 때: 띄우지 못한 것은 끄지 않는다
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
  });
});

describe('pid 파일 (같은 앱 데이터 폴더를 쓰는 두 앱)', () => {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const asServer = (pid: number) => (alive(pid) ? `/x/whisper-server -m ${path.join(userData, 'models', MODEL_FILE)}` : null);
  const pidFile = () => path.join(userData, 'whisper-server.pid');
  const pidInFile = () => (fs.existsSync(pidFile()) ? Number(fs.readFileSync(pidFile(), 'utf8')) : null);

  it('부모 앱이 살아 있는 서버는 끄지 않고 pid 파일도 그대로 둔다', () => {
    fs.writeFileSync(pidFile(), '4242');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      make({ commandOf: () => '/x/whisper-server -m /m.bin' }).init({ onEngineStatus: () => {} });
      expect(kill).not.toHaveBeenCalled();
      expect(pidInFile()).toBe(4242);
    } finally {
      kill.mockRestore();
    }
  });

  it('launchd에 맡겨진(고아) 서버만 끄고 pid 파일을 지운다', () => {
    fs.writeFileSync(pidFile(), '4242');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      make({ commandOf: () => '/x/whisper-server -m /m.bin', orphans: [{ pid: 4242, command: '/x/whisper-server -m /m.bin' }] }).init({ onEngineStatus: () => {} });
      expect(kill.mock.calls).toEqual([[4242]]);
      expect(fs.existsSync(pidFile())).toBe(false);
    } finally {
      kill.mockRestore();
    }
  });

  it('깨진 pid 파일(undefined 등)은 묻지 않고 지운다', () => {
    fs.writeFileSync(pidFile(), 'undefined');
    make().init({ onEngineStatus: () => {} });
    expect(calls.filter((c) => c.startsWith('commandOf'))).toEqual([]);
    expect(fs.existsSync(pidFile())).toBe(false);
  });

  it('먼저 띄운 앱의 pid 파일을 두 번째 앱이 덮어쓰거나 지우지 않는다 (어느 순서로 끝나도)', async () => {
    putModel();
    const a = make({ commandOf: asServer });
    a.init({ onEngineStatus: () => {} });
    await a.startServer();
    const pidA = pidInFile();
    expect(pidA).toBeGreaterThan(0);
    // 두 번째 앱(개발 모드·셀프테스트): 시작해도 A의 서버를 끄지 않고, 자기 서버를 띄워도 A의 pid를 덮어쓰지 않는다
    const b = make({ commandOf: asServer });
    b.init({ onEngineStatus: () => {} });
    await b.startServer();
    expect(alive(pidA as number)).toBe(true);
    expect(pidInFile()).toBe(pidA);
    b.stopServer(); // B가 먼저 끝나도 A의 pid 파일은 남는다
    expect(pidInFile()).toBe(pidA);
    a.stopServer();
    expect(pidInFile()).toBe(null);
  });

  it('A가 먼저 끝나면 pid 파일을 지우고, B는 남은 파일이 없어도 그대로 끝난다', async () => {
    putModel();
    const a = make({ commandOf: asServer });
    a.init({ onEngineStatus: () => {} });
    await a.startServer();
    const pidA = pidInFile();
    const b = make({ commandOf: asServer });
    b.init({ onEngineStatus: () => {} });
    await b.startServer();
    a.stopServer();
    expect(pidInFile()).toBe(null);
    b.stopServer();
    expect(pidInFile()).toBe(null);
    expect(pidA).toBeGreaterThan(0);
  });

  it('자기 서버를 다시 띄우면 자기 pid로 바꿔 쓴다', async () => {
    putModel();
    const a = make({ commandOf: asServer });
    a.init({ onEngineStatus: () => {} });
    await a.startServer();
    const first = pidInFile();
    a.stopServer();
    fs.writeFileSync(pidFile(), String(first)); // 지우기 전 상태로 (끝나는 중인 자기 서버가 적혀 있다)
    await vi.waitFor(() => expect(a.engineStatus()).toEqual({ state: 'stopped' }));
    await a.startServer();
    expect(pidInFile()).not.toBe(first);
    expect(pidInFile()).toBeGreaterThan(0);
  });
});

describe('startDedicatedServer', () => {
  it('모델 파일이 없으면 null', async () => {
    expect(await make().startDedicatedServer(path.join(root, 'none.bin'))).toBeNull();
  });

  it('-pp로 띄우고 진행률을 0~1로 넘긴다, VAD를 주면 그 인자도', async () => {
    const model = path.join(root, 'big.bin');
    fs.writeFileSync(model, '');
    const d = make();
    const seen: number[] = [];
    const srv = await d.startDedicatedServer(model, { vad: { model: '/vad.bin', threshold: 0.5, padMs: 200, minSilenceMs: 300 } });
    expect(srv?.port).toBeGreaterThan(0);
    expect(wrapped[0]?.[1]).toEqual(['-m', model, '--host', '127.0.0.1', '--port', String(srv?.port), '-sns', '-t', '8', '-pp', '--vad', '-vm', '/vad.bin', '-vt', '0.5', '-vp', '200', '-vsd', '300']);
    srv?.onProgress((p) => seen.push(p));
    await vi.waitFor(() => expect(seen.sort()).toEqual([0.27, 1])); // 표준 출력·오류 둘 다 읽는다
    srv?.stop();
  });
});
