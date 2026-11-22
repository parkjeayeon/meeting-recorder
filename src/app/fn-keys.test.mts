// fn 키 도우미의 줄 읽기와 셀프테스트 fn 흉내 (fn-keys.mts) — 도우미는 띄우지 않고 가짜 시계로
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictationSettings, StoredSettings } from '../dictation/index.mjs';
import { platform } from '../platform/index.mjs';
import type { KeyListenerEvents } from '../platform/index.mjs';
import { tmpDir } from '../test/ipc.mjs';
import { createFnKeys, type FnKeys, type FnKeysContext } from './fn-keys.mjs';

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

describe('fn-listener 띄우기 (startFnListener)', () => {
  let bin: string;
  let started: KeyListenerEvents[];
  const make = () => {
    const ctx: FnKeysContext = {
      selftest: false,
      recording: () => null,
      transcribing: () => 0,
      dictation: { getSettings: () => ({ enabled: true }) as DictationSettings, storedSettings: () => ({}) as StoredSettings },
      quitting: () => false,
      helperPath: () => bin,
      send: (channel, payload) => void sent.push([channel, payload]),
      sendOverlay: () => {},
      sendOverlayState: () => {},
      quit: () => {},
      log: () => {},
    };
    return createFnKeys(ctx);
  };

  beforeEach(() => {
    bin = path.join(tmpDir('mr-fn-keys-'), 'fn-listener');
    fs.writeFileSync(bin, '');
    started = [];
    vi.spyOn(platform.keyListener, 'start').mockImplementation((_bin, on) => (started.push(on), { kill: () => {} }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('남은 고아 도우미를 끌 때 하나가 던져도(EPERM·ESRCH) 나머지는 끈다', () => {
    vi.spyOn(platform.processes, 'orphans').mockReturnValue([
      { pid: 31, command: bin },
      { pid: 32, command: '/other/bin' },
      { pid: 33, command: `${bin} ` },
    ]);
    const killed: number[] = [];
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 31) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      killed.push(pid);
      return true;
    });
    make().startFnListener();
    expect(killed).toEqual([33]);
    expect(started).toHaveLength(1); // 그래도 도우미를 띄운다
  });

  it('도우미가 끝나면 알린다: 끝 코드가 있으면 code n, 없으면(신호·띄우지 못함) code null 대신 코드 없이, 2(권한 없음)는 알리지 않는다', () => {
    vi.spyOn(platform.processes, 'orphans').mockReturnValue([]);
    const keys = make();
    for (const code of [1, null, 2]) {
      keys.startFnListener();
      started.at(-1)?.exit(code);
    }
    expect(sent).toEqual([
      ['fn:status', { ok: false, reason: 'fn 감지기가 종료됨 (code 1)' }],
      ['fn:status', { ok: false, reason: 'fn 감지기가 종료됨' }],
    ]);
    expect(started).toHaveLength(3); // 끝나면 다시 띄울 수 있다
  });
});
