import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteOptions } from '../llm/call.mjs';
import { createAsk, JUDGE, PARSE, type AskEngine, type AskJob, type AskMeeting } from './index.mjs';

// 지어낸 회의와 가짜 LLM으로 질문 하나의 흐름(조건 → 거르기 → 색인 → 추리기)과 질문 상태(돌기·끝·멈춤·실패·저장)를 본다.
// 실제 엔진을 Electron으로 돌리는 시험은 scripts/dev/ask-engine-check.js (npm run test:crash).
let root = '';
let userData = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ask-unit-'));
  userData = path.join(root, 'userData');
  fs.mkdirSync(userData);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const DAYS = ['2026-11-05T10:00:00', '2026-11-02T10:00:00', '2025-02-14T10:00:00'];
function meetings(n = 3): AskMeeting[] {
  return Array.from({ length: n }, (_, i) => {
    const id = `m${i + 1}`;
    const dir = path.join(root, 'rec', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'transcript.txt'), `[00:05] [화자 1] ${i === 1 ? '디자인 이야기 끝에 배포가 밀렸어요' : `${id} 배포 회의입니다`}\n`);
    return { id, dir, startedAt: new Date(DAYS[i] ?? DAYS[0]!).toISOString(), title: `${id} 회의`, summary: null, status: i === 2 ? 'draft' : 'done' };
  });
}

type Reply = Record<string, unknown> | Error | ((o: CompleteOptions) => Promise<{ text: string; provider: string }>);
// 조건 풀기는 conds, 추리기는 judge(후보 블록 → 등급)
function fake(conds: Reply, judge: (block: string) => 'main' | 'mention' | null = () => 'main') {
  const calls: CompleteOptions[] = [];
  const complete = async (o: CompleteOptions) => {
    calls.push(o);
    if (o.system.startsWith("You turn a user's request")) {
      if (conds instanceof Error) throw conds;
      if (typeof conds === 'function') return conds(o);
      return { text: JSON.stringify(conds), provider: 'claude-code' };
    }
    const results = o.input.split(/\n(?=\[c\d+\])/).flatMap((b) => {
      const id = /\[(c\d+)\]/.exec(b)?.[1];
      const level = id ? judge(b) : null;
      return id && level ? [{ id, level, reason: `이유 ${id}`, quote: '배포' }] : [];
    });
    return { text: JSON.stringify({ results }), provider: 'codex' };
  };
  return { calls, complete };
}
const C = (o: Partial<Record<'from' | 'to' | 'status' | 'focus' | 'topic' | 'terms', unknown>> = {}) => ({ from: null, to: null, status: null, focus: 'any', topic: '배포', terms: ['배포'], ...o });

function engine(complete: (o: CompleteOptions) => Promise<{ text: string; provider: string }>, ms = meetings(), key = { v: 'k1' as string | null }) {
  const e = createAsk({ userData: () => userData, complete, apiKey: () => key.v });
  const events: AskJob[] = [];
  e.init({ getMeetings: () => ms, onChange: (j) => events.push(j) });
  return { e, events, ms, key };
}
const until = (e: AskEngine, id: string) =>
  new Promise<AskJob>((resolve) => {
    const tick = () => {
      const j = e.list().find((x) => x.id === id);
      if (j && j.status !== 'running') resolve(j);
      else setTimeout(tick, 2);
    };
    tick();
  });
const ask = async (e: AskEngine, q: string, scope = {}) => until(e, e.start(q, scope).id);
const ids = (j: AskJob) => j.results.map((r) => `${r.id}:${r.level ?? '-'}`).join(' ');
const saved = () => JSON.parse(fs.readFileSync(path.join(userData, 'asks.json'), 'utf8')) as AskJob[];

describe('시작 전 막기', () => {
  it('init 전에는 시작하지 않고, 빈 질문은 받지 않는다', () => {
    const e = createAsk({ userData: () => userData, complete: fake(C()).complete, apiKey: () => null });
    expect(() => e.start('배포')).toThrow('질문으로 찾기가 아직 준비되지 않았습니다');
    e.init({ getMeetings: () => [], onChange: () => {} });
    expect(() => e.start('   ')).toThrow('찾을 내용을 적어 주세요');
  });
});

describe('질문 하나', () => {
  it('조건 → 색인 → 추리기, 단계마다 소식, 결과는 최신순, LLM 옵션', async () => {
    const f = fake(C(), (b) => (b.includes('밀렸') ? 'mention' : 'main'));
    const { e, events, key } = engine(f.complete);
    const job = e.start(`  ${'배포 회의'.padEnd(600, '?')}  `, { count: '2', from: '', to: '' });
    expect(job).toMatchObject({ q: '배포 회의'.padEnd(500, '?'), scope: { count: 2, from: '', to: '' }, status: 'running', stage: 'parse', results: [] });
    key.v = 'k2'; // API 키는 부를 때 읽는다
    const j = await until(e, job.id);
    expect([j.status, j.stage, ids(j), j.candidates, j.provider]).toEqual(['done', 'done', 'm1:main m2:mention', 2, 'claude-code']);
    expect(events.map((x) => x.stage)).toEqual(['parse', 'search', 'judge', 'done']);
    const [parse, judge] = f.calls;
    expect(parse).toMatchObject({ effort: 'low', cache: false, maxTokens: 800, choice: 'auto', apiKey: 'k2', timeouts: { 'claude-code': 180000, codex: 180000, api: 180000 } });
    expect(parse!.signal).toBeInstanceOf(AbortSignal);
    expect(parse!.system).toMatch(/^You turn a user's request .* Today is \d{4}-\d{2}-\d{2} \(Asia\/Seoul\)\.\n/);
    expect(parse!.system).toBe(PARSE(/Today is (.*)\.\n/.exec(parse!.system)![1]!));
    expect(judge).toMatchObject({ system: JUDGE, maxTokens: 4000, cache: false });
    expect(judge!.input).toMatch(/^<request>배포 회의\?+<\/request>\n<candidates>\n\[c1\] 2026-11-05 \d\d:\d\d \| 확정 \| m1 회의 \| \(회의록 없음\)\n {2}> \[00:05\] \[화자 1\] m1 배포 회의입니다\n\[c2\] /);
    expect(saved().map((x) => x.id)).toEqual([job.id]);
  });

  it('찾을 말이 없으면 LLM 추리기 없이 범위·상태로 거른 목록 (질문 속 상태, 최근 N개)', async () => {
    const f = fake(C({ status: ['draft', 'done'], terms: [], topic: null }));
    const { e } = engine(f.complete);
    expect(ids(await ask(e, '확인 안 끝난'))).toBe('m1:- m2:- m3:-');
    expect(ids(await ask(e, '확인 안 끝난', { count: 2 }))).toBe('m1:- m2:-');
    expect(f.calls.every((c) => c.system.startsWith("You turn a user's request"))).toBe(true);
  });

  it('기간: 질문 속 기간·기간 칩 둘 다 맞는 날만, 겹치지 않으면 찾지 않고 blocked', async () => {
    const f = fake(C({ from: '2025-02-01', to: '2025-02-28', terms: [] }));
    const { e } = engine(f.complete);
    expect(ids(await ask(e, '작년 2월'))).toBe('m3:-');
    expect((await ask(e, '작년 2월', { from: '2025-02-15' })).results).toEqual([]);
    const blocked = await ask(e, '작년 2월', { from: '2026-11-01', to: '2026-11-30' });
    expect([blocked.status, blocked.stage, blocked.results]).toEqual(['blocked', 'blocked', []]);
    const g = fake(C({ from: 'not-a-day', to: '2025-13', terms: [] })); // 날짜 꼴이 아니면 버린다
    expect(ids(await ask(engine(g.complete).e, '아무때'))).toBe('m1:- m2:- m3:-');
  });

  it("'주로 다룬'이면 잠깐 언급은 빼고, 모르는 후보 id·이상한 등급은 버리거나 main으로", async () => {
    const f = fake(C({ focus: 'main' }), (b) => (b.includes('밀렸') ? 'mention' : 'main'));
    expect(ids(await ask(engine(f.complete).e, '배포를 주로'))).toBe('m1:main m3:main');
    const odd = fake(C(), () => 'main');
    const wrapped = async (o: CompleteOptions) => (o.system === JUDGE ? { text: JSON.stringify({ results: [{ id: 'c9', level: 'main' }, { id: 'c1', level: '??', reason: 3, quote: 'x'.repeat(300) }] }), provider: 'codex' } : odd.complete(o));
    const j = await ask(engine(wrapped).e, '배포');
    expect(j.results).toEqual([{ id: 'm1', level: 'main', reason: null, quote: 'x'.repeat(200) }]);
  });

  it('후보가 40개를 넘으면 나눠서 동시에 추리고, 묶음마다 c1부터 다시 세어도 회의로 바로 이어진다 (최신순)', async () => {
    const f = fake(C());
    const ms = meetings(45);
    const { e } = engine(f.complete, ms);
    const j = await ask(e, '배포');
    expect(f.calls.filter((c) => c.system === JUDGE).map((c) => (c.input.match(/^\[c\d+\] /gm) ?? []).length)).toEqual([40, 5]);
    expect(j.candidates).toBe(45);
    expect(j.results.map((r) => r.id)).toEqual(ms.map((m) => m.id));
  });
});

describe('질문 상태', () => {
  it('실패: 시간 초과(killed)·한도·kind·기타, 첫 줄만, 저장', async () => {
    const cases: [Error, string, string][] = [
      [Object.assign(new Error('Command failed\n긴 명령줄'), { killed: true }), '시간 초과', 'timeout'],
      [Object.assign(new Error('rate limit reached\n둘째 줄'), {}), 'rate limit reached', 'limit'],
      [Object.assign(new Error('로그인 필요'), { kind: 'login' }), '로그인 필요', 'login'],
      [new Error('알 수 없음'), '알 수 없음', 'other'],
    ];
    for (const [err, error, kind] of cases) {
      const { e } = engine(fake(err).complete);
      const j = await ask(e, '실패');
      expect([j.status, j.stage, j.error, j.errorKind, typeof j.ms]).toEqual(['error', 'error', error, kind, 'number']);
      expect(saved()[0]!.status).toBe('error');
    }
  });

  it('멈추기: 돌던 호출을 끊고 stopped, 끊긴 호출의 오류로 덮어쓰지 않는다. 닫기는 지우고 저장', async () => {
    let signal: AbortSignal | undefined;
    const slow = async (o: CompleteOptions) => {
      signal = o.signal;
      await new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      return { text: '', provider: 'x' };
    };
    const { e, events } = engine(slow);
    const job = e.start('느린 질문');
    await new Promise((r) => setTimeout(r, 5));
    e.stop(job.id);
    await new Promise((r) => setTimeout(r, 5));
    expect(signal?.aborted).toBe(true);
    expect(e.list()[0]).toMatchObject({ status: 'stopped', stage: 'stopped', error: null });
    expect(events.at(-1)!.status).toBe('stopped');
    e.stop(job.id); // 이미 멈춘 것은 그대로
    expect(events.at(-1)!.status).toBe('stopped');
    const second = e.start('또 느린 질문');
    e.remove(second.id);
    expect(e.list().map((x) => x.id)).toEqual([job.id]);
    expect(saved().map((x) => x.id)).toEqual([job.id]);
  });

  it('본 질문 표시는 저장되고, 다시 켤 때 돌던 질문은 중단으로, 30개만 남긴다', async () => {
    const { e } = engine(fake(C({ terms: [] })).complete);
    const done = await ask(e, '하나');
    e.seen(done.id);
    expect(saved()[0]!.seen).toBe(true);
    const old = saved();
    const many = Array.from({ length: 34 }, (_, i) => ({ ...old[0]!, id: `z${i}`, status: i === 33 ? 'running' : 'done' }));
    fs.writeFileSync(path.join(userData, 'asks.json'), JSON.stringify(many));
    const again = createAsk({ userData: () => userData, complete: fake(C()).complete, apiKey: () => null });
    again.init({ getMeetings: () => [], onChange: () => {} });
    expect(again.list().at(-1)).toMatchObject({ id: 'z33', status: 'error', stage: 'error', error: '앱이 종료되어 중단됐습니다' });
    again.seen('z0'); // 이미 본 것이면 저장하지 않는다
    expect(saved()).toHaveLength(34);
    again.seen('없는 id');
    again.remove('z1');
    expect(saved()).toHaveLength(30);
    expect(saved()[0]!.id).toBe('z4');
  });
});
