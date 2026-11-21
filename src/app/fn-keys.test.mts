// fn 키 도우미의 줄 읽기와 셀프테스트 fn 흉내 (fn-keys.mts) — 도우미는 띄우지 않고 가짜 시계로
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictationSettings, StoredSettings } from '../dictation/index.mjs';
import { createFnKeys, type FnKeys } from './fn-keys.mjs';

let sent: [string, unknown][];
let quits: number;
let recording: { mode?: string } | null;
let keys: FnKeys;

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  quits = 0;
  recording = null;
  keys = createFnKeys({
    selftest: true,
    recording: () => recording,
    transcribing: () => 0,
    dictation: {
      getSettings: () => ({ enabled: true }) as DictationSettings,
      storedSettings: () => ({ onboarding: { completed: true } }) as StoredSettings,
    },
    quitting: () => false,
    helperPath: (name) => `/none/${name}`,
    send: (channel, payload) => void sent.push([channel, payload]),
    sendOverlay: () => {},
    sendOverlayState: () => {},
    quit: () => void quits++,
    log: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fn-listener 줄', () => {
  it('ready·권한 없음은 창에 알리고, down·up·chord는 상태 머신으로', () => {
    keys.handleFnLine('ready');
    keys.handleFnLine('error:permission');
    keys.handleFnLine('뭔지 모름');
    expect(sent).toEqual([['fn:status', { ok: true }], ['perm:changed', undefined]]);
    keys.handleFnLine('down'); // 누르면 바로 듣기 시작
    expect(sent.at(-1)).toEqual(['rec:cmd', { action: 'start', mode: 'memo' }]);
    expect(keys.machine.state()).toBe('holding');
    recording = { mode: 'memo' };
    keys.handleFnLine('chord'); // fn+다른 키 → 버림
    expect(sent.at(-1)).toEqual(['rec:cmd', { action: 'cancel', mode: undefined }]);
    expect(keys.machine.state()).toBe('idle');
  });
});

describe('셀프테스트 fn 흉내', () => {
  it('시간표대로 받아쓰기 → 회의 버튼 → 13.5초에 끝낸다', () => {
    keys.runFnSimulation();
    vi.advanceTimersByTime(500);
    expect(sent.at(-1)).toEqual(['rec:cmd', { action: 'start', mode: 'memo' }]);
    vi.advanceTimersByTime(8499);
    expect(sent.filter(([c, p]) => c === 'rec:cmd' && (p as { mode?: string }).mode === 'meeting')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)).toEqual(['rec:cmd', { action: 'start', mode: 'meeting' }]); // 9초: 회의 시작 버튼
    vi.advanceTimersByTime(4499);
    expect(quits).toBe(0);
    vi.advanceTimersByTime(1);
    expect(quits).toBe(1);
  });
});
