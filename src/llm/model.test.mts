// 다듬기 모델 나누기 (결정 81) — 짧은 받아쓰기는 sonnet, 긴 것은 모든 조각이 opus, 다른 호출(complete)은 opus 그대로.
// 진짜 CLI 대신 받은 인자를 기록하고 --model 값을 답으로 내는 가짜 claude(node 스크립트)로 시험한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-model-test-'));
const FAKE = path.join(dir, 'fake-claude.mjs');
const LOG = path.join(dir, 'argv.log');

vi.mock('./providers.mjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('./providers.mjs')>();
  return {
    ...real,
    findBin: () => FAKE,
    // Claude Code만 로그인된 것으로 — 진짜 로그인 확인(CLI 실행)을 하지 않는다
    providerStatus: async () => ({ 'claude-code': { installed: true, loggedIn: true }, codex: { installed: false, loggedIn: false }, api: { installed: true, loggedIn: false } }),
  };
});
const { cleanup, modelFor, ORGANIZE_MIN_CHARS } = await import('./cleanup.mjs');
const { complete } = await import('./call.mjs');
const { setWorkRoot } = await import('./providers.mjs');

// 가짜 claude: argv를 한 줄 JSON으로 덧붙여 적고, 표준 입력을 다 읽은 뒤 --model 값을 result로 낸다
const FAKE_SRC = `#!${process.execPath}
import fs from 'node:fs';
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify(argv) + '\\n');
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const model = argv[argv.indexOf('--model') + 1];
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: model }) + '\\n');
});
`;

const calls = (): string[][] => fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
const modelOf = (argv: string[]): string | undefined => argv[argv.indexOf('--model') + 1];

beforeAll(() => {
  fs.writeFileSync(FAKE, FAKE_SRC, { mode: 0o755 });
  setWorkRoot(() => dir);
});
beforeEach(() => fs.writeFileSync(LOG, ''));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('modelFor — 받아쓴 글 전체 길이로 정한다', () => {
  it('80자 미만은 sonnet, 80자부터 opus, 빈 글은 sonnet', () => {
    expect(ORGANIZE_MIN_CHARS).toBe(80);
    expect(modelFor('가'.repeat(79))).toBe('sonnet');
    expect(modelFor('가'.repeat(80))).toBe('opus');
    expect(modelFor('')).toBe('sonnet');
  });
});

describe('Claude Code로 다듬기·다른 호출의 --model', () => {
  it('짧은 받아쓰기는 --model sonnet으로 한 번', async () => {
    const res = await cleanup('음 내일 회의는 4시에 하죠', { provider: 'claude-code' });
    expect(res).toMatchObject({ text: 'sonnet', provider: 'claude-code', chunks: 1, error: null });
    expect(calls().map(modelOf)).toEqual(['sonnet']);
  });

  it('긴 받아쓰기(여러 조각)는 모든 조각이 --model opus — 마지막 조각이 짧아도', async () => {
    const sentence = '오늘은 동네 장터에서 사과와 배를 사고 오후에는 도서관에 들러 책을 두 권 빌렸다. ';
    const raw = `${sentence.repeat(20)}끝.`; // 약 900자 → 600자 단위로 둘 이상, 마지막은 짧은 조각
    const res = await cleanup(raw, { provider: 'claude-code' });
    expect(res.chunks).toBeGreaterThan(1);
    expect(res.error).toBeNull();
    const models = calls().map(modelOf);
    expect(models).toHaveLength(res.chunks ?? 0);
    expect(new Set(models)).toEqual(new Set(['opus']));
  });

  it('complete(회의록·질문 등)는 짧은 입력이어도 --model opus', async () => {
    const res = await complete({ system: 'sys', input: '짧은 질문', choice: 'claude-code' });
    expect(res).toEqual({ text: 'opus', provider: 'claude-code' });
    expect(calls().map(modelOf)).toEqual(['opus']);
  });
});
