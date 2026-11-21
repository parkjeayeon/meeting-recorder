// Whisper 모델과 서버: 받아쓰기용 상주 서버, 회의용 서버, pid 파일·고아 정리, 모델 내려받기, 엔진 상태. src/dictation.js에서 옮김 (결정 70).
// 상태(띄운 서버·포트·내려받는 중)는 모두 createServer 안에 있다. 앱 데이터 폴더·샌드박스는 부르는 쪽이 넘기고,
// whisper-server를 찾는 자리(환경 변수 WHISPER_SERVER + 플랫폼 층의 자리)는 만들 때 한 번 정한다 (예전에 불러올 때 한 번 정하던 것과 같다).
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { SandboxOptions } from '../core/sandbox.mjs';
import type { MeetingVad } from '../core/vad.mjs';
import type { Platform } from '../platform/index.mjs';

export const MODEL_FILE = 'ggml-large-v3-turbo-q8_0.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;

export type EngineStatus =
  | { state: 'downloading'; received: number; total: number }
  | { state: 'no-engine' | 'no-model' | 'ready' | 'loading' | 'stopped' };

// 회의용 Whisper 서버 (startDedicatedServer가 돌려준다)
export interface DedicatedServer {
  port: number;
  stop(): void;
  onProgress(cb: ((p: number) => void) | null): void; // 받아쓰는 도중 0~1
}

export type SandboxWrap = (cmd: string, args: string[], opts: SandboxOptions) => [string, string[]];

export interface ServerDeps {
  userData: () => string; // app.getPath('userData'), 부를 때 읽는다
  sandboxWrap: SandboxWrap; // sandbox.wrap (부를 때 그 모듈에서 찾는다)
  platform: Pick<Platform, 'processes'>;
  candidates: readonly string[]; // whisper-server를 찾는 자리, 앞에서부터
  onExit: (fn: () => void) => void; // process.on('exit', fn) — 만들 때 한 번 붙인다
}

export interface WhisperServer {
  setOnStatus(fn: (s: EngineStatus) => void): void; // init이 넘긴 onEngineStatus
  port(): number | null; // 받아쓰기 서버가 준비됐으면 그 포트
  whisperServerBin(): string | null;
  engineStatus(): EngineStatus;
  downloadModel(): Promise<void>;
  killStaleServer(): void;
  killOrphanServers(): void;
  startServer(): Promise<number> | null;
  stopServer(): void;
  startDedicatedServer(modelFile: string, opts?: { vad?: MeetingVad | null }): Promise<DedicatedServer | null>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo; // TCP로 듣고 있으면 언제나 AddressInfo
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export function createServer(deps: ServerDeps): WhisperServer {
  let serverProc: ChildProcess | null = null;
  let serverPort: number | null = null;
  let serverReady: Promise<number> | null = null;
  let download: { received: number; total: number } | null = null; // 내려받는 동안
  let onStatus: (s: EngineStatus) => void = () => {};

  function modelPath(): string {
    return path.join(deps.userData(), 'models', MODEL_FILE);
  }

  function whisperServerBin(): string | null {
    return deps.candidates.find((p) => fs.existsSync(p)) ?? null;
  }

  function engineStatus(): EngineStatus {
    if (download) return { state: 'downloading', ...download };
    if (!whisperServerBin()) return { state: 'no-engine' };
    if (!fs.existsSync(modelPath())) return { state: 'no-model' };
    if (serverPort) return { state: 'ready' };
    return { state: serverProc ? 'loading' : 'stopped' };
  }

  function emit(): void {
    onStatus(engineStatus());
  }

  async function downloadModel(): Promise<void> {
    if (download || fs.existsSync(modelPath())) return;
    const dest = modelPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const progress = { received: 0, total: 0 };
    download = progress;
    emit();
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`모델 다운로드 실패 (HTTP ${res.status})`);
      progress.total = Number(res.headers.get('content-length')) || 0;
      const out = fs.createWriteStream(`${dest}.part`);
      let lastEmit = 0;
      // 성공한 GET 응답은 몸이 있다. 없으면 예전처럼 for await가 TypeError를 던진다
      for await (const chunk of res.body as ReadableStream<Uint8Array>) {
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r())); // drain은 인자가 없다
        progress.received += chunk.length;
        if (Date.now() - lastEmit > 300) {
          lastEmit = Date.now();
          emit();
        }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      fs.renameSync(`${dest}.part`, dest);
    } finally {
      download = null;
      emit();
    }
    startServer();
  }

  // 앱이 강제 종료되면 서버가 고아로 남아 메모리(약 1GB)를 계속 차지하므로 pid를 기록해 두고 다음 실행 때 정리한다
  function pidFile(): string {
    return path.join(deps.userData(), 'whisper-server.pid');
  }

  // 회의용 서버는 회의록을 만드는 동안만 띄우는데, 앱이 그 사이에 꺼지면 고아로 남아 메모리를 차지한다.
  // 띄운 것을 기억해 두었다가 앱이 끝날 때 함께 내리고, 시작할 때는 이 앱 모델을 쓰는 고아 서버를 정리한다.
  const dedicated = new Set<ChildProcess>();

  // SIGTERM 등으로 before-quit 없이 끝나는 경우도 서버를 남기지 않는다
  deps.onExit(() => {
    serverProc?.kill();
    for (const proc of dedicated) proc.kill();
  });

  function killOrphanServers(): void {
    try {
      const orphans = deps.platform.processes.orphans();
      const models = path.join(deps.userData(), 'models');
      for (const { pid, command } of orphans) {
        if (command.includes('whisper-server') && command.includes(models)) process.kill(pid);
      }
    } catch {}
  }

  function killStaleServer(): void {
    try {
      const pid = Number(fs.readFileSync(pidFile(), 'utf8'));
      const cmd = deps.platform.processes.commandOf(pid);
      if (cmd?.includes('whisper-server')) process.kill(pid);
    } catch {}
    fs.rmSync(pidFile(), { force: true });
  }

  // 모델을 메모리에 올려 둔 채로 서버를 띄워 두어야 손을 뗀 뒤 바로 결과가 나온다
  function startServer(): Promise<number> | null {
    if (serverReady) return serverReady; // 이미 시작했거나 시작하는 중
    const bin = whisperServerBin();
    if (!bin || !fs.existsSync(modelPath())) {
      emit();
      return null;
    }
    const ready = (async () => {
      const port = await freePort();
      // 샌드박스: 이 컴퓨터 안(127.0.0.1) 연결만, 쓰기는 임시 폴더만 → 받아쓰기 음성이 밖으로 나갈 길이 없다
      const [cmd, args] = deps.sandboxWrap(bin, ['-m', modelPath(), '--host', '127.0.0.1', '--port', String(port), '-sns', '-t', '8'], { network: 'local' });
      const proc = spawn(cmd, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      serverProc = proc;
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
    serverReady = ready;
    ready.catch(() => {
      serverProc?.kill();
      serverReady = null;
      emit();
    });
    return ready;
  }

  function stopServer(): void {
    serverProc?.kill();
    fs.rmSync(pidFile(), { force: true });
  }

  // 회의용 고성능 서버: 지정한 모델로 따로 띄우고, 다 쓰면 stop()으로 내린다 (받아쓰기 서버는 그대로 둔다)
  // -pp: 받아쓰는 도중 "progress = 27%"를 출력한다 → onProgress(cb)로 받은 콜백에 0~1로 넘긴다
  // vad: { model, threshold, padMs, minSilenceMs }를 주면 말소리 구간만 받아쓴다 (재 보기용 개발자 스위치, core/vad.mts). 안 주면 지금과 같다
  async function startDedicatedServer(modelFile: string, { vad = null }: { vad?: MeetingVad | null } = {}): Promise<DedicatedServer | null> {
    const bin = whisperServerBin();
    if (!bin || !fs.existsSync(modelFile)) return null;
    const port = await freePort();
    const args = ['-m', modelFile, '--host', '127.0.0.1', '--port', String(port), '-sns', '-t', '8', '-pp'];
    if (vad) args.push('--vad', '-vm', vad.model, '-vt', String(vad.threshold), '-vp', String(vad.padMs), '-vsd', String(vad.minSilenceMs));
    const [cmd, wrapped] = deps.sandboxWrap(bin, args, { network: 'local' });
    const proc = spawn(cmd, wrapped, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let progressCb: ((p: number) => void) | null = null;
    const parse = (chunk: unknown) => {
      for (const m of String(chunk).matchAll(/progress =\s*(\d+)%/g)) progressCb?.(Number(m[1]) / 100);
    };
    proc.stdout.on('data', parse);
    proc.stderr.on('data', parse);
    dedicated.add(proc);
    proc.on('exit', () => dedicated.delete(proc));
    const stop = () => proc.kill();
    const onProgress = (cb: ((p: number) => void) | null) => (progressCb = cb);
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

  return {
    setOnStatus: (fn) => {
      onStatus = fn;
    },
    port: () => serverPort,
    whisperServerBin,
    engineStatus,
    downloadModel,
    killStaleServer,
    killOrphanServers,
    startServer,
    stopServer,
    startDedicatedServer,
  };
}
