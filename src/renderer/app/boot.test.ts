// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderApi } from '../shared/api/index.ts';
import { mountRecording, type RecordingDeps } from '../features/recording/index.ts';
import { mountSettings, startOnboarding } from '../features/configuration/index.ts';
import { mountPalette } from '../features/palette/index.ts';
import { createToaster } from '../shared/ui/index.tsx';
import { createPages } from './pages.ts';
import { startRenderer } from './boot.ts';

const { events, record } = vi.hoisted(() => {
  const events: string[] = [];
  return { events, record: (name: string) => { events.push(name); } };
});

vi.mock('../features/recording/index.ts', () => ({
  mountRecording: vi.fn((deps: RecordingDeps) => {
    record('recording');
    deps.api.onDictStage(vi.fn());
    deps.api.onDictResult(vi.fn());
    return { status: vi.fn(), openStart: vi.fn(), cancel: vi.fn(), prepare: vi.fn(async () => { record('prepare'); }) };
  }),
}));
vi.mock('../features/configuration/index.ts', () => ({
  mountSettings: vi.fn(() => {
    record('settings');
    return {
      open: vi.fn(), setupListeners: new Set(), updateMicHint: vi.fn(),
      refreshPermissions: vi.fn(async () => { record('permissions'); }),
      showRecordingsDir: vi.fn(() => record('recordingsDir')),
      loadDevices: vi.fn(async () => { record('devices'); }),
    };
  }),
  startOnboarding: vi.fn(() => record('onboarding')),
}));
vi.mock('../features/palette/index.ts', () => ({ mountPalette: vi.fn(() => { record('palette'); return { open: vi.fn() }; }) }));
vi.mock('../features/import-meeting/index.ts', () => ({ mountImportMeeting: vi.fn(() => { record('import'); return { open: vi.fn() }; }) }));
vi.mock('../shared/page-host/index.tsx', () => ({ mountReact: vi.fn(() => record('widget')) }));
vi.mock('../features/ask/index.ts', () => ({ AskWidget: vi.fn() }));
vi.mock('../shared/ui/index.tsx', () => ({
  createToaster: vi.fn(() => vi.fn((title: string) => record(`toast:${title}`))), confirmBox: vi.fn(),
  installTooltips: vi.fn(() => { record('tooltips'); }),
}));
vi.mock('./meeting.ts', () => ({
  createMeeting: vi.fn(() => {
    record('meeting');
    return { docs: new Map(), initialize: vi.fn(() => record('meeting.initialize')) };
  }),
}));
vi.mock('./router.ts', () => ({
  createRouter: vi.fn(() => {
    record('router');
    return { connect: () => record('router.connect'), route: () => ({ name: 'home' }), refresh: vi.fn(), navigate: () => record('navigate') };
  }),
}));
vi.mock('./pages.ts', () => ({
  createPages: vi.fn(() => {
    record('pages');
    const source = () => ({ changed: vi.fn() });
    return {
      routes: {},
      createHome: () => { record('home'); return { statsSource: source(), homeSource: source() }; },
      createDictations: () => { record('dictations'); return { dictationsSource: source() }; },
      createMeetings: () => { record('meetings'); return { meetingsSource: source() }; },
      createAsk: () => {
        record('ask');
        return { askStore: { load: () => record('ask.load') }, askRoot: document.createElement('div'), askWidgetDeps: {} };
      },
      createDictionary: () => { record('dictionary'); return { vocabulary: source(), vocabWords: () => [] }; },
    };
  }),
}));

const documentListeners = vi.spyOn(document, 'addEventListener');
const windowListeners = vi.spyOn(window, 'addEventListener');

beforeEach(() => {
  events.length = 0;
  vi.clearAllMocks();
  document.body.innerHTML = '<div class="shell" hidden></div><span id="settingsDot"></span><span id="permDot"></span><span id="accountsDot"></span><span id="countDict"></span><span id="countMeet"></span><span id="countWords"></span><select id="micSelect"><option value="mic">Mic</option></select><input id="echo" type="checkbox" checked><dialog id="palette"></dialog>';
});
afterEach(() => {
  for (const [type, listener, options] of documentListeners.mock.calls) document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls) window.removeEventListener(type, listener, options);
});

function setup() {
  const onboarding = Promise.withResolvers<{ completed: boolean }>();
  const info = Promise.withResolvers<{ recordingsDir: string; defaultRecordingsDir: string; capability: string; fnWarning: string }>();
  const settings = Promise.withResolvers<{ engine: null }>();
  const rows = Promise.withResolvers<[]>();
  const ask = Promise.withResolvers<[]>();
  const api = {
    onFnStatus: vi.fn(() => record('onFnStatus')),
    onRecordingsChanged: vi.fn(() => record('onRecordingsChanged')),
    onDictStage: vi.fn(() => record('onDictStage')),
    onDictResult: vi.fn(() => record('onDictResult')),
    onOnboardingFn: vi.fn<(fn: (s: { down: boolean }) => void) => void>(() => record('onOnboardingFn')),
    onOnboardingTap: vi.fn<(fn: () => void) => void>(() => record('onOnboardingTap')),
    onboardingGet: vi.fn(() => { record('onboardingGet'); return onboarding.promise; }),
    appReady: vi.fn(() => record(`appReady:${document.querySelector<HTMLElement>('.shell')!.hidden}`)),
    info: vi.fn(() => { record('info'); return info.promise; }),
    dictSettings: vi.fn(() => { record('settings.refresh'); return settings.promise; }),
    providers: vi.fn(async () => { record('providers'); return {}; }),
    history: vi.fn(() => { record('history'); return rows.promise; }),
    recordingsAccess: vi.fn(async () => ({ ok: false, dir: '/Users/test/Documents/Recordings', code: 'EACCES' })),
    strayFolders: vi.fn(async () => []), dictStats: vi.fn(async () => null),
    askList: vi.fn(() => { record('ask.list'); return ask.promise; }),
    permOpenSettings: vi.fn(),
  };
  Object.defineProperty(window, 'recorderApi', { configurable: true, value: api as unknown as RecorderApi });
  return { api, onboarding, info, settings, rows, ask };
}

async function advance() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('renderer boot', () => {
  it.each([true, false])('preserves synchronous setup and awaited boot order (completed=%s)', async (completed) => {
    const s = setup();
    const boot = startRenderer();
    let finished = false;
    void boot.then(() => { finished = true; });
    expect(events).toEqual([
      'tooltips', 'recording', 'onFnStatus', 'meeting', 'onRecordingsChanged', 'pages', 'router', 'router.connect',
      'home', 'dictations', 'meetings', 'ask', 'import', 'meeting.initialize', 'dictionary', 'palette', 'settings',
      'onDictStage', 'onDictResult', 'onOnboardingFn', 'onOnboardingTap', 'onboardingGet',
    ]);
    expect(documentListeners.mock.calls.some(([type]) => type === 'DOMContentLoaded')).toBe(false);
    const deps = vi.mocked(mountRecording).mock.calls[0]![0];
    expect(deps.readInput()).toEqual({ deviceId: 'mic', echoCancellation: true });
    const settingsUi = vi.mocked(mountSettings).mock.results[0]!.value;
    const palette = vi.mocked(mountPalette).mock.results[0]!.value;
    for (const key of ['K', ',']) {
      const event = new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(palette.open).toHaveBeenCalledOnce();
    expect(settingsUi.open).toHaveBeenCalledExactlyOnceWith(undefined);
    const devices = Promise.withResolvers<void>();
    vi.mocked(settingsUi.loadDevices).mockImplementation(() => { record('devices'); return devices.promise; });
    const prepare = Promise.withResolvers<void>();
    const recording = vi.mocked(mountRecording).mock.results[0]!.value;
    vi.mocked(recording.prepare).mockImplementation(() => { record('prepare'); return prepare.promise; });
    events.length = 0;
    s.onboarding.resolve({ completed });
    await advance();
    expect(events).toEqual(completed ? ['appReady:false', 'info'] : ['onboarding', 'appReady:true', 'info']);
    if (!completed) {
      const ctx = vi.mocked(startOnboarding).mock.calls[0]![0];
      const fn = vi.fn();
      const tap = vi.fn();
      ctx.fnListeners.add(fn);
      ctx.tapListeners.add(tap);
      s.api.onOnboardingFn.mock.calls[0]![0]({ down: true });
      s.api.onOnboardingTap.mock.calls[0]![0]();
      expect(fn).toHaveBeenCalledExactlyOnceWith({ down: true });
      expect(tap).toHaveBeenCalledOnce();
    }
    events.length = 0;
    s.info.resolve({ recordingsDir: '/recordings', defaultRecordingsDir: '/default', capability: 'unsupported', fnWarning: 'fn warning' });
    await advance();
    expect(events).toEqual(['recordingsDir', 'settings.refresh']);
    expect(settingsUi.showRecordingsDir).toHaveBeenCalledExactlyOnceWith('/recordings', '/default');
    s.settings.resolve({ engine: null });
    await advance();
    expect(events.slice(2)).toEqual(['permissions', 'providers', 'history']);
    s.rows.resolve([]);
    await advance();
    expect(events.at(-1)).toBe('ask.list');
    const issues = vi.mocked(createPages).mock.calls[0]![0].issues;
    expect(issues.get('folder')).toMatchObject({ action: '권한 열기', sec: 'general', detail: expect.stringContaining('~/Documents/Recordings') });
    issues.get('folder')!.onAction!();
    expect(s.api.permOpenSettings).toHaveBeenCalledExactlyOnceWith('files');
    s.ask.resolve([]);
    await advance();
    expect(events.slice(-5)).toEqual(['ask.load', 'navigate', 'widget', 'toast:이 macOS에서는 상대방 소리를 녹음할 수 없습니다', 'devices']);
    expect(issues.get('fnUsage')).toMatchObject({ detail: 'fn warning', dismiss: true });
    expect(finished).toBe(false);
    expect(recording.prepare).not.toHaveBeenCalled();
    devices.resolve();
    await boot;
    expect(finished).toBe(true);
    expect(events.at(-1)).toBe('prepare');
    prepare.reject(new Error('engine unavailable'));
    await advance();
    expect(vi.mocked(createToaster).mock.results[0]!.value).toHaveBeenLastCalledWith('오디오 엔진 준비 실패', 'engine unavailable', { bad: true });
  });
});
