// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../index.html?raw';
import legacyController from './__fixtures__/controller.js.txt?raw';
import legacyDictation from './__fixtures__/dictation.js.txt?raw';
import { clock, remember, store } from '../../shared/lib/index.ts';
import { el, icon } from '../../shared/ui/index.tsx';
import { createSettingsStore } from '../../entities/settings/index.ts';
import { createIssueStore } from '../../entities/issue/index.ts';
import type { RecorderApi } from '../../shared/api/index.ts';
import { mountRecording } from './index.ts';
import type { RecordingDeps } from './index.ts';
import type { RecorderOptions, RecorderStartOptions } from './capture.ts';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const click = async (selector: string) => { q(selector).click(); await settle(); };
const capture = () => ({
  topbar: q('.topbar').outerHTML,
  live: q('#live').outerHTML,
  buttons: ['memoBtn', 'meetingBtn', 'pauseBtn', 'cancelBtn'].map((id) => {
    const b = q<HTMLButtonElement>(`#${id}`);
    return { html: b.outerHTML, hidden: b.hidden, disabled: b.disabled };
  }),
  speakers: q<HTMLSelectElement>('#liveSpeakersSel').value,
});
const sheet = () => ({ html: q('#meetStart').outerHTML, minutes: q<HTMLInputElement>('#startMinutes').checked, focus: document.activeElement?.id });

const legacyMount = (deps: RecordingDeps) => {
  let readingResult = false;
  const api = { ...deps.api, onDictResult: (fn: (r: unknown) => void) => deps.api.onDictResult((r: unknown) => {
    readingResult = true;
    try { fn(r); } finally { readingResult = false; }
  }) };
  const handle = new Function(
    '$', 'h', 'icon', 'Recorder', 'api', 'settingsStore', 'issues', 'toast', 'confirmBox', 'openSettings', 'loadHistory', 'clock', 'store', 'remember',
    `${legacyController}\nlet freshId = null;\n${legacyDictation}\nsetRecording(null);\nreturn {
      status: () => ({ mode: recordingMode, paused: liveClock.paused }),
      openStart: openMeetingStart,
      cancel: () => $('cancelBtn').onclick(),
      prepare: () => recorder.prepare(),
      resultId: () => freshId,
    };`,
  )((id: string) => document.getElementById(id), el, icon, FakeRecorder, api, deps.settings, deps.issues, deps.toast, deps.confirm, deps.openSettings,
    () => { if (readingResult) deps.dictationFinished(handle.resultId()); else deps.historyChanged(); }, clock, store, remember);
  return handle;
};

vi.mock('./capture.ts', () => ({ Recorder: class { constructor(options: RecorderOptions) { return new FakeRecorder(options); } } }));

let recorder: FakeRecorder;
class FakeRecorder {
  isRecording = false;
  start = vi.fn(async (_options: RecorderStartOptions): Promise<{ warnings: string[]; timing: { acquireMs: number; startMs: number } }> => {
    this.isRecording = true;
    return { warnings: [], timing: { acquireMs: 12, startMs: 34 } };
  });
  stop = vi.fn(async (_options: { discard: boolean }): Promise<{ files: { mic?: { durationSec: number }; system?: { durationSec: number } } } | null> => {
    this.isRecording = false;
    return null;
  });
  prepare = vi.fn().mockResolvedValue(undefined);
  constructor(readonly options: RecorderOptions) { recorder = this; }
}

function setup(factory = activeFactory) {
  const events: unknown[] = [];
  const saved = { meetingSystemAudio: false, minutes: true };
  const api = {
    onClock: vi.fn(), onCommand: vi.fn(), onDictStage: vi.fn(), onDictResult: vi.fn(),
    pause: vi.fn(), cancel: vi.fn(), failed: vi.fn(), log: vi.fn(), permOpenSettings: vi.fn(),
    toggle: vi.fn((mode: string) => events.push(['toggle', mode])),
    setSpeakers: vi.fn((n: string | null) => events.push(['speakers', n])),
    dictSettings: vi.fn().mockResolvedValue(saved),
    dictSaveSettings: vi.fn(async (patch) => { events.push(['save', patch]); return Object.assign(saved, patch); }),
    providers: vi.fn(), onDictSettings: vi.fn(), onDictEngine: vi.fn(),
  };
  const settings = createSettingsStore(api);
  const issues = createIssueStore();
  const deps = {
    api: api as unknown as RecorderApi, settings, issues,
    toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true), openSettings: vi.fn(),
    readInput: () => ({ deviceId: q<HTMLSelectElement>('#micSelect').value || undefined, echoCancellation: q<HTMLInputElement>('#echo').checked }),
    historyChanged: vi.fn(), dictationFinished: vi.fn(),
  };
  const ui = factory(deps);
  const emit = (action: string, mode = 'meeting') => api.onCommand.mock.calls[0]![0]({ action, mode });
  const command = async (action: string, mode = 'meeting') => { emit(action, mode); await settle(); };
  const onClock = (elapsedMs: number, paused: boolean, mode = 'meeting') => api.onClock.mock.calls[0]![0]({ elapsedMs, paused, mode });
  const stage = (stage: string) => api.onDictStage.mock.calls[0]![0]({ stage });
  const result = (r: object) => api.onDictResult.mock.calls[0]![0](r);
  return { ui, api, settings, issues, deps, events, saved, emit, command, onClock, stage, result, recorder };
}

function reset() {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  document.body.insertAdjacentHTML('beforeend', '<select id="micSelect"><option value=""></option><option value="wired">wired</option></select><input type="checkbox" id="echo">');
  localStorage.clear();
  vi.setSystemTime(new Date('2026-11-13T03:00:00Z'));
  q<HTMLDialogElement>('#meetStart').showModal = function () { this.open = true; };
  q<HTMLDialogElement>('#meetStart').close = function () { this.open = false; };
}
function initialize() {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  reset();
}
beforeEach(initialize);
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

let activeFactory = legacyMount;
let golden: (value: unknown) => void;
async function parity(scenario: () => unknown) {
  const expected: unknown[] = [];
  activeFactory = legacyMount;
  golden = (value) => { expect(value).toMatchSnapshot(); expected.push(value); };
  await scenario();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  initialize();
  activeFactory = mountRecording;
  let index = 0;
  golden = (value) => { expect(value).toEqual(expected[index++]); };
  await scenario();
  expect(index).toBe(expected.length);
}
const characterize = (name: string, scenario: () => unknown) => it(name, () => parity(scenario));
characterize.each = <T,>(cases: T[]) => (name: string, scenario: (value: T) => unknown) =>
  it.each(cases)(name, (value) => parity(() => scenario(value)));

describe('recording legacy characterization', () => {
  characterize('captures idle, memo, stop, meeting, pause, resume and cancel DOM goldens', async () => {
    const m = setup();
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const registrations = [m.api.onClock, m.api.onCommand, m.api.onDictStage, m.api.onDictResult].map((fn) => {
      expect(fn).toHaveBeenCalledOnce();
      return fn.mock.invocationCallOrder[0]!;
    });
    expect(registrations).toEqual([...registrations].sort((a, b) => a - b));
    const states: Record<string, ReturnType<typeof capture>> = { idle: capture() };
    await m.command('start', 'memo');
    states.memo = capture();
    expect(intervals).toHaveBeenLastCalledWith(expect.any(Function), 250);
    await vi.advanceTimersByTimeAsync(1250);
    states.memoTick = capture();
    await m.command('stop', 'memo');
    states.memoStopped = capture();
    await m.command('start');
    states.meeting = capture();
    m.onClock(61500, true);
    states.paused = capture();
    expect(intervals).toHaveBeenLastCalledWith(expect.any(Function), 250);
    await vi.advanceTimersByTimeAsync(2000);
    expect(capture()).toEqual(states.paused);
    m.onClock(61500, false);
    states.resumed = capture();
    await vi.advanceTimersByTimeAsync(1500);
    states.resumedTick = capture();
    await m.command('stop');
    states.stopped = capture();
    await m.command('start');
    await m.command('cancel');
    states.cancelled = capture();
    expect(vi.getTimerCount()).toBe(0);
    golden(states);
    expect(m.deps.toast).toHaveBeenLastCalledWith('회의 녹음을 취소했습니다', '녹음은 저장하지 않았습니다');
  });

  characterize('captures every working stage, preserves working on stop, and clears on result', async () => {
    const m = setup();
    await m.command('start', 'memo');
    const states: Record<string, ReturnType<typeof capture>> = {};
    for (const stage of ['listen', 'transcribe', 'cleanup', 'paste', 'unknown']) {
      m.stage(stage);
      states[stage] = capture();
    }
    await m.command('stop', 'memo');
    states.stoppedWhileWorking = capture();
    m.result({ id: 'dict-1', status: 'ok' });
    states.result = capture();
    golden(states);
  });

  characterize('captures meeting sheet choices and awaits settings before remember, speakers, close and toggle', async () => {
    const m = setup();
    await m.settings.refresh();
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      m.events.push(['remember', key, value]); setItem.call(this, key, value);
    });
    q<HTMLDialogElement>('#meetStart').close = function () { m.events.push(['close']); this.open = false; };
    m.ui.openStart();
    const states = [sheet()];
    await click('#startSpeakers [data-n="4"]');
    await click('#startKind [data-kind="online"]');
    q<HTMLInputElement>('#startMinutes').checked = false;
    states.push(sheet());
    let resolve!: (value: typeof m.saved) => void;
    m.api.dictSaveSettings.mockImplementationOnce((patch) => {
      m.events.push(['save', patch]);
      return new Promise((done) => { resolve = done; });
    });
    await click('#startYes');
    expect(m.events).toEqual([['save', { meetingSystemAudio: true, minutes: false }]]);
    expect(q<HTMLDialogElement>('#meetStart').open).toBe(true);
    resolve({ meetingSystemAudio: true, minutes: false });
    await settle();
    expect(m.events).toEqual([
      ['save', { meetingSystemAudio: true, minutes: false }], ['remember', 'startSpeakers', '"4"'],
      ['speakers', '4'], ['close'], ['toggle', 'meeting'],
    ]);
    states.push(sheet());
    golden(states);
    await m.command('start');
    expect(q<HTMLSelectElement>('#liveSpeakersSel').value).toBe('4');
    expect(m.recorder.start).toHaveBeenCalledWith({ mode: 'meeting', deviceId: undefined, echoCancellation: false, includeSystem: true });
    await m.command('stop');
    await m.command('start');
    expect(q<HTMLSelectElement>('#liveSpeakersSel').value).toBe('');
  });

  characterize('keeps cancelled sheet selection in memory and skips unchanged settings writes', async () => {
    const m = setup();
    await m.settings.refresh();
    for (const close of ['#startNo', '#startClose', '#meetStart']) {
      m.ui.openStart();
      await click('#startSpeakers [data-n="3"]');
      await click(close);
      expect(q<HTMLDialogElement>('#meetStart').open).toBe(false);
    }
    m.ui.openStart();
    expect(q('#startSpeakers [aria-checked="true"]').dataset.n).toBe('3');
    await click('#startYes');
    expect(m.api.dictSaveSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem('startSpeakers')).toBe('"3"');
    await m.command('start');
    m.ui.openStart();
    expect(q<HTMLDialogElement>('#meetStart').open).toBe(false);
  });

  characterize('wires buttons, pause clock filtering, cancellation confirmation and live speakers', async () => {
    const m = setup();
    m.onClock(30000, true);
    expect(m.ui.status()).toEqual({ mode: null, paused: false });
    await click('#memoBtn');
    expect(m.api.toggle).toHaveBeenLastCalledWith('memo');
    await click('#meetingBtn');
    expect(q<HTMLDialogElement>('#meetStart').open).toBe(true);
    await click('#startNo');
    await m.command('start');
    await click('#meetingBtn');
    expect(m.api.toggle).toHaveBeenLastCalledWith('meeting');
    await click('#pauseBtn');
    expect(m.api.pause).toHaveBeenLastCalledWith(true);
    m.onClock(90000, true);
    m.onClock(100, false, 'memo');
    expect(m.ui.status()).toEqual({ mode: 'meeting', paused: true });
    await click('#pauseBtn');
    expect(m.api.pause).toHaveBeenLastCalledWith(false);
    m.deps.confirm.mockResolvedValueOnce(false);
    m.ui.cancel(); await settle();
    expect(m.api.cancel).not.toHaveBeenCalled();
    expect(m.deps.confirm).toHaveBeenLastCalledWith('회의 녹음을 취소할까요?', '지금까지 녹음한 2분이 저장되지 않고 지워집니다.', '녹음 버리기');
    await click('#cancelBtn');
    expect(m.api.cancel).toHaveBeenCalledOnce();
    const sel = q<HTMLSelectElement>('#liveSpeakersSel');
    sel.value = '8'; sel.dispatchEvent(new Event('change'));
    expect(m.api.setSpeakers).toHaveBeenLastCalledWith('8');
    sel.value = ''; sel.dispatchEvent(new Event('change'));
    expect(m.api.setSpeakers).toHaveBeenLastCalledWith(null);
    await m.ui.prepare();
    expect(m.recorder.prepare).toHaveBeenCalledOnce();
  });

  characterize('serializes a pending start then cancel and recovers the queue after a stop failure', async () => {
    const m = setup();
    let resolve!: (v: { warnings: string[]; timing: { acquireMs: number; startMs: number } }) => void;
    m.recorder.start.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    m.emit('start'); m.emit('cancel');
    await settle();
    expect(m.recorder.stop).not.toHaveBeenCalled();
    resolve({ warnings: ['warning one', 'warning two'], timing: { acquireMs: 1, startMs: 2 } });
    await settle();
    expect(m.recorder.stop).toHaveBeenCalledExactlyOnceWith({ discard: true });
    expect(m.deps.toast.mock.calls).toEqual([
      ['녹음 경고', 'warning one', { bad: true, ms: 7000 }], ['녹음 경고', 'warning two', { bad: true, ms: 7000 }],
      ['회의 녹음을 취소했습니다', '녹음은 저장하지 않았습니다'],
    ]);
    expect(m.api.log).toHaveBeenCalledWith('start timing meeting {"acquireMs":1,"startMs":2}');
    m.recorder.stop.mockRejectedValueOnce(new Error('stop failed'));
    m.emit('stop'); m.emit('start', 'memo');
    await settle();
    expect(m.deps.toast).toHaveBeenLastCalledWith('오류', 'stop failed', { bad: true });
    expect(m.ui.status().mode).toBe('memo');
    await m.command('start');
    expect(m.recorder.start).toHaveBeenCalledTimes(2);
  });

  characterize.each(['EPERM denied', 'EACCES denied', 'Operation not permitted', 'mic unavailable'])('keeps start failure handling for %s', async (message) => {
    const m = setup();
    m.recorder.start.mockRejectedValueOnce(new Error(message));
    await m.command('start');
    expect(m.ui.status().mode).toBe(null);
    expect(m.api.failed).toHaveBeenCalledOnce();
    expect(m.api.failed.mock.invocationCallOrder[0]).toBeLessThan(m.deps.toast.mock.invocationCallOrder[0]!);
    if (message === 'mic unavailable') {
      expect(m.deps.toast).toHaveBeenLastCalledWith('녹음을 시작하지 못했습니다', message, { bad: true, ms: 8000 });
      expect(m.deps.historyChanged).not.toHaveBeenCalled();
    } else {
      expect(m.deps.toast).toHaveBeenLastCalledWith('녹음 폴더에 쓸 수 없습니다', 'macOS가 이 앱의 문서 폴더 접근을 막았습니다', expect.objectContaining({ bad: true, ms: 10000, action: '권한 열기' }));
      m.deps.toast.mock.calls.at(-1)![2].onAction();
      expect(m.api.permOpenSettings).toHaveBeenCalledWith('files');
      expect(m.deps.historyChanged).toHaveBeenCalledOnce();
      expect(m.deps.toast.mock.invocationCallOrder[0]).toBeLessThan(m.deps.historyChanged.mock.invocationCallOrder[0]!);
    }
  });

  characterize.each([9.9, 10])('keeps the %s second save threshold, unawaited history, and silent-system issue', async (durationSec) => {
    const m = setup();
    await m.settings.refresh();
    await m.command('start');
    m.recorder.options.onLevel!('system', -151);
    m.recorder.stop.mockResolvedValueOnce({ files: { mic: { durationSec }, system: { durationSec: 0 } } });
    m.deps.historyChanged.mockImplementation(() => new Promise(() => {}));
    await m.command('stop');
    expect(m.ui.status().mode).toBe(null);
    expect(m.deps.historyChanged).toHaveBeenCalledOnce();
    if (durationSec >= 10) expect(m.deps.toast).toHaveBeenCalledWith('회의 녹음을 저장했습니다', '회의록을 만들기 시작합니다');
    else expect(m.deps.toast).not.toHaveBeenCalled();
    expect(m.issues.get('system-silent')).toMatchObject({ title: '상대방 소리가 녹음되지 않았습니다', sec: 'perms', dismiss: true });
    m.issues.get('system-silent')!.onAction!();
    expect(m.deps.openSettings).toHaveBeenCalledWith('perms');
  });


  characterize('reads current input and settings at start and leaves audible system audio without an issue', async () => {
    const m = setup();
    await m.settings.refresh();
    m.saved.meetingSystemAudio = true;
    m.saved.minutes = false;
    q<HTMLSelectElement>('#micSelect').value = 'wired';
    q<HTMLInputElement>('#echo').checked = true;
    await m.command('start', 'memo');
    expect(m.recorder.start).toHaveBeenLastCalledWith({ mode: 'memo', deviceId: 'wired', echoCancellation: true, includeSystem: false });
    await m.command('stop', 'memo');
    await m.command('start');
    expect(m.recorder.start).toHaveBeenLastCalledWith({ mode: 'meeting', deviceId: 'wired', echoCancellation: true, includeSystem: true });
    m.recorder.options.onLevel!('system', -150);
    m.recorder.stop.mockImplementationOnce(async () => {
      m.recorder.isRecording = false;
      return { files: { system: { durationSec: 10 } } };
    });
    await m.command('stop');
    expect(m.issues.get('system-silent')).toBeUndefined();
    expect(m.deps.toast).toHaveBeenLastCalledWith('회의 녹음을 저장했습니다', '');
    await m.command('start');
    m.recorder.stop.mockResolvedValueOnce({ files: { system: { durationSec: 0 } } });
    await m.command('stop');
    expect(m.issues.get('system-silent')).toBeDefined();
  });

  characterize('warns before changing recording UI and logging start timing', async () => {
    const m = setup();
    const states: unknown[] = [];
    m.deps.toast.mockImplementation(() => states.push(m.ui.status().mode));
    m.api.log.mockImplementation(() => states.push(m.ui.status().mode));
    m.recorder.start.mockResolvedValueOnce({ warnings: ['one', 'two'], timing: { acquireMs: 1, startMs: 2 } });
    await m.command('start');
    expect(states).toEqual([null, null, 'meeting']);
    m.onClock(0, true);
    m.ui.cancel(); await settle();
    expect(m.deps.confirm).toHaveBeenCalledWith('회의 녹음을 취소할까요?', '지금까지 녹음한 내용이 저장되지 않고 지워집니다.', '녹음 버리기');
    const failure = new Error('prepare failed');
    m.recorder.prepare.mockRejectedValueOnce(failure);
    await expect(m.ui.prepare()).rejects.toBe(failure);
  });

  characterize('keeps tape scaling, rolling window, paused samples and reset on resume', async () => {
    const m = setup();
    const canvas = q<HTMLCanvasElement>('#tape');
    Object.defineProperties(canvas, { clientWidth: { value: 300 }, clientHeight: { value: 18 } });
    const ctx = canvas.getContext('2d')!;
    await m.command('start');
    for (let i = 0; i < 65; i++) m.recorder.options.onLevel!('mic', -33);
    vi.mocked(ctx.roundRect).mockClear();
    m.recorder.options.onLevel!('mic', -6);
    expect(ctx.roundRect).toHaveBeenCalledTimes(60);
    expect(ctx.roundRect).toHaveBeenLastCalledWith(296, 0, 2, 18, 1);
    m.onClock(1000, true);
    vi.mocked(ctx.clearRect).mockClear();
    m.recorder.options.onLevel!('mic', 0);
    expect(ctx.clearRect).not.toHaveBeenCalled();
    m.onClock(1000, false);
    vi.mocked(ctx.roundRect).mockClear();
    m.recorder.options.onLevel!('mic', -Infinity);
    expect(ctx.roundRect).toHaveBeenCalledExactlyOnceWith(296, 8, 2, 2, 1);
  });

  characterize.each(['error', 'no-permission', 'failed', 'ok'])('keeps dictation %s toast and idle UI', (status) => {
    const m = setup();
    m.stage('paste');
    m.result({ status, error: 'dict error', id: 'dict-id' });
    expect(q('#live').dataset.state).toBe('idle');
    if (status === 'error') expect(m.deps.toast).toHaveBeenCalledWith('받아쓰기 실패', 'dict error', { bad: true, ms: 7000 });
    if (status === 'no-permission') {
      expect(m.deps.toast).toHaveBeenCalledWith('입력하지 못했습니다', '손쉬운 사용 권한이 없어 클립보드에만 복사했습니다. ⌘V로 붙여 넣으세요.', expect.objectContaining({ bad: true, action: '권한 보기', ms: 8000 }));
      m.deps.toast.mock.calls[0]![2].onAction();
      expect(m.deps.openSettings).toHaveBeenCalledWith('perms');
    }
    if (status === 'failed') expect(m.deps.toast).toHaveBeenCalledWith('입력하지 못했습니다', '클립보드에 복사해 두었습니다. ⌘V로 붙여 넣으세요.', { bad: true, ms: 7000 });
    if (status === 'ok') expect(m.deps.toast).not.toHaveBeenCalled();
    expect(m.deps.dictationFinished).toHaveBeenCalledExactlyOnceWith('dict-id');
    m.result({ status: 'ok' });
    expect(m.deps.dictationFinished).toHaveBeenLastCalledWith(null);
  });
});
