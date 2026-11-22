// 답이 다 되면 바로 받기 (결정 80) — 진짜 CLI 대신 이벤트 줄을 정해진 대로 내는 가짜 CLI(node 스크립트)로 시험한다.
// CALLERS['claude-code']·CALLERS.codex를 앱과 같은 인자로 부르고, findBin만 가짜 CLI를 가리키게 바꾼다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getEventListeners } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-early-test-'));
const FAKE = path.join(dir, 'fake-cli.mjs');

vi.mock('./providers.mjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('./providers.mjs')>();
  return { ...real, findBin: () => process.env.FAKE_BIN ?? null };
});
const { CALLERS } = await import('./call.mjs');
const { setWorkRoot, KILL_GRACE_MS } = await import('./providers.mjs');

// 가짜 CLI: FAKE_CLI(시나리오 JSON 파일)의 steps를 차례로 — 줄 내기·기다리기·-o 파일 쓰기·종료 코드·멈춰 있기
const FAKE_SRC = `#!${process.execPath}
import fs from 'node:fs';
const sc = JSON.parse(fs.readFileSync(process.env.FAKE_CLI, 'utf8'));
const o = process.argv.indexOf('-o');
const oPath = o > 0 ? process.argv[o + 1] : null;
fs.writeFileSync(sc.info, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), oPath }));
if (sc.ignoreTerm) process.on('SIGTERM', () => {});
if (sc.writeOOnTerm) process.on('SIGTERM', () => { fs.writeFileSync(oPath, 'late'); process.exit(143); });
process.stdin.resume();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const s of sc.steps) {
  if (s.wait) await sleep(s.wait);
  if (s.ev !== undefined) process.stdout.write(JSON.stringify(s.ev) + '\\n');
  if (s.raw !== undefined) process.stdout.write(s.raw);
  if (s.big) process.stdout.write('x'.repeat(s.big));
  if (s.err !== undefined) process.stderr.write(s.err);
  if (s.writeO !== undefined) fs.writeFileSync(oPath, s.writeO);
  if (s.exit !== undefined) { process.exitCode = s.exit; process.stdin.pause(); break; }
  if (s.hang) await sleep(60000);
}
`;

type Step = { wait?: number; ev?: unknown; raw?: string; big?: number; err?: string; writeO?: string; exit?: number; hang?: boolean };
type Info = { pid: number; argv: string[]; oPath: string | null };
let n = 0;
function scenario(steps: Step[], extra: { ignoreTerm?: boolean; writeOOnTerm?: boolean } = {}): () => Info {
  n += 1;
  const file = path.join(dir, `sc-${n}.json`);
  const info = path.join(dir, `info-${n}.json`);
  fs.writeFileSync(file, JSON.stringify({ steps, info, ...extra }));
  process.env.FAKE_CLI = file;
  return () => JSON.parse(fs.readFileSync(info, 'utf8')) as Info;
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !alive(pid);
}

const opts = { system: 'sys', input: 'in', effort: 'low' as const, timeout: 10000 };
type Extra = { timeout?: number; signal?: AbortSignal };
const claude = (o: Extra = {}) => CALLERS['claude-code']({ ...opts, ...o });
const codex = (o: Extra = {}) => CALLERS.codex({ ...opts, ...o });
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err as Error & { kind?: string; killed?: boolean; limit?: boolean; code?: unknown; stdout?: string; stderr?: string };
  }
  throw new Error('실패해야 하는데 답을 받았습니다');
};

// Claude Code stream-json 이벤트 (2.1.311에서 본 모양을 줄인 것)
const se = (event: unknown) => ({ ev: { type: 'stream_event', event, parent_tool_use_id: null, session_id: 's' } });
const claudeMessage = (parts: string[], stop = 'end_turn'): Step[] => [
  { ev: { type: 'system', subtype: 'init', tools: [] } },
  se({ type: 'message_start', message: { id: 'm', role: 'assistant', content: [], stop_reason: null } }),
  se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ...parts.map((text) => se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
  { ev: { type: 'assistant', message: { content: [{ type: 'text', text: parts.join('') }], stop_reason: null } } },
  se({ type: 'content_block_stop', index: 0 }),
  se({ type: 'message_delta', delta: { stop_reason: stop } }),
  se({ type: 'message_stop' }),
  { ev: { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } } },
];
const claudeResult = (result: string, extra: Record<string, unknown> = {}): Step => ({ ev: { type: 'result', subtype: 'success', is_error: false, result, ...extra } });
const postTurn: Step = { wait: 60000, ev: { type: 'system', subtype: 'post_turn_summary' } }; // 진짜 CLI는 여기서 2~3초 더 머문다

beforeAll(() => {
  fs.writeFileSync(FAKE, FAKE_SRC, { mode: 0o755 });
  process.env.FAKE_BIN = FAKE;
  setWorkRoot(() => dir);
});
afterAll(() => {
  delete process.env.FAKE_CLI;
  delete process.env.FAKE_BIN;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Claude Code — 턴이 끝나면 바로 받기', () => {
  it('message_stop(end_turn)에서 받고, 아직 살아 있던 가짜 CLI는 곧 사라진다 (멈추기 리스너도 남지 않는다)', async () => {
    const info = scenario([...claudeMessage(['내일 회의는 ', '4시에 하는 걸로 하죠.']), postTurn, claudeResult('내일 회의는 4시에 하는 걸로 하죠.')]);
    const ac = new AbortController();
    const t = Date.now();
    expect(await claude({ signal: ac.signal })).toBe('내일 회의는 4시에 하는 걸로 하죠.');
    expect(Date.now() - t).toBeLessThan(5000);
    const { pid, argv } = info();
    expect(await goneWithin(pid, 2000)).toBe(true);
    expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
    // 모델·effort·지시문 등 예전 인자는 그대로, 출력 형식만 바뀐다
    expect(argv).toEqual(['-p', '--model', 'opus', '--effort', 'low', '--system-prompt', 'sys', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
  });

  it('여러 이벤트로 나뉜 긴 답(수 킬로바이트)을 그대로 잇는다 — 모르는 이벤트·JSON 아닌 줄은 건너뛴다', async () => {
    const parts = Array.from({ length: 400 }, (_, i) => `${i}번째 문장은 동네 장터의 아침 풍경을 그린다.${i % 7 === 0 ? '\n\n' : ' '}`);
    const steps = claudeMessage(parts);
    steps.splice(3, 0, { raw: 'not json at all\n' }, { ev: { type: 'something_new', data: 1 } }, { ev: [1, 2, 3] }, { raw: '{"type":"stream_event","event":\n' });
    scenario([...steps, postTurn]);
    const text = await claude();
    expect(text).toBe(parts.join('').trim());
    expect(Buffer.byteLength(text)).toBeGreaterThan(10000);
  });

  it('줄이 조각나 와도(한 줄이 여러 번에 나뉘어 옴) 같은 글', async () => {
    const line = JSON.stringify(se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '가나다라마바사' } }).ev);
    const steps = claudeMessage([]);
    steps.splice(3, 0, { raw: line.slice(0, 20) }, { wait: 50, raw: line.slice(20, 41) }, { wait: 50, raw: `${line.slice(41)}\n` });
    scenario([...steps, postTurn]);
    expect(await claude()).toBe('가나다라마바사');
  });

  it('끝 신호가 없으면 예전처럼 result를 기다려 그 글을 쓴다', async () => {
    const steps = claudeMessage(['일찍 받으면 안 되는 글']).filter((s) => !JSON.stringify(s.ev ?? '').includes('message_stop'));
    scenario([...steps, { wait: 200, ev: { type: 'system', subtype: 'post_turn_summary' } }, claudeResult('CLI가 알린 글'), { exit: 0 }]);
    expect(await claude()).toBe('CLI가 알린 글');
  });

  it('result도 없이 끝나면(종료 코드 0) 받은 글을 쓴다', async () => {
    const steps = claudeMessage(['받은 글']).filter((s) => !JSON.stringify(s.ev ?? '').includes('message_stop'));
    scenario([...steps, { exit: 0 }]);
    expect(await claude()).toBe('받은 글');
  });

  it('max_tokens로 끝났으면 일찍 받지 않고 result가 알린 글을 쓴다', async () => {
    scenario([...claudeMessage(['잘린 글'], 'max_tokens'), { wait: 200, ev: { type: 'system', subtype: 'post_turn_summary' } }, claudeResult('CLI가 마무리한 글', { stop_reason: 'max_tokens' }), { exit: 0 }]);
    expect(await claude()).toBe('CLI가 마무리한 글');
  });

  it('글 덩어리가 둘이면 result를 기다린다', async () => {
    const steps = claudeMessage(['첫 덩어리']);
    steps.splice(-4, 0, se({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }), se({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '둘째' } }));
    scenario([...steps, { wait: 100 }, claudeResult('둘째'), { exit: 0 }]);
    expect(await claude()).toBe('둘째');
  });

  it('메시지가 다시 시작하면 앞 메시지의 글은 버린다', async () => {
    const first = claudeMessage(['버릴 글']).slice(0, 4); // message_start ~ delta까지만
    scenario([...first, ...claudeMessage(['새 글']).slice(1), postTurn]);
    expect(await claude()).toBe('새 글');
  });

  it('답이 사용 한도 문구면 한도 오류', async () => {
    scenario([...claudeMessage(["You've hit your limit · resets 5pm"]), postTurn]);
    const err = await failure(claude());
    expect(err.limit).toBe(true);
  });

  it('is_error result는 실패한 종료처럼 — 한도면 limit, 로그인이면 login', async () => {
    scenario([{ err: 'warning: something\n' }, { ev: { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your limit · resets 5pm" }] } } }, claudeResult("You've hit your limit · resets 5pm", { is_error: true }), { wait: 60000 }]);
    const limit = await failure(claude());
    expect(limit).toMatchObject({ kind: 'limit', limit: true, message: "You've hit your limit · resets 5pm" });
    expect(limit.stderr).toContain('warning: something');
    scenario([claudeResult('Not logged in · Please run /login', { is_error: true }), { exit: 1 }]);
    expect(await failure(claude())).toMatchObject({ kind: 'login', message: 'Not logged in · Please run /login' });
  });

  it('종료 코드가 0이 아니면 예전과 같은 오류 (한도 문구 → limit, 이유 없음 → 종료 코드)', async () => {
    scenario([{ raw: "You've hit your usage limit\n" }, { exit: 1 }]);
    expect(await failure(claude())).toMatchObject({ kind: 'limit', limit: true, code: 1 });
    scenario([{ ev: { type: 'system', subtype: 'init' } }, { exit: 2 }]);
    expect(await failure(claude())).toMatchObject({ kind: 'other', code: 2, message: '종료 코드 2 (이유를 출력하지 않았습니다)' });
  });

  it('시간 초과 → killed·timeout, 자식은 끝난다', async () => {
    const info = scenario([{ ev: { type: 'system', subtype: 'init' } }, { hang: true }]);
    const err = await failure(claude({ timeout: 300 }));
    expect(err).toMatchObject({ killed: true, kind: 'timeout', message: '시간 초과' });
    expect(await goneWithin(info().pid, 2000)).toBe(true);
  });

  it('멈추기 → AbortError, 자식은 끝난다', async () => {
    const info = scenario([{ ev: { type: 'system', subtype: 'init' } }, { hang: true }]);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const err = await failure(claude({ signal: ac.signal }));
    expect(err).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    expect(await goneWithin(info().pid, 2000)).toBe(true);
    // 이미 멈춘 신호면 실행하지 않는다
    expect(await failure(claude({ signal: AbortSignal.abort() }))).toMatchObject({ name: 'AbortError' });
  });

  it('SIGTERM을 무시하는 자식도 잠시 뒤 SIGKILL로 끝난다', async () => {
    const info = scenario([...claudeMessage(['답']), postTurn], { ignoreTerm: true });
    expect(await claude()).toBe('답');
    const { pid } = info();
    expect(alive(pid)).toBe(true);
    expect(await goneWithin(pid, KILL_GRACE_MS + 2000)).toBe(true);
  });

  it('출력이 한도(4 MB)를 넘으면 예전처럼 ERR_CHILD_PROCESS_STDIO_MAXBUFFER, 자식은 끝난다', async () => {
    const info = scenario([{ big: 5 * 1024 * 1024 }, { hang: true }]);
    const err = await failure(claude());
    expect(err).toMatchObject({ name: 'RangeError', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', kind: 'other' });
    expect(await goneWithin(info().pid, 2000)).toBe(true);
  });
});

describe('Codex — turn.completed에서 바로 받기', () => {
  const codexTurn = (messages: string[]): Step[] => [
    { ev: { type: 'thread.started', thread_id: 't' } },
    { ev: { type: 'item.completed', item: { id: 'w', type: 'error', message: 'warning: metadata' } } },
    { ev: { type: 'turn.started' } },
    { ev: { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: '생각' } } },
    ...messages.map((text, i) => ({ ev: { type: 'item.completed', item: { id: `i${i}`, type: 'agent_message', text } } })),
    { ev: { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } } },
  ];

  it('마지막 agent_message를 turn.completed에서 받고, 자식이 사라진 뒤 -o 파일도 남지 않는다', async () => {
    const info = scenario([...codexTurn(['앞 메시지', '  마지막 답\n']), { hang: true }], { writeOOnTerm: true });
    const t = Date.now();
    expect(await codex()).toBe('마지막 답');
    expect(Date.now() - t).toBeLessThan(5000);
    const { pid, argv, oPath } = info();
    expect(await goneWithin(pid, 2000)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(oPath && fs.existsSync(oPath)).toBe(false);
    expect(argv).toEqual(['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-c', 'model_reasoning_effort=low', '--json', '-o', oPath, '-']);
  });

  it('turn.completed를 못 보면 예전처럼 -o 파일을 읽는다', async () => {
    scenario([{ ev: { type: 'thread.started' } }, { ev: { type: 'item.completed', item: { type: 'agent_message', text: '이벤트 글' } } }, { writeO: '파일 글\n' }, { exit: 0 }]);
    expect(await codex()).toBe('파일 글');
  });

  it('agent_message 없이 turn.completed면 -o 파일을 읽는다', async () => {
    scenario([{ ev: { type: 'turn.started' } }, { ev: { type: 'turn.completed' } }, { writeO: '파일 글' }, { exit: 0 }]);
    expect(await codex()).toBe('파일 글');
  });

  it('turn.failed → 예전과 같은 오류 (한도 → limit)', async () => {
    const info = scenario([{ ev: { type: 'turn.started' } }, { ev: { type: 'error', message: "You've hit your usage limit. Try again later." } }, { ev: { type: 'turn.failed', error: { message: "You've hit your usage limit. Try again later." } } }, { hang: true }]);
    expect(await failure(codex())).toMatchObject({ kind: 'limit', limit: true, message: "You've hit your usage limit. Try again later." });
    expect(await goneWithin(info().pid, 2000)).toBe(true);
    scenario([{ ev: { type: 'turn.failed', error: { message: "The 'x' model is not supported" } } }, { exit: 1 }]);
    expect(await failure(codex())).toMatchObject({ kind: 'other', message: "The 'x' model is not supported" });
  });

  it('error 이벤트 뒤 종료 코드 1 → 그 이유', async () => {
    scenario([{ ev: { type: 'error', message: 'stream disconnected: unauthorized' } }, { exit: 1 }]);
    expect(await failure(codex())).toMatchObject({ kind: 'login', code: 1, message: 'stream disconnected: unauthorized' });
  });

  it('시간 초과 → killed·timeout', async () => {
    scenario([{ ev: { type: 'turn.started' } }, { hang: true }]);
    expect(await failure(codex({ timeout: 300 }))).toMatchObject({ killed: true, kind: 'timeout' });
  });
});
