// 녹음 저장 (recording.mts) — rec:start → rec:chunk → rec:stop을 가짜 창처럼 불러 임시 폴더에 WAV·meta.json을 쓴다
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import type { DictationSettings } from '../dictation/index.mjs';
import { DICTATION_MAX_MS, registerRecording, type RecordingContext, type RecordingSession } from './recording.mjs';
import type { DictationJob } from './dictation-run.mjs';

let root: string;
let temp: string;
let ipc: FakeIpc;
let calls: unknown[][];
let sent: [string, unknown][];
let overlay: [string, unknown][];
let minutesOn: boolean;
let helperOut: string | null;
let dialogAnswer: number;
let session: RecordingSession;

const fn = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);

beforeEach(() => {
  root = tmpDir('mr-recording-');
  temp = tmpDir('mr-recording-temp-');
  calls = [];
  sent = [];
  overlay = [];
  minutesOn = true;
  helperOut = '{"name":"메모장","bundleId":"x.notes"}';
  dialogAnswer = 1;
  ipc = fakeIpc();
  const ctx: RecordingContext = {
    recordingsDir: () => root,
    tempDir: () => temp,
    fn: {
      dictationLimitReached: fn('dictationLimitReached'),
      stopReceived: fn('stopReceived'),
      uiToggle: fn('uiToggle'),
      uiCancel: fn('uiCancel'),
      recordingFailed: fn('recordingFailed'),
    },
    dictation: { getSettings: () => ({ minutes: minutesOn }) as DictationSettings },
    runPermissionsHelper: async (args) => (calls.push(['helper', args]), helperOut),
    runDictation: (job: DictationJob) => calls.push(['runDictation', job]),
    runMinutes: (dir, speakers) => calls.push(['runMinutes', dir, speakers]),
    updateTray: fn('updateTray'),
    send: (channel, payload) => void sent.push([channel, payload]),
    sendOverlay: (channel, payload) => void overlay.push([channel, payload]),
    dialog: {
      showMessageBox: async (opts) => (calls.push(['showMessageBox', opts.detail]), { response: dialogAnswer }),
    },
    selftest: false,
    log: fn('log'),
  };
  session = registerRecording(ipc, ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

const start = (mode: string, tracks = ['mic'], sampleRate = 1000) =>
  ipc.invoke('rec:start', { mode, sampleRate, tracks, devices: { mic: '내장 마이크' } }) as Promise<{ dir: string }>;
const chunk = (track: string, values: number[]) => ipc.send('rec:chunk', { track, samples: new Float32Array(values) });
const stop = (opts?: { discard?: boolean }) => ipc.invoke('rec:stop', opts) as Promise<Record<string, unknown> | null>;
const named = (name: string) => calls.filter((c) => c[0] === name);

describe('녹음 저장', () => {
  it('회의: 녹음 폴더에 트랙마다 WAV, 멈추면 meta.json을 쓰고 회의록을 시작한다', async () => {
    const { dir } = await start('meeting', ['mic', 'system']);
    expect(path.dirname(dir)).toBe(root);
    expect(path.basename(dir)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_meeting$/);
    expect(session.get()?.mode).toBe('meeting');
    chunk('mic', Array(500).fill(0.5));
    chunk('system', Array(250).fill(0.1));
    const res = await stop();
    expect(session.get()).toBe(null);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ mode: 'meeting', sampleRate: 1000, bitDepth: 16, devices: { mic: '내장 마이크' }, files: { mic: { file: 'mic.wav', durationSec: 0.5 }, system: { file: 'system.wav', durationSec: 0.25 } } });
    expect(meta.speakers).toBeUndefined(); // 자동이면 적지 않는다
    expect(fs.statSync(path.join(dir, 'mic.wav')).size).toBe(44 + 500 * 2);
    expect(fs.statSync(path.join(dir, 'system.wav')).size).toBe(44 + 250 * 2);
    expect(res).toMatchObject({ dir, mode: 'meeting', files: meta.files });
    expect(named('stopReceived')).toEqual([['stopReceived', { discard: false }]]);
    expect(named('runMinutes')).toEqual([['runMinutes', dir, null]]);
    expect(named('runDictation')).toEqual([]);
    expect(named('helper')).toEqual([]); // 앞 앱은 받아쓰기만
  });

  it('회의록 끄기면 회의록을 시작하지 않는다', async () => {
    minutesOn = false;
    await start('meeting');
    await stop();
    expect(named('runMinutes')).toEqual([]);
  });

  it('받아쓰기: 임시 폴더에 녹음하고, 멈추면 받아쓰기로 넘긴다 (봉우리·말소리 시간·앞 앱과 함께)', async () => {
    const { dir } = await start('memo');
    expect(path.dirname(dir)).toBe(path.join(temp, 'meeting-recorder-dictation'));
    await vi.waitFor(() => expect(session.get()?.app).toEqual({ name: '메모장', bundleId: 'x.notes' }));
    chunk('mic', Array(100).fill(0.002)); // -54dBFS: 말소리로 세지 않는다
    chunk('mic', [...Array(99).fill(0.01), -0.8]); // 말소리 0.1초, 봉우리는 절댓값
    chunk('mic', Array(50).fill(0.02)); // 0.05초
    const rec = session.get();
    expect(rec?.micPeak).toBeCloseTo(0.8);
    expect(rec?.voicedMs).toBeCloseTo(150);
    await stop();
    const [, job] = named('runDictation')[0] as [string, DictationJob];
    expect(job).toMatchObject({ dir, durationSec: 0.25, rec: { app: { name: '메모장' } } });
    expect(job.peak).toBeCloseTo(0.8);
    expect(job.voicedMs).toBeCloseTo(150);
    expect(job.startedAt).toBeInstanceOf(Date);
    expect(named('runMinutes')).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'meta.json'))).toBe(true);
  });

  it('앞 앱을 못 읽으면(도우미 실패 null·깨진 글) 그대로 null', async () => {
    helperOut = null;
    await start('memo');
    await vi.waitFor(() => expect(named('helper')).toHaveLength(1));
    await Promise.resolve();
    expect(session.get()?.app).toBe(null);
    await stop({ discard: true });
    helperOut = '{깨짐';
    await start('memo');
    await vi.waitFor(() => expect(named('helper')).toHaveLength(2));
    await Promise.resolve();
    expect(session.get()?.app).toBe(null);
  });

  it('레벨 막대: 조각마다 독에 dB를 보낸다 (마이크가 아닌 트랙은 봉우리·말소리에 넣지 않는다)', async () => {
    await start('meeting', ['mic', 'system']);
    chunk('system', Array(10).fill(1));
    expect(overlay.at(-1)).toEqual(['overlay:level', { track: 'system', db: expect.closeTo(0, 6) }]);
    chunk('mic', Array(10).fill(0));
    expect(overlay.at(-1)).toEqual(['overlay:level', { track: 'mic', db: -120 }]);
    expect(session.get()?.micPeak).toBe(0);
    expect(session.get()?.voicedMs).toBe(0);
    chunk('none', [1]); // 없는 트랙은 버린다
    expect(overlay).toHaveLength(2);
  });

  it('버리기: 쓰던 파일을 닫고 폴더째 지운다, 받아쓰기·회의록으로 넘기지 않는다', async () => {
    const { dir } = await start('meeting');
    chunk('mic', [0.5]);
    expect(await stop({ discard: true })).toBe(null);
    expect(fs.existsSync(dir)).toBe(false);
    expect(session.get()).toBe(null);
    expect(named('stopReceived')).toEqual([['stopReceived', { discard: true }]]);
    expect(named('runMinutes')).toEqual([]);
    expect(named('updateTray')).toHaveLength(2); // 시작·버림
  });

  it('녹음이 없을 때 멈추면 null (상태 머신에는 알린다), 녹음이 없을 때 조각은 버린다', async () => {
    chunk('mic', [1]);
    expect(await stop()).toBe(null);
    expect(named('stopReceived')).toHaveLength(1);
    expect(overlay).toEqual([]);
  });

  it('일시정지: 그동안의 조각은 쓰지 않고, 경과 시간에서 뺀다 (회의만)', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T09:00:00') });
    const { dir } = await start('meeting');
    chunk('mic', Array(100).fill(0.5));
    vi.advanceTimersByTime(10_000);
    ipc.send('rec:pause', true);
    expect(sent.at(-1)).toEqual(['rec:clock', { mode: 'meeting', paused: true, elapsedMs: 10_000 }]);
    chunk('mic', Array(300).fill(0.9)); // 쓰지 않는다
    vi.advanceTimersByTime(5_000);
    expect(session.elapsedMs()).toBe(10_000);
    ipc.send('rec:pause', true); // 이미 멈췄으면 아무 일 없음
    expect(sent).toHaveLength(1);
    ipc.send('rec:pause', false);
    expect(sent.at(-1)).toEqual(['rec:clock', { mode: 'meeting', paused: false, elapsedMs: 10_000 }]);
    vi.advanceTimersByTime(2_000);
    expect(session.clockInfo()).toEqual({ mode: 'meeting', paused: false, elapsedMs: 12_000 });
    chunk('mic', Array(100).fill(0.5));
    expect(session.get()?.micPeak).toBe(0.5);
    await stop();
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta.files.mic.durationSec).toBe(0.2);
  });

  it('일시정지는 받아쓰기에 먹지 않는다', async () => {
    await start('memo');
    ipc.send('rec:pause', true);
    expect(session.get()?.pausedAt).toBe(null);
    expect(sent).toEqual([]);
  });

  it('참석 인원: 녹음 전에는 다음 회의에, 녹음 중이면 지금 회의에, 받아쓰기 중이면 다음 회의에', async () => {
    ipc.send('rec:speakers', '3');
    await start('memo');
    expect(session.get()?.speakers).toBe(null);
    ipc.send('rec:speakers', 4); // 받아쓰기 중 → 다음 회의
    await stop({ discard: true });
    let { dir } = await start('meeting');
    expect(session.get()?.speakers).toBe(4);
    await stop();
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).speakers).toBe(4);
    expect(named('runMinutes').at(-1)).toEqual(['runMinutes', dir, 4]);
    // 한 번 쓰면 비운다
    ({ dir } = await start('meeting'));
    expect(session.get()?.speakers).toBe(null);
    ipc.send('rec:speakers', 2); // 녹음 중 → 지금 회의
    ipc.send('rec:speakers', 'x'); // 숫자가 아니면 자동(null)
    expect(session.get()?.speakers).toBe(null);
    ipc.send('rec:speakers', 5);
    await stop();
    expect(named('runMinutes').at(-1)).toEqual(['runMinutes', dir, 5]);
  });

  it('받아쓰기 19분에 독에 미리 알리고 20분에 끝내고 입력한다 (그 사이 멈췄으면 아무 일 없음)', async () => {
    vi.useFakeTimers();
    await start('memo');
    vi.advanceTimersByTime(DICTATION_MAX_MS - 60_000 - 1);
    expect(overlay).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(overlay).toEqual([['overlay:stage', { stage: 'limit' }]]);
    vi.advanceTimersByTime(60_000);
    expect(named('dictationLimitReached')).toHaveLength(1);
    await stop({ discard: true });
    // 다른 녹음으로 바뀌었으면 앞 녹음의 타이머는 넘긴다
    await start('memo');
    vi.advanceTimersByTime(1000);
    await stop({ discard: true });
    await start('memo');
    vi.advanceTimersByTime(DICTATION_MAX_MS);
    expect(named('dictationLimitReached')).toHaveLength(2); // 셋째 녹음 것만
    // 회의에는 제한이 없다
    await stop({ discard: true });
    overlay = [];
    await start('meeting');
    vi.advanceTimersByTime(DICTATION_MAX_MS * 2);
    expect(overlay).toEqual([]);
    expect(named('dictationLimitReached')).toHaveLength(2);
  });

  it('버튼: 녹음 토글·취소·실패는 fn 상태 머신에 알린다', () => {
    ipc.send('rec:toggle', 'meeting');
    ipc.send('rec:cancel');
    ipc.send('rec:failed');
    expect(calls).toEqual([['uiToggle', 'meeting'], ['uiCancel'], ['recordingFailed']]);
  });

  it('취소 확인 창: 녹음이 있을 때만 묻고, 버리기를 고르면 취소한다', async () => {
    await session.confirmCancel();
    expect(named('showMessageBox')).toEqual([]);
    vi.useFakeTimers({ now: new Date('2026-01-01T09:00:00') });
    await start('meeting');
    vi.advanceTimersByTime(29_000);
    await session.confirmCancel();
    expect(named('showMessageBox')).toEqual([['showMessageBox', '지금까지 녹음한 내용이 저장되지 않고 지워집니다.']]);
    expect(named('uiCancel')).toEqual([]);
    dialogAnswer = 0;
    vi.advanceTimersByTime(3 * 60_000);
    await session.confirmCancel();
    expect(named('showMessageBox').at(-1)).toEqual(['showMessageBox', '지금까지 녹음한 3분이 저장되지 않고 지워집니다.']);
    expect(named('uiCancel')).toHaveLength(1);
  });

  it('앱을 끝낼 때: 쓰던 파일을 닫고 녹음을 놓는다 (meta.json은 없다)', async () => {
    const { dir } = await start('meeting');
    chunk('mic', Array(10).fill(0.5));
    session.closeOnQuit();
    expect(session.get()).toBe(null);
    expect(fs.existsSync(path.join(dir, 'meta.json'))).toBe(false);
    expect(fs.statSync(path.join(dir, 'mic.wav')).size).toBe(44 + 20);
    session.closeOnQuit(); // 녹음이 없으면 아무 일 없음
  });
});
