// 로그인된 계정으로 LLM을 한 번 부른다. 받아쓰기 다듬기·회의록 작성·질문으로 찾기가 함께 쓴다.
// 자동: Claude Code(가장 빠름, 한 문장 약 2.6~3.4초) → Codex(약 3.3~5.5초) → API 키. 로그인된 것만, 쓸 순서대로.
// 둘 다 로그인돼 있고 Claude Code 사용량이 90% 이상이면(창 하나라도) Codex 사용량을 보고 90% 미만이면 Codex를 앞에 둔다 (결정 53).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { orderProviders, isLimitText, withFallback as tryInOrder } from '../core/route.mjs';
import { claudeReader, codexReader, type Answer } from './events.mjs';
import { cliFailure, findBin, providerStatus, runLines, type LinesResult, type ProviderId } from './providers.mjs';

const API_MODEL = 'claude-opus-5-5';
export const TIMEOUT_MS: Record<ProviderId, number> = { 'claude-code': 25000, codex: 30000, api: 15000 };

export type Effort = 'low' | 'medium' | 'high';
export type Choice = ProviderId | 'auto';
export type CallOptions = { system: string; input: string; effort: Effort; timeout: number; apiKey?: string | null; maxTokens?: number; cache?: boolean; signal?: AbortSignal };

// 사용량(자동 계정 고르기·한도에 걸린 계정 표시)은 usage.mts가 맡는다. usage.mts가 이 모듈의 complete를 쓰므로
// 서로 가져오지 않게 index.mts가 여기에 끼워 넣는다 — 끼우지 않으면 사용량을 모르는 것으로 본다(시험)
export type UsageHooks = {
  usedForRouting: (loggedIn: string[]) => Promise<{ claudeUsed: number | null; codexUsed: number | null }>;
  markExhausted: (id: string) => void;
};
let usageHooks: UsageHooks = { usedForRouting: async () => ({ claudeUsed: null, codexUsed: null }), markExhausted: () => {} };
export function setUsageHooks(hooks: UsageHooks): void {
  usageHooks = hooks;
}

// 사용량은 토큰 없이 읽어 5분 저장한다 — 받아쓰기를 기다리게 하지 않도록 Claude Code는 저장된 값만 보고 오래됐으면 뒤에서 다시 읽는다
export async function providerOrder(choice: Choice, ctx: { hasApiKey: boolean }): Promise<ProviderId[]> {
  const status = await providerStatus(ctx);
  if (choice !== 'auto') return status[choice]?.loggedIn ? [choice] : [];
  const loggedIn = (Object.keys(status) as ProviderId[]).filter((id) => status[id]?.loggedIn);
  const { claudeUsed, codexUsed } = await usageHooks.usedForRouting(loggedIn);
  return orderProviders(loggedIn, claudeUsed, codexUsed);
}

// 사용 한도에 걸린 답 (Claude Code는 한도에 걸리면 답 대신 이 문구를 내고 정상 종료하기도 한다 — 그대로 붙여 넣지 않게 오류로 바꾼다)
function checkLimitText(text: string): string {
  if (isLimitText(text)) throw Object.assign(new Error(text.split('\n')[0]), { limit: true });
  return text;
}
// 자동일 때: 한도에 걸린 계정은 5분 동안 '다 씀'으로 두고 다음 계정으로 같은 요청을 다시 보낸다
export const withFallback = <T,>(order: readonly string[], fn: (id: ProviderId) => Promise<T>) => tryInOrder(order, (id) => fn(id as ProviderId), (id) => usageHooks.markExhausted(id));

// ── 공급자별 호출 (입력은 stdin으로 넘겨 긴 녹취도 명령줄 길이 제한에 걸리지 않게 한다) ──
// CLI 출력은 JSON 줄(Claude Code stream-json, Codex --json)로 받아 턴이 끝나는 순간 답을 쓴다 — 이벤트 모양은 events.mts
// cache: false면 캐시를 만들지 않는다 — 다시 읽을 일 없는 호출은 캐시를 만드는 값(보통 입력보다 비쌈)만 든다 (결정 51)
// 답이 다 되면(턴이 끝나면) 바로 받고 프로세스는 끝낸다 — 프로세스가 끝나기를 기다리면 Claude Code는 2~3초, Codex는 약 1초 더 걸린다 (결정 80)
// CLI가 실패를 알리면(Claude Code result의 is_error, Codex turn.failed) 실패한 종료와 같은 오류로 바꾼다
function answerOf(out: LinesResult<Answer>, fallback: () => string): string {
  if (!out.early) return checkLimitText(fallback().trim());
  if (!out.value.ok) throw cliFailure(Object.assign(new Error('CLI가 실패를 알렸습니다'), { killed: false, signal: null, code: 1 }), { stdout: out.value.text, stderr: out.stderr });
  return checkLimitText(out.value.text.trim());
}

async function viaClaudeCode({ system, input, effort, timeout, cache = true, signal }: CallOptions): Promise<string> {
  const out = await runLines(findBin('claude-code')!, [
    '-p',
    '--model', 'opus',
    '--effort', effort,
    '--system-prompt', system,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  ], claudeReader(), { timeout, input, signal, env: cache ? null : { DISABLE_PROMPT_CACHING: '1' } });
  return answerOf(out, () => out.stdout); // 끝까지 정하지 못했으면 result 글(없으면 받은 글)
}

async function viaCodex({ system, input, effort, timeout, signal }: CallOptions): Promise<string> {
  const outFile = path.join(os.tmpdir(), `mr-codex-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const removeOut = () => fs.rmSync(outFile, { force: true });
  let finished = false; // 답을 받았거나 실패한 뒤 — 그 뒤에 사라지는 Codex가 파일을 쓰더라도 지운다 (끝나기를 기다린 경우엔 아직 읽어야 하므로 지우지 않는다)
  try {
    const out = await runLines(findBin('codex')!, [
      'exec', '--skip-git-repo-check', '--ephemeral',
      '-s', 'read-only',
      '-c', `model_reasoning_effort=${effort}`,
      '--json',
      '-o', outFile, // turn.completed를 못 봤을 때 예전처럼 이 파일을 읽는다
      '-', // 프롬프트를 stdin에서 읽는다
    ], codexReader(), { timeout, signal, input: `${system}\n\n${input}`, onGone: () => finished && removeOut() });
    return answerOf(out, () => fs.readFileSync(outFile, 'utf8'));
  } finally {
    finished = true;
    removeOut();
  }
}

async function viaApi({ system, input, effort, timeout, apiKey, maxTokens = 4096, signal }: CallOptions): Promise<string> {
  const client = new Anthropic({ apiKey, timeout, maxRetries: 0 });
  const stream = client.beta.messages.stream({
    model: API_MODEL,
    max_tokens: maxTokens,
    output_config: { effort },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: input }],
  }, { signal });
  const response = await stream.finalMessage();
  if (response.stop_reason === 'refusal') return '';
  return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
}

export const CALLERS: Record<ProviderId, (o: CallOptions) => Promise<string>> = { 'claude-code': viaClaudeCode, codex: viaCodex, api: viaApi };

export type CompleteOptions = {
  system: string;
  input: string;
  choice: Choice;
  apiKey?: string | null;
  effort?: Effort;
  timeouts?: Record<ProviderId, number>;
  maxTokens?: number;
  cache?: boolean;
  signal?: AbortSignal; // 멈추기 — CLI 자식 프로세스를 끝내고 API 요청을 끊는다
};

export async function complete({ system, input, choice, apiKey, effort = 'low', timeouts = TIMEOUT_MS, maxTokens = 4096, cache = true, signal }: CompleteOptions): Promise<{ text: string; provider: string }> {
  const order = await providerOrder(choice, { hasApiKey: Boolean(apiKey) });
  if (!order.length) throw Object.assign(new Error('로그인된 Claude Code·Codex 계정이나 API 키가 없습니다'), { noProvider: true });
  const { value: text, provider } = await withFallback(order, (id) => CALLERS[id]({ system, input, effort, timeout: timeouts[id], apiKey, maxTokens, cache, signal }));
  return { text, provider };
}
