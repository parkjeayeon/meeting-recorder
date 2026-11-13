// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsStore } from '../entities/settings/index.ts';
import type { RecorderApi } from '../shared/api/index.ts';
import { createMeeting, type MeetingAppDeps } from './meeting.ts';
import type { HistoryRow, HistoryStore } from './history.ts';
import type { Route, Router } from './router.ts';

function setup(initialize = true) {
  let route: Route = { name: 'home', arg: null };
  const records: HistoryRow[] = [{ id: 'one', dir: '/one', startedAt: '2026-11-13', durationSec: 60, review: { open: 2 } }];
  const api = {
    onMinutes: vi.fn<(cb: (event: { id: string; status: string; offline?: boolean }) => void) => void>(),
    onMeetingChanged: vi.fn<(cb: (event: { id: string }) => void) => void>(),
    history: vi.fn<() => Promise<readonly HistoryRow[]>>().mockResolvedValue(records),
  };
  const history: HistoryStore = {
    getSnapshot: () => ({ rows: records, strays: [], totals: null, access: null }),
    subscribe: vi.fn(() => () => {}), connect: vi.fn(),
    reload: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const reload = vi.fn();
  const page = { el: document.createElement('div'), reload };
  const router: Router = {
    route: () => route, current: () => page,
    navigate: vi.fn(), refresh: vi.fn(), replace: vi.fn(), setCrumbs: vi.fn(),
    canGoBack: vi.fn(() => true), connect: vi.fn(),
  };
  const settingsStore: SettingsStore = {
    getSnapshot: () => ({ saved: null, engine: null, providers: null }),
    subscribe: vi.fn(() => () => {}), connect: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined), save: vi.fn().mockResolvedValue(undefined),
    refreshProviders: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    api: api as unknown as RecorderApi, history, settingsStore,
    router: vi.fn(() => router), toast: vi.fn<MeetingAppDeps['toast']>(),
    confirm: vi.fn<MeetingAppDeps['confirm']>().mockResolvedValue(true),
    fullDate: vi.fn((d: Date) => d.toISOString()),
  } satisfies MeetingAppDeps;
  const meeting = createMeeting(deps);
  if (initialize) meeting.initialize();
  return {
    ...deps, api, meeting, router, reload, records,
    setRoute: (next: Route) => { route = next; }, getRouter: deps.router,
    minutes: api.onMinutes.mock.calls[0]![0], changed: api.onMeetingChanged.mock.calls[0]![0],
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '#home');
});
afterEach(() => vi.restoreAllMocks());

describe('meeting composition', () => {
  it('registers minutes then meeting-changed before creating audio/playback or reading follow', () => {
    const audio = vi.spyOn(window, 'Audio').mockImplementation(function () { return document.createElement('audio'); });
    const read = vi.spyOn(Storage.prototype, 'getItem');
    const s = setup(false);
    expect(s.api.onMinutes).toHaveBeenCalledTimes(1);
    expect(s.api.onMeetingChanged).toHaveBeenCalledTimes(1);
    expect(s.api.onMinutes.mock.invocationCallOrder[0]).toBeLessThan(s.api.onMeetingChanged.mock.invocationCallOrder[0]!);
    expect(audio).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(s.getRouter).not.toHaveBeenCalled();
    localStorage.setItem('follow', 'false');
    const deps = s.meeting.initialize();
    expect(audio).toHaveBeenCalledTimes(1);
    expect(s.api.onMeetingChanged.mock.invocationCallOrder[0]).toBeLessThan(audio.mock.invocationCallOrder[0]!);
    expect(read).toHaveBeenCalledExactlyOnceWith('follow');
    expect(deps.playback.audio.preload).toBe('metadata');
    expect(deps.playback.audio.isConnected).toBe(false);
    expect(deps.playback.getSnapshot().follow).toBe(false);
    deps.playback.setFollow(true);
    expect(localStorage.getItem('follow')).toBe('true');
    expect(s.meeting.deps).toBe(deps);
    expect(deps.docs).toBe(s.meeting.docs);
    expect(s.getRouter).not.toHaveBeenCalled();
  });

  it('invalidates done docs immediately, starts toast lookup before reload, and consumes review intent once', async () => {
    const s = setup();
    const details = Promise.withResolvers<readonly HistoryRow[]>();
    s.api.history.mockReturnValue(details.promise);
    s.meeting.docs.set('one', { minutes: 'old' });
    const other = { minutes: 'keep' };
    s.meeting.docs.set('other', other);
    s.setRoute({ name: 'meeting', arg: 'one' });
    s.minutes({ id: 'one', status: 'done' });
    expect(s.meeting.docs.has('one')).toBe(false);
    expect(s.meeting.docs.get('other')).toBe(other);
    expect(s.api.history).toHaveBeenCalledTimes(1);
    expect(s.history.reload).toHaveBeenCalledTimes(1);
    expect(s.api.history.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(s.history.reload).mock.invocationCallOrder[0]!);
    expect(s.toast).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
    details.resolve(s.records);
    await details.promise;
    expect(s.toast).toHaveBeenCalledWith('회의록 초안을 만들었습니다', '확인 필요 2개 · 확인하면 회의록을 확정합니다', {
      action: '확인하기', ms: 10000, onAction: expect.any(Function),
    });
    s.toast.mock.calls[0]![2]!.onAction!();
    expect(location.hash).toBe('#meeting/one');
    expect(s.meeting.deps.takeOpenReview('other')).toBe(false);
    expect(s.meeting.deps.takeOpenReview('one')).toBe(true);
    expect(s.meeting.deps.takeOpenReview('one')).toBe(false);
  });

  it.each([
    { rows: [{ id: 'one', startedAt: '', durationSec: 65 }], detail: '01:05' },
    { rows: [], detail: '' },
  ])('opens completed minutes without review when lookup returns $detail', async ({ rows, detail }) => {
    const s = setup();
    s.api.history.mockResolvedValue(rows);
    s.minutes({ id: 'one', status: 'done' });
    await Promise.resolve();
    expect(s.toast).toHaveBeenCalledWith('회의록 초안을 만들었습니다', detail, {
      action: '열기', ms: 10000, onAction: expect.any(Function),
    });
    s.toast.mock.calls[0]![2]!.onAction!();
    expect(s.meeting.deps.takeOpenReview('one')).toBe(false);
  });

  it.each([
    { name: 'meeting', arg: 'one', reloads: 1 },
    { name: 'meeting', arg: 'other', reloads: 0 },
    { name: 'meetings', arg: 'one', reloads: 0 },
    { name: 'home', arg: null, reloads: 0 },
  ])('reloads only the open matching meeting ($name/$arg)', ({ name, arg, reloads }) => {
    const s = setup();
    s.setRoute({ name, arg });
    s.meeting.docs.set('one', { minutes: 'old' });
    s.meeting.docs.set('other', { minutes: 'keep' });
    s.reload.mockImplementation(() => {
      expect(s.meeting.docs.has('one')).toBe(false);
      expect(s.history.reload).not.toHaveBeenCalled();
    });
    s.changed({ id: 'one' });
    expect(s.meeting.docs.has('one')).toBe(false);
    expect(s.meeting.docs.has('other')).toBe(true);
    expect(s.reload).toHaveBeenCalledTimes(reloads);
    expect(s.history.reload).toHaveBeenCalledTimes(1);
    expect(s.api.history).not.toHaveBeenCalled();
    expect(s.toast).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', false, null, null],
    ['short', false, '회의 녹음을 저장했습니다', '10초 미만이라 회의록은 만들지 않았습니다'],
    ['error', false, '회의록을 만들지 못했습니다', ''],
    ['error', true, '인터넷 연결이 없어 회의록을 쓰지 못했습니다', '녹취는 저장했습니다. 연결되면 이어서 씁니다'],
  ] as const)('keeps docs for %s and preserves its notification', (status, offline, title, detail) => {
    const s = setup();
    const doc = { minutes: 'keep' };
    s.meeting.docs.set('one', doc);
    s.minutes({ id: 'one', status, offline });
    expect(s.meeting.docs.get('one')).toBe(doc);
    expect(s.api.history).not.toHaveBeenCalled();
    expect(s.history.reload).toHaveBeenCalledTimes(1);
    if (!title) expect(s.toast).not.toHaveBeenCalled();
    else if (status === 'short') expect(s.toast).toHaveBeenCalledExactlyOnceWith(title, detail);
    else {
      expect(s.toast).toHaveBeenCalledWith(title, detail, { bad: true, action: '보기', onAction: expect.any(Function) });
      s.toast.mock.calls[0]![2]!.onAction!();
      expect(location.hash).toBe('#meeting/one');
    }
  });

  it('forwards late router, settings and history commands and keeps review intent across nonmatching pages', async () => {
    const s = setup();
    const deps = s.meeting.deps;
    expect(deps.records()).toBe(s.records);
    deps.replaceRoute('#home');
    expect(s.router.replace).toHaveBeenCalledExactlyOnceWith('#home');
    expect(deps.canGoBack()).toBe(true);
    deps.setCrumbs('제목');
    expect(s.router.setCrumbs).toHaveBeenCalledExactlyOnceWith('제목');
    await deps.refreshSettings();
    expect(s.settingsStore.refresh).toHaveBeenCalledTimes(1);
    await deps.loadHistory();
    expect(s.history.reload).toHaveBeenCalledTimes(1);
    await deps.confirm('제목', '설명', '확인');
    expect(s.confirm).toHaveBeenCalledExactlyOnceWith('제목', '설명', '확인');
    const date = new Date('2026-11-13');
    expect(deps.fullDate(date)).toBe(date.toISOString());
    s.meeting.openReview('one');
    expect(deps.takeOpenReview('other')).toBe(false);
    expect(deps.takeOpenReview('one')).toBe(true);
    expect(deps.takeOpenReview('one')).toBe(false);
  });
});
