// 녹음 중 미리 받아쓰기 잇기 (recording.mts, 결정 83) — 가짜 미리 받아쓰기로 언제 무엇을 부르는지만 본다
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import type { DictationSettings } from '../dictation/index.mjs';
import { POKE_MS, type Pretranscriber } from '../meeting/pretranscribe.mjs';
import { registerRecording, type RecordingContext, type RecordingSession } from './recording.mjs';

interface FakePre extends Pretranscriber {
  dir: string;
  tracks: string[];
  events: string[];
  release(): void; // finish()를 풀어 준다
}

let root: string;
let ipc: FakeIpc;
let made: FakePre[];
let minutesRuns: { dir: string; speakers: number | null; after: Promise<unknown> | undefined; at: number }[];
let settings: { minutes: boolean; meetingPretranscribe: boolean };
let session: RecordingSession;
let clock = 0;

function fakePre(dir: string, tracks: string[]): FakePre {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const p: FakePre = {
    dir,
    tracks,
    events: [],
    release: () => release(),
    poke: async () => (p.events.push('poke'), null),
    finish: async () => {
      p.events.push('finish');
      await gate;
      p.events.push('finished');
    },
    cancel: async () => void p.events.push('cancel'),
  };
  made.push(p);
  return p;
}

beforeEach(() => {
  root = tmpDir('mr-recording-pre-');
  ipc = fakeIpc();
  made = [];
  minutesRuns = [];
  settings = { minutes: true, meetingPretranscribe: true };
  const ctx: RecordingContext = {
    recordingsDir: () => root,
    tempDir: () => root,
    fn: { dictationLimitReached: () => {}, stopReceived: () => {}, uiToggle: () => {}, uiCancel: () => {}, recordingFailed: () => {} },
    dictation: { getSettings: () => ({ ...settings }) as DictationSettings },
    runPermissionsHelper: async () => null,
    runDictation: () => {},
    runMinutes: (dir, speakers, opts) => void minutesRuns.push({ dir, speakers, after: opts?.after, at: ++clock }),
    createPretranscriber: fakePre,
    updateTray: () => {},
    send: () => {},
    sendOverlay: () => {},
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    selftest: false,
    log: () => {},
  };
  session = registerRecording(ipc, ctx);
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

const start = (mode: string, tracks = ['mic']) => ipc.invoke('rec:start', { mode, sampleRate: 1000, tracks, devices: {} }) as Promise<{ dir: string }>;
const stop = (opts?: { discard?: boolean }) => ipc.invoke('rec:stop', opts) as Promise<Record<string, unknown> | null>;
const chunk = (values: number[]) => ipc.send('rec:chunk', { track: 'mic', samples: new Float32Array(values) });

describe('녹음 중 미리 받아쓰기 잇기', () => {
  it('받아쓰기 녹음은 만들지 않는다', async () => {
    await start('memo');
    await stop();
    expect(made).toEqual([]);
  });

  it('설정을 끄면 만들지 않는다 (회의는 예전처럼 바로 회의록)', async () => {
    settings.meetingPretranscribe = false;
    const { dir } = await start('meeting');
    await stop();
    expect(made).toEqual([]);
    expect(minutesRuns).toEqual([{ dir, speakers: null, after: undefined, at: 1 }]);
  });

  it(`회의: 시작할 때 폴더·트랙으로 만들고 ${POKE_MS / 1000}초마다 찌른다`, async () => {
    vi.useFakeTimers();
    const { dir } = await start('meeting', ['mic', 'system']);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ dir, tracks: ['mic', 'system'] });
    expect(made[0]?.events).toEqual([]);
    vi.advanceTimersByTime(POKE_MS - 1);
    expect(made[0]?.events).toEqual([]);
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(POKE_MS * 2);
    expect(made[0]?.events).toEqual(['poke', 'poke', 'poke']);
    ipc.send('rec:pause', true); // 일시정지 중에도 찔러도 된다 (새 소리가 없어 할 일이 없다)
    vi.advanceTimersByTime(POKE_MS);
    expect(made[0]?.events).toHaveLength(4);
    await stop();
    vi.advanceTimersByTime(POKE_MS * 5);
    expect(made[0]?.events).toEqual(['poke', 'poke', 'poke', 'poke', 'finish']); // 멈추면 더 찌르지 않는다
  });

  it('저장: 멈춤 처리기는 바로 돌려주고, 회의록은 finish()가 끝난 뒤에 녹취를 시작하도록 after로 넘긴다', async () => {
    const { dir } = await start('meeting');
    chunk(Array(100).fill(0.2));
    const res = await stop();
    expect(res).toMatchObject({ dir, mode: 'meeting' }); // 창은 기다리지 않는다
    expect(fs.existsSync(path.join(dir, 'meta.json'))).toBe(true); // meta.json을 먼저 쓴다
    const pre = made[0];
    expect(pre?.events).toEqual(['finish']);
    expect(minutesRuns).toHaveLength(1);
    const after = minutesRuns[0]?.after;
    expect(after).toBeInstanceOf(Promise);
    let done = false;
    void after?.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false); // 받던 조각을 마치는 중
    pre?.release();
    await after;
    expect(done).toBe(true);
    expect(pre?.events).toEqual(['finish', 'finished']);
  });

  it('회의록 자동 만들기를 꺼도 받던 조각은 마치게 둔다 (나중에 손으로 만들 때 쓴다)', async () => {
    settings.minutes = false;
    await start('meeting');
    await stop();
    expect(made[0]?.events).toEqual(['finish']);
    expect(minutesRuns).toEqual([]);
  });

  it('버리기: cancel()하고 폴더를 지운다, 회의록으로 넘기지 않고 더 찌르지 않는다', async () => {
    vi.useFakeTimers();
    const { dir } = await start('meeting');
    expect(await stop({ discard: true })).toBe(null);
    expect(made[0]?.events).toEqual(['cancel']);
    expect(fs.existsSync(dir)).toBe(false);
    expect(minutesRuns).toEqual([]);
    vi.advanceTimersByTime(POKE_MS * 3);
    expect(made[0]?.events).toEqual(['cancel']);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 5)); // cancel()이 끝난 뒤 한 번 더 지워도 문제없다
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('앱을 끝낼 때: 녹음 중이면 cancel(), 멈춘 뒤 받던 조각을 마치는 중인 것도 cancel()', async () => {
    vi.useFakeTimers();
    await start('meeting');
    await stop(); // 첫 회의는 마치는 중
    await start('meeting');
    session.closeOnQuit();
    expect(made.map((p) => p.events)).toEqual([
      ['finish', 'cancel'],
      ['cancel'],
    ]);
    vi.advanceTimersByTime(POKE_MS * 3);
    expect(made[1]?.events).toEqual(['cancel']);
  });

  it('미리 받아쓰기를 넘기지 않은 본체(시험·예전 연결)는 예전처럼 바로 회의록', async () => {
    const own = fakeIpc();
    const runs: unknown[][] = [];
    registerRecording(own, {
      recordingsDir: () => root,
      tempDir: () => root,
      fn: { dictationLimitReached: () => {}, stopReceived: () => {}, uiToggle: () => {}, uiCancel: () => {}, recordingFailed: () => {} },
      dictation: { getSettings: () => ({ ...settings }) as DictationSettings },
      runPermissionsHelper: async () => null,
      runDictation: () => {},
      runMinutes: (...args) => void runs.push(args),
      updateTray: () => {},
      send: () => {},
      sendOverlay: () => {},
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      selftest: false,
      log: () => {},
    });
    const { dir } = (await own.invoke('rec:start', { mode: 'meeting', sampleRate: 1000, tracks: ['mic'], devices: {} })) as { dir: string };
    await own.invoke('rec:stop');
    expect(runs).toEqual([[dir, null]]);
  });
});
