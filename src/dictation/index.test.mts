// 받아쓰기 엮기 (src/dictation/index.mts)와 Whisper 서버·엔진 상태 (server.mts)
// 임시 앱 데이터 폴더, 가짜 플랫폼, 가짜 샌드박스로 돈다. whisper-server 대신 Node로 띄운 작은 가짜 서버(--port로 듣기만 함)를 쓴다.
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

function make(over: Partial<DictationDeps> & { orphans?: { pid: number; command: string }[] } = {}): Dictation {
  const { orphans = [], ...rest } = over;
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
        commandOf: (pid) => (calls.push(`commandOf ${pid}`), null),
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
