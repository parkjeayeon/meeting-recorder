// 다듬기·회의록에 쓰는 계정(Claude Code·Codex CLI)의 실행 파일 찾기, 실행, 로그인 확인.
// Electron을 쓰지 않는다 — 앱 데이터 폴더처럼 Electron이 아는 값은 본체가 configure()로 넘긴다 (src/cleanup.js).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliError, type CliErrorKind } from '../core/route.mjs';
import { platform } from '../platform/index.mjs'; // 실행 파일을 찾는 자리 (결정 78)

export type CliId = 'claude-code' | 'codex';
export type ProviderId = CliId | 'api';
export type LoginState = { installed: boolean; loggedIn: boolean; account?: string | null };
export type ProviderStatus = Record<ProviderId, LoginState>;

export const PROVIDERS: Record<CliId, { label: string; bins: string[] }> = {
  'claude-code': { label: 'Claude Code', bins: platform.paths.cli('claude-code') },
  codex: { label: 'Codex', bins: platform.paths.cli('codex') },
};

export function findBin(id: CliId): string | null {
  return PROVIDERS[id].bins.find((p) => fs.existsSync(p)) ?? null;
}

// 설정 파일·CLAUDE.md·MCP 서버를 읽지 않도록 빈 작업 폴더에서 실행한다. 어디에 둘지는 본체가 정한다(앱 데이터 폴더 안)
let workRoot: () => string = () => os.tmpdir();
export function setWorkRoot(get: () => string): void {
  workRoot = get;
}
export function workDir(): string {
  const dir = path.join(workRoot(), 'cleanup-cwd');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export type RunOptions = { timeout?: number; input?: string; env?: Record<string, string> | null; signal?: AbortSignal };
// CLI가 실패했을 때 던지는 오류: 기본 메시지(명령줄 전체, 지시문 포함) 대신 CLI가 낸 이유를 담는다
export type RunError = Error & { kind?: CliErrorKind; stdout?: string; stderr?: string; limit?: boolean; killed?: boolean; code?: number | string | null };

const MAX_BUFFER = 4 * 1024 * 1024;

// CLI가 낸 글(stdout·stderr)에서 이유를 꺼내 오류에 담는다. err에는 killed·signal·code가 이미 들어 있다
export function cliFailure<E extends Error & { killed?: boolean; signal?: string | null; code?: number | string | null }>(err: E, { stdout, stderr }: { stdout: string; stderr: string }): E & RunError {
  const why = cliError({ killed: err.killed, signal: err.signal, code: err.code, stdout, stderr });
  return Object.assign(err, { message: why.message, kind: why.kind, stdout, stderr, limit: why.kind === 'limit' || undefined });
}

export function run(bin: string, args: string[], { timeout, input, env, signal }: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd: workDir(), timeout, signal, maxBuffer: MAX_BUFFER, ...(env ? { env: { ...process.env, ...env } } : {}) }, (err, stdout, stderr) => {
      if (err && err.code !== 'ABORT_ERR' && err.name !== 'AbortError') reject(cliFailure(err, { stdout, stderr }));
      else if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end(); // codex exec는 stdin이 열려 있으면 입력을 기다린다
  });
}

// ── 답이 다 되면 바로 받기 (결정 80) ─────────────────────────────────────
// CLI는 답을 다 낸 뒤에도 한참 더 산다: Claude Code는 턴 요약(post_turn_summary)을 만드느라 약 2~3초, Codex는 끝내는 데 약 1초.
// 그래서 출력을 JSON 줄로 읽으며 reader가 "답이 다 됐다"고 하는 순간 돌려주고 자식 프로세스를 끝낸다.
// reader가 끝까지 정하지 못하면 예전(run)처럼 프로세스가 끝날 때를 기다린다 — 종료 코드·시간 초과·멈추기는 run과 같은 오류가 된다.
//   line: 한 줄(JSON.parse 한 값)을 받아 답이 다 됐으면 값을, 아니면 undefined를. 던지면 그 오류로 끝난다
//   text: 지금까지 받은 사람이 읽을 글 — 실패 이유를 찾을 때·끝까지 정하지 못했을 때 stdout 자리에 쓴다
export type LineReader<T> = { line: (event: unknown) => T | undefined; text: () => string };
export type LinesResult<T> = { early: true; value: T; stdout: string; stderr: string } | { early: false; stdout: string; stderr: string };
export type LinesOptions = RunOptions & { onGone?: () => void }; // onGone: 자식 프로세스가 정말 사라진 뒤 (임시 파일 지우기 등)
export const KILL_GRACE_MS = 2000; // SIGTERM 뒤 이만큼 지나도 살아 있으면 SIGKILL

type ChildError = Error & { killed?: boolean; signal?: string | null; code?: number | string | null };
const childError = (message: string, fields: { killed?: boolean; signal?: string | null; code?: number | string | null }, Kind: ErrorConstructor | RangeErrorConstructor = Error): ChildError =>
  Object.assign(new Kind(message), fields);

export function runLines<T>(bin: string, args: string[], reader: LineReader<T>, { timeout, input, env, signal, onGone }: LinesOptions = {}): Promise<LinesResult<T>> {
  return new Promise((resolve, reject) => {
    const abortError = (stderr: string) => Object.assign(new Error('The operation was aborted', { cause: signal?.reason }), { name: 'AbortError', code: 'ABORT_ERR', stderr });
    if (signal?.aborted) {
      reject(abortError(''));
      onGone?.();
      return;
    }
    const child = spawn(bin, args, { cwd: workDir(), env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let gone = false;
    let pending = ''; // 아직 줄바꿈이 오지 않은 조각
    let stderr = '';
    const loose: string[] = []; // JSON이 아닌 줄 (실패 이유에 쓴다)
    let looseSize = 0;
    let killTimer: NodeJS.Timeout | null = null;
    let timer: NodeJS.Timeout | null = null;
    const plain = () => [reader.text(), ...loose, pending.slice(0, MAX_BUFFER)].filter(Boolean).join('\n');

    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    // 자식을 끝낸다. SIGTERM을 무시해도 남지 않게 잠시 뒤 SIGKILL
    const stop = () => {
      if (gone || child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!gone) child.kill('SIGKILL');
      }, KILL_GRACE_MS);
    };
    const fail = (err: Error) => {
      stop();
      finish(() => reject(err));
    };
    const overflow = () => fail(cliFailure(childError('stdout maxBuffer length exceeded', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, RangeError), { stdout: plain(), stderr }));
    // 한 줄 처리. 답이 정해졌거나 오류로 끝났으면 true
    const take = (line: string): boolean => {
      if (!line.trim()) return false;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        loose.push(line);
        looseSize += line.length;
        if (looseSize > MAX_BUFFER) {
          overflow();
          return true;
        }
        return false;
      }
      let value: T | undefined;
      try {
        value = reader.line(event);
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
        return true;
      }
      if (value === undefined) return false;
      const answer: LinesResult<T> = { early: true, value, stdout: plain(), stderr };
      stop();
      finish(() => resolve(answer));
      return true;
    };

    const onAbort = () => fail(abortError(stderr));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeout && timeout > 0) timer = setTimeout(() => fail(cliFailure(childError('시간 초과', { killed: true, signal: 'SIGTERM', code: null }), { stdout: plain(), stderr })), timeout);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return; // 답을 받은 뒤 늦게 온 출력은 버린다
      pending += chunk;
      for (let i; (i = pending.indexOf('\n')) >= 0; ) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        if (take(line)) return;
      }
      if (pending.length > MAX_BUFFER) overflow();
    });
    child.stderr.on('data', (chunk: string) => {
      if (settled) return;
      stderr += chunk;
      if (stderr.length > MAX_BUFFER) overflow();
    });
    child.stdin.on('error', () => {}); // 입력을 다 넘기기 전에 자식이 끝나면(EPIPE) — 이유는 종료 코드·출력으로 본다
    child.on('error', (err: ChildError) => {
      // 실행하지 못함(ENOENT 등) 또는 kill 실패. 실행하지 못했으면 run과 같은 모양으로
      if (!settled) fail(cliFailure(childError(err.message, { code: err.code }), { stdout: plain(), stderr }));
    });
    child.on('close', (code: number | null, sig: NodeJS.Signals | null) => {
      gone = true;
      if (killTimer) clearTimeout(killTimer);
      child.removeAllListeners();
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.stdin.removeAllListeners();
      child.stdin.on('error', () => {});
      if (!settled && pending) {
        const last = pending;
        pending = '';
        take(last);
      }
      if (!settled) {
        if (code === 0) finish(() => resolve({ early: false, stdout: plain(), stderr }));
        else finish(() => reject(cliFailure(childError(`Command failed: ${bin}`, { killed: false, signal: sig, code }), { stdout: plain(), stderr })));
      }
      onGone?.();
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

// ── 로그인 확인 ─────────────────────────────────────────────────────────
const LOGIN_CACHE_MS = 60000;
let loginCache: { at: number; value: Record<CliId, LoginState> | null } = { at: 0, value: null };

async function checkLogin(id: CliId): Promise<LoginState> {
  const bin = findBin(id);
  if (!bin) return { installed: false, loggedIn: false };
  try {
    if (id === 'claude-code') {
      const status = JSON.parse((await run(bin, ['auth', 'status'], { timeout: 8000 })).stdout) as { loggedIn?: unknown; email?: string | null };
      return { installed: true, loggedIn: Boolean(status.loggedIn), account: status.email ?? null };
    }
    const { stdout, stderr } = await run(bin, ['login', 'status'], { timeout: 8000 });
    const out = stdout + stderr; // codex login status는 결과를 stderr로 출력한다
    return { installed: true, loggedIn: /logged in/i.test(out), account: out.trim().replace(/^Logged in using /i, '') || null };
  } catch {
    return { installed: true, loggedIn: false };
  }
}

export async function providerStatus({ hasApiKey }: { hasApiKey: boolean }, { fresh = false }: { fresh?: boolean } = {}): Promise<ProviderStatus> {
  if (fresh || !loginCache.value || Date.now() - loginCache.at > LOGIN_CACHE_MS) {
    const [claudeCode, codex] = await Promise.all([checkLogin('claude-code'), checkLogin('codex')]);
    loginCache = { at: Date.now(), value: { 'claude-code': claudeCode, codex } };
  }
  return { ...loginCache.value!, api: { installed: true, loggedIn: hasApiKey } };
}
