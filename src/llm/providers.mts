// 다듬기·회의록에 쓰는 계정(Claude Code·Codex CLI)의 실행 파일 찾기, 실행, 로그인 확인.
// Electron을 쓰지 않는다 — 앱 데이터 폴더처럼 Electron이 아는 값은 본체가 configure()로 넘긴다 (src/cleanup.js).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliError, type CliErrorKind } from '../core/route.mjs';

export type CliId = 'claude-code' | 'codex';
export type ProviderId = CliId | 'api';
export type LoginState = { installed: boolean; loggedIn: boolean; account?: string | null };
export type ProviderStatus = Record<ProviderId, LoginState>;

export const PROVIDERS: Record<CliId, { label: string; bins: string[] }> = {
  'claude-code': { label: 'Claude Code', bins: ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude')] },
  codex: { label: 'Codex', bins: ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(os.homedir(), '.local/bin/codex')] },
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

export function run(bin: string, args: string[], { timeout, input, env, signal }: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd: workDir(), timeout, signal, maxBuffer: 4 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) }, (err, stdout, stderr) => {
      if (err && err.code !== 'ABORT_ERR' && err.name !== 'AbortError') {
        const why = cliError({ killed: err.killed, signal: err.signal, code: err.code, stdout, stderr });
        reject(Object.assign(err, { message: why.message, kind: why.kind, stdout, stderr, limit: why.kind === 'limit' || undefined }));
      } else if (err) reject(Object.assign(err, { stderr }));
      else resolve({ stdout, stderr });
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end(); // codex exec는 stdin이 열려 있으면 입력을 기다린다
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
