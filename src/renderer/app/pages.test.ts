// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AskJob } from '../entities/ask/index.ts';
import { createIssueStore } from '../entities/issue/index.ts';
import type { SettingsState, SettingsStore } from '../entities/settings/index.ts';
import type { MeetingDeps, MeetingDoc } from '../pages/meeting/index.ts';
import type { RecorderApi } from '../shared/api/index.ts';
import { reactPage } from '../shared/page-host/index.tsx';
import { createPages, type PagesDeps } from './pages.ts';
import { createSession } from './session.ts';
import type { HistoryState } from './history.ts';
import type { Route, Router } from './router.ts';

vi.mock('../shared/page-host/index.tsx', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared/page-host/index.tsx')>(),
  reactPage: vi.fn(() => ({ el: document.createElement('div') })),
}));

const job = (id: string, status: AskJob['status'] = 'done'): AskJob => ({
  id, status, q: id, stage: status, t0: 0, ms: 1,
  scope: { count: null, from: '', to: '' }, results: [],
});
const rows = [
  { id: 'one', dir: '/one', mode: 'meeting', startedAt: '2026-11-13', durationSec: 60 },
  { id: 'two', dir: '/two', mode: 'meeting', startedAt: '2026-11-13', durationSec: 120 },
];
const strays = [
  { id: 'one', dir: '/one', reason: 'no-meta', audio: true, bytes: 1024 },
  { id: 'two', dir: '/two', reason: 'no-meta', audio: false, bytes: 2048 },
];

function setup(initialize = true) {
  let state: HistoryState = { rows, strays, totals: null, access: null };
  let settings: SettingsState = { saved: null, providers: null, engine: null };
  let route: Route = { name: 'home', arg: null };
  const api = {
    onAsk: vi.fn(), askSeen: vi.fn(), askRemove: vi.fn().mockResolvedValue(true),
    askStart: vi.fn().mockResolvedValue(job('new')), askStop: vi.fn().mockResolvedValue(true),
    askList: vi.fn().mockResolvedValue([]),
    trashMeeting: vi.fn<(dir?: string) => Promise<void>>().mockResolvedValue(undefined),
    deleteDictation: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    copy: vi.fn(), repaste: vi.fn().mockResolvedValue('pasted'), dictPage: vi.fn(),
    reveal: vi.fn(), filePath: vi.fn(),
  };
  const history = {
    getSnapshot: () => state, reload: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}), connect: vi.fn(),
  };
  const settingsStore: SettingsStore = {
    getSnapshot: () => settings, subscribe: vi.fn(() => () => {}),
    refresh: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined),
    refreshProviders: vi.fn().mockResolvedValue(undefined), connect: vi.fn(),
  };
  const router: Router = {
    route: () => route, current: () => null, refresh: vi.fn(), navigate: vi.fn(),
    replace: vi.fn(), setCrumbs: vi.fn(), canGoBack: () => false, connect: vi.fn(),
  };
  const session = createSession();
  const issues = createIssueStore();
  const deps = {
    api: api as unknown as RecorderApi, history, settingsStore, session, issues,
    router: () => router,
    meeting: {
      initialize: vi.fn<() => MeetingDeps>(), get deps(): MeetingDeps { throw new Error('meeting route not used'); },
      docs: new Map<string, MeetingDoc>(), openReview: vi.fn(),
    },
    recording: { openStart: vi.fn() }, openSettings: vi.fn(),
    importMeeting: vi.fn().mockResolvedValue(undefined),
    toast: vi.fn<PagesDeps['toast']>(),
    confirm: vi.fn<PagesDeps['confirm']>().mockResolvedValue(true),
    dictations: () => [], meetings: () => state.rows,
  } satisfies PagesDeps;
  const pages = createPages(deps);
  const create = () => ({ ...pages.createHome(), ...pages.createDictations(), ...pages.createMeetings(), ...pages.createAsk(), ...pages.createDictionary() });
  return {
    ...deps, api, pages, create, ...(initialize ? create() : {}),
    setHistory: (next: HistoryState) => { state = next; },
    setSettings: (next: SettingsState) => { settings = next; },
    setRoute: (next: Route) => { route = next; },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div class="hover-tip"></div><div id="view"></div>';
  localStorage.clear();
  window.history.replaceState(null, '', '#home');
  vi.clearAllMocks();
});

describe('page composition', () => {
  it('defers storage, ask subscription and DOM append to their original creation stages', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const s = setup(false);
    expect(read).not.toHaveBeenCalled();
    expect(s.api.onAsk).not.toHaveBeenCalled();
    expect(document.querySelector('.ask-root')).toBeNull();
    s.pages.createHome();
    expect(read).not.toHaveBeenCalled();
    localStorage.setItem('showMarks', 'false');
    s.pages.createDictations();
    expect(read).toHaveBeenCalledExactlyOnceWith('showMarks');
    expect(s.session.showMarks).toBe(false);
    const meetings = s.pages.createMeetings();
    const changed = vi.fn();
    meetings.meetingsSource.subscribe(changed);
    s.api.onAsk.mockImplementation(() => {
      expect(document.querySelector('.ask-root')).toBeNull();
    });
    const ask = s.pages.createAsk();
    expect(s.api.onAsk).toHaveBeenCalledTimes(1);
    expect(document.body.lastElementChild).toBe(ask.askRoot);
    expect(document.querySelector('.hover-tip')!.compareDocumentPosition(ask.askRoot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    ask.askStore.load([job('one')]);
    expect(changed).toHaveBeenCalledTimes(1);
    read.mockRestore();
  });

  it.each([
    { ask: 'question', home: 'hand' as const, want: 'ask:question' },
    { ask: null, home: 'rest' as const, want: 'rest' },
    { ask: null, home: null, want: 'all' },
    { ask: '', home: 'hand' as const, want: 'hand' },
  ])('consumes ask > home > all intents ($want)', ({ ask, home, want }) => {
    const s = setup();
    s.askStore!.load([job('question')]);
    if (home) s.homeActions!.openMeetings(home);
    s.session.askPending = ask;
    s.pages.routes.meetings!.mount(null);
    expect(s.session.meetFilter).toBe(want);
    expect(s.meetingsSource!.getSnapshot().filter).toBe(want);
    expect(s.session.askPending).toBeNull();
    expect(s.session.meetFilterPending).toBeNull();
    expect(reactPage).toHaveBeenCalled();
    s.pages.routes.meetings!.mount(null);
    expect(s.meetingsSource!.getSnapshot().filter).toBe('all');
  });

  it('opens ask tabs in place when already on meetings and falls back for removed/blocked tabs', () => {
    const s = setup();
    const good = job('good');
    s.askStore!.load([good, job('blocked', 'blocked')]);
    s.askStore!.go(good);
    expect(s.session.askPending).toBe('good');
    expect(location.hash).toBe('#meetings');
    s.pages.routes.meetings!.mount(null);
    s.setRoute({ name: 'meetings', arg: null });
    const view = document.getElementById('view')!;
    view.scrollTop = 91;
    s.askStore!.go(good);
    expect(view.scrollTop).toBe(0);
    expect(s.session.askPending).toBeNull();
    expect(s.meetingsSource!.getSnapshot().filter).toBe('ask:good');
    for (const id of ['blocked', 'missing']) {
      s.meetingsActions!.setFilter(`ask:${id}`);
      expect(s.meetingsSource!.getSnapshot().filter).toBe('all');
      expect(s.session.meetFilter).toBe('all');
    }
    expect(s.meetingsSource!.getSnapshot().asks.map((j) => j.id)).toEqual(['good']);
  });

  it('replaces openRaw Sets, keeps old snapshots intact and only changes source identities for their dependencies', () => {
    const s = setup();
    const source = s.dictationsSource!;
    const before = source.getSnapshot();
    const homeBefore = s.homeSource!.getSnapshot();
    const statsBefore = s.statsSource!.getSnapshot();
    const notices: unknown[] = [];
    source.subscribe(() => notices.push(source.getSnapshot()));
    source.changed();
    expect(source.getSnapshot()).toBe(before);
    s.dictationsActions!.toggleRaw('one');
    const opened = source.getSnapshot();
    expect(opened).not.toBe(before);
    expect(opened.openRaw).not.toBe(before.openRaw);
    expect([...opened.openRaw]).toEqual(['one']);
    expect([...before.openRaw]).toEqual([]);
    expect(s.homeSource!.getSnapshot()).not.toBe(homeBefore);
    expect(s.statsSource!.getSnapshot()).toBe(statsBefore);
    s.dictationsActions!.toggleRaw('one');
    expect(source.getSnapshot().openRaw).not.toBe(opened.openRaw);
    expect([...opened.openRaw]).toEqual(['one']);
    expect([...source.getSnapshot().openRaw]).toEqual([]);
    const closed = source.getSnapshot();
    s.dictationsActions!.setShowMarks(true);
    expect(source.getSnapshot()).toBe(closed);
    s.dictationsActions!.setShowMarks(false);
    expect(source.getSnapshot()).not.toBe(closed);
    expect(localStorage.getItem('showMarks')).toBe('false');
    const marks = source.getSnapshot();
    s.session.freshId = 'fresh';
    expect(source.getSnapshot()).not.toBe(marks);
    const fresh = source.getSnapshot();
    s.setHistory({ ...s.history.getSnapshot(), strays: [] });
    expect(source.getSnapshot()).toBe(fresh);
    s.setHistory({ ...s.history.getSnapshot(), rows: [...rows] });
    expect(source.getSnapshot()).not.toBe(fresh);
    const catalog = source.getSnapshot();
    s.issues.set('engine', { title: '문제', sec: 'general' });
    expect(source.getSnapshot()).not.toBe(catalog);
    expect(notices).toHaveLength(5);
  });

  it.each(['meetings', 'strays'] as const)('confirms then trashes %s sequentially, continues after failure and does not await reload', async (kind) => {
    const s = setup();
    const confirmation = Promise.withResolvers<boolean>();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    s.confirm.mockReturnValue(confirmation.promise);
    s.api.trashMeeting.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    s.history.reload.mockReturnValue(new Promise(() => {}));
    const pending = kind === 'meetings' ? s.meetingsActions!.trash(rows) : s.meetingsActions!.trashStrays(strays);
    expect(s.confirm).toHaveBeenCalledWith(
      kind === 'meetings' ? '녹음 2개를 휴지통으로 옮길까요?' : '폴더 2개를 휴지통으로 옮길까요?',
      kind === 'meetings' ? '녹음 폴더째(총 03:00) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.' : '폴더째(총 3KB) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.',
      '휴지통으로',
    );
    expect(s.api.trashMeeting).not.toHaveBeenCalled();
    confirmation.resolve(true);
    await Promise.resolve();
    expect(s.api.trashMeeting.mock.calls).toEqual([['/one']]);
    expect(s.toast).not.toHaveBeenCalled();
    first.reject(new Error('busy'));
    await Promise.resolve();
    await Promise.resolve();
    expect(s.api.trashMeeting.mock.calls).toEqual([['/one'], ['/two']]);
    expect(s.history.reload).not.toHaveBeenCalled();
    second.resolve();
    await pending;
    expect(s.toast).toHaveBeenCalledWith('1개를 옮기고 1개는 옮기지 못했습니다', kind === 'meetings' ? '회의록을 만드는 중인 녹음은 옮길 수 없습니다' : '', { bad: true });
    expect(s.history.reload).toHaveBeenCalledTimes(1);
    expect(s.toast.mock.invocationCallOrder[0]).toBeLessThan(s.history.reload.mock.invocationCallOrder[0]!);
  });

  it.each(['meetings', 'strays'] as const)('keeps %s untouched on cancel and preserves singular confirm/success text', async (kind) => {
    const s = setup();
    const run = () => kind === 'meetings' ? s.meetingsActions!.trash([rows[0]!]) : s.meetingsActions!.trashStrays([strays[0]!]);
    s.confirm.mockResolvedValueOnce(false);
    await run();
    expect(s.confirm.mock.calls[0]).toEqual([
      kind === 'meetings' ? '이 녹음을 휴지통으로 옮길까요?' : "'one' 폴더를 휴지통으로 옮길까요?",
      kind === 'meetings' ? '녹음 폴더째(총 01:00) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.' : '폴더째(총 1KB) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.',
      '휴지통으로',
    ]);
    expect(s.api.trashMeeting).not.toHaveBeenCalled();
    expect(s.history.reload).not.toHaveBeenCalled();
    expect(s.toast).not.toHaveBeenCalled();
    await run();
    expect(s.api.trashMeeting).toHaveBeenCalledExactlyOnceWith('/one');
    expect(s.toast).toHaveBeenCalledWith('1개를 휴지통으로 옮겼습니다', '', { bad: false });
  });

  it('confirms deletion before the API and waits for deletion before toast/reload', async () => {
    const s = setup();
    s.confirm.mockResolvedValueOnce(false);
    await s.dictationsActions!.remove('memo');
    expect(s.api.deleteDictation).not.toHaveBeenCalled();
    const deletion = Promise.withResolvers<void>();
    s.api.deleteDictation.mockReturnValue(deletion.promise);
    const removed = s.dictationsActions!.remove('memo');
    await Promise.resolve();
    expect(s.confirm).toHaveBeenCalledWith('이 받아쓰기를 지울까요?', '기록과 통계에서 빠집니다. 되돌릴 수 없습니다.', '지우기');
    expect(s.api.deleteDictation).toHaveBeenCalledExactlyOnceWith('memo');
    expect(s.toast).not.toHaveBeenCalled();
    expect(s.history.reload).not.toHaveBeenCalled();
    deletion.resolve();
    await removed;
    expect(s.toast).toHaveBeenCalledExactlyOnceWith('받아쓰기를 지웠습니다');
    expect(s.history.reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, null, null],
    ['codex', null, null],
    ['codex', {}, true],
    ['codex', { codex: { loggedIn: false } }, true],
    ['codex', { 'claude-code': { loggedIn: true }, codex: { loggedIn: true } }, false],
    ['auto', { 'claude-code': { loggedIn: true }, codex: { loggedIn: true } }, false],
    ['auto', { codex: { loggedIn: true } }, true],
    ['auto', { codex: { loggedIn: false } }, false],
    ['auto', {}, undefined],
    ['api', { codex: { loggedIn: true } }, false],
    ['claude-code', { codex: { loggedIn: true } }, false],
    [null, { codex: { loggedIn: true } }, false],
  ])('uses Codex according to provider %s and accounts %j', (provider, providers, expected) => {
    const s = setup();
    s.setSettings({ saved: provider ? { provider } : null, providers, engine: null });
    expect(s.askUsesCodex!()).toBe(expected);
    expect(s.askWidgetDeps!.usesCodex()).toBe(Boolean(expected));
    s.setSettings({ saved: { provider: 'codex' }, providers: {}, engine: null });
    expect(s.askWidgetDeps!.usesCodex()).toBe(true);
    expect(s.askWidgetDeps!.noteClosed()).toBe(false);
    s.askWidgetDeps!.closeNote();
    expect(localStorage.getItem('askNoteClosed')).toBe('true');
    expect(s.askWidgetDeps!.noteClosed()).toBe(true);
  });
});
