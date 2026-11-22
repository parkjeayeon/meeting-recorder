// 회의록 만들기 실행 (minutes-run.mts) — 가짜 makeMinutes가 단계를 알리고, 가짜 시계로 인터넷 기다리기를 돌린다
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpDir } from '../test/ipc.mjs';
import type { OnStage } from '../meeting/index.mjs';
import { MIN_MEETING_SEC, ONLINE_POLL_MS, createMinutesRun, type MinutesRun } from './minutes-run.mjs';

let root: string;
let sent: [string, unknown][];
let overlay: [string, unknown][];
let made: { dir: string; speakers: number | null | undefined; resume: boolean | undefined; onStage: OnStage }[];
let online: boolean;
let resumable: Set<string>;
let run: MinutesRun;

// n번째로 시작한 회의록 만들기의 단계 알림
const stageOf = (n: number): OnStage => {
  const m = made[n];
  if (!m) throw new Error(`${n}번째 회의록 만들기가 없음`);
  return m.onStage;
};

const meeting = (name: string, files: Record<string, { durationSec?: number }> | null) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  if (files) fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mode: 'meeting', files }));
  return dir;
};

beforeEach(() => {
  root = tmpDir('mr-minrun-');
  sent = [];
  overlay = [];
  made = [];
  online = true;
  resumable = new Set();
  run = createMinutesRun({
    minutes: {
      makeMinutes: async (dir, opts = {}) => void made.push({ dir, speakers: opts.speakers, resume: opts.resume, onStage: opts.onStage ?? (() => {}) }),
      canResume: (dir) => resumable.has(dir),
    },
    isOnline: () => online,
    send: (channel, payload) => void sent.push([channel, payload]),
    sendOverlay: (channel, payload) => void overlay.push([channel, payload]),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('회의록 실행', () => {
  it(`${MIN_MEETING_SEC}초보다 짧은 회의는 회의록을 만들지 않고 short로 적는다 (가장 긴 트랙으로 잰다, meta.json이 없어도)`, async () => {
    const short = meeting('2026-01-01_09-00-00_meeting', { mic: { durationSec: 9.99 }, system: { durationSec: 3 } });
    await run.runMinutes(short, 3);
    expect(made).toEqual([]);
    const state = JSON.parse(fs.readFileSync(path.join(short, 'minutes.json'), 'utf8'));
    expect(state).toMatchObject({ status: 'short', durationSec: 9.99 });
    expect(sent).toEqual([['minutes:status', { id: '2026-01-01_09-00-00_meeting', status: 'short' }]]);
    expect(overlay).toEqual([['overlay:stage', { stage: 'done', status: 'meeting-short' }]]);
    expect(run.activeMinutes.has(short)).toBe(false);
    const none = meeting('2026-01-01_10-00-00_meeting', null);
    await run.runMinutes(none);
    expect(JSON.parse(fs.readFileSync(path.join(none, 'minutes.json'), 'utf8')).durationSec).toBe(0);
    expect(made).toEqual([]);
  });

  it('충분히 길면 회의록을 만들고, 단계마다 창과 독에 알린다', async () => {
    const dir = meeting('2026-01-01_09-00-00_meeting', { mic: { durationSec: 3 }, system: { durationSec: 10 } });
    await run.runMinutes(dir, 4);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ dir, speakers: 4, resume: false });
    expect(run.activeMinutes.has(dir)).toBe(true);
    const stage = stageOf(0);
    stage({ dir, status: 'queued' });
    stage({ dir, status: 'transcribe', progress: 0.5 });
    // 확인 필요가 남아 있으면 독의 끝 알림에 개수를 붙인다
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ items: [{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }, { id: 'c', status: 'applied' }] }));
    stage({ dir, status: 'done', title: '주간 회의' });
    expect(sent).toEqual([
      ['minutes:status', { id: '2026-01-01_09-00-00_meeting', dir, status: 'queued' }],
      ['minutes:status', { id: '2026-01-01_09-00-00_meeting', dir, status: 'transcribe', progress: 0.5 }],
      ['minutes:status', { id: '2026-01-01_09-00-00_meeting', dir, status: 'done', title: '주간 회의' }],
    ]);
    expect(overlay).toEqual([
      ['overlay:stage', { stage: 'done', status: 'meeting-saved' }],
      ['overlay:stage', { stage: 'done', status: 'minutes-done', text: '주간 회의 · 확인 필요 2개' }],
    ]);
    expect(run.activeMinutes.has(dir)).toBe(false); // done이면 놓는다
  });

  it('제목·확인 필요가 없으면 빈 글, 실패는 오류와 함께, empty도 놓는다', async () => {
    const a = meeting('2026-01-01_09-00-00_meeting', { mic: { durationSec: 60 } });
    await run.runMinutes(a);
    stageOf(0)({ dir: a, status: 'done' });
    expect(overlay.at(-1)).toEqual(['overlay:stage', { stage: 'done', status: 'minutes-done', text: '' }]);
    const b = meeting('2026-01-01_10-00-00_meeting', { mic: { durationSec: 60 } });
    await run.runMinutes(b);
    stageOf(1)({ dir: b, status: 'error', error: '쓰기 실패' });
    expect(overlay.at(-1)).toEqual(['overlay:stage', { stage: 'done', status: 'minutes-error', error: '쓰기 실패' }]);
    expect(run.activeMinutes.has(b)).toBe(false);
    expect(run.waitingOnline.has(b)).toBe(false); // 인터넷 탓이 아니면 기다리지 않는다
    const c = meeting('2026-01-01_11-00-00_meeting', { mic: { durationSec: 60 } });
    await run.runMinutes(c);
    stageOf(2)({ dir: c, status: 'empty' });
    expect(run.activeMinutes.has(c)).toBe(false);
    expect(overlay).toHaveLength(2); // empty는 독에 알리지 않는다
  });

  it('인터넷이 끊겨 실패하면 기다렸다가, 연결되면 이어 쓸 수 있는 회의만 이어서 쓴다', async () => {
    vi.useFakeTimers();
    const a = meeting('2026-01-01_09-00-00_meeting', { mic: { durationSec: 60 } });
    const b = meeting('2026-01-01_10-00-00_meeting', { mic: { durationSec: 60 } });
    await run.runMinutes(a, 2);
    await run.runMinutes(b);
    online = false;
    stageOf(0)({ dir: a, status: 'error', offline: true, error: '인터넷 연결 없음' });
    stageOf(1)({ dir: b, status: 'error', offline: true, error: '인터넷 연결 없음' });
    expect([...run.waitingOnline]).toEqual([a, b]);
    resumable.add(a); // b는 이어 쓸 녹취가 없다
    vi.advanceTimersByTime(ONLINE_POLL_MS * 3);
    expect(made).toHaveLength(2); // 아직 끊김
    online = true;
    vi.advanceTimersByTime(ONLINE_POLL_MS);
    expect(made).toHaveLength(3);
    expect(made[2]).toMatchObject({ dir: a, speakers: null, resume: true });
    expect([...run.waitingOnline]).toEqual([]);
    expect(run.activeMinutes.has(a)).toBe(true);
    vi.advanceTimersByTime(ONLINE_POLL_MS * 2); // 타이머는 멈췄다
    expect(made).toHaveLength(3);
  });

  it('기다리는 동안 다시 만들기 시작한 회의는 기다림에서 빠지고, 만드는 중이면 이어 쓰지 않는다', async () => {
    vi.useFakeTimers();
    online = false;
    const a = meeting('2026-01-01_09-00-00_meeting', { mic: { durationSec: 60 } });
    resumable.add(a);
    run.waitForOnline(a);
    run.waitForOnline(a); // 두 번 불러도 타이머는 하나
    await run.runMinutes(a);
    expect(run.waitingOnline.has(a)).toBe(false);
    run.waitForOnline(a); // 만드는 중에 다시 기다림에 들어와도
    online = true;
    vi.advanceTimersByTime(ONLINE_POLL_MS);
    expect(made).toHaveLength(1); // 만드는 중(activeMinutes)이라 이어 쓰지 않는다
    expect(run.waitingOnline.has(a)).toBe(false);
  });
});

describe('회의록 실행 — 녹음 중 미리 받아쓰기 뒤에 (결정 83)', () => {
  it('after를 makeMinutes에 그대로 넘기고, 넘기지 않으면 칸도 없다', async () => {
    const seen: unknown[] = [];
    const own = createMinutesRun({
      minutes: { makeMinutes: async (_dir, opts = {}) => void seen.push(opts), canResume: () => false },
      isOnline: () => true,
      send: () => {},
      sendOverlay: () => {},
    });
    const dir = meeting('2026-01-01_10-00-00_meeting', { mic: { durationSec: 60 } });
    const after = Promise.resolve();
    await own.runMinutes(dir, 2, { after });
    await own.runMinutes(dir, null);
    expect((seen[0] as { after?: unknown }).after).toBe(after);
    expect(seen[1]).not.toHaveProperty('after');
  });
});
