import { describe, expect, it, vi } from 'vitest';
import { createSource } from '../shared/lib/index.ts';
import { createHistoryStore, type HistoryApi, type HistoryState } from './history.ts';

function catalog(id = 'meeting-1'): HistoryState {
  return {
    rows: [
      { id, mode: 'meeting', dir: `/recordings/${id}`, startedAt: '2026-11-13T09:00:00Z', durationSec: 60 },
      { id: 'memo-1', mode: 'memo', startedAt: '2026-11-13T10:00:00Z', durationSec: 5, transcript: { raw: '원문', text: '받아쓴 글' } },
    ],
    strays: [{ id: 'stray-1', dir: '/recordings/stray-1', reason: 'no-meta', audio: true, bytes: 1024 }],
    totals: { count: 1, total: 5, today: 5, todayCount: 1, wpm: null, streak: 1, days: [], apps: [], languages: [], asrMs: null, cleanup: [] },
    access: { ok: false, dir: '/recordings', code: 'EACCES' },
  };
}

function fakeApi(data = catalog()) {
  return {
    history: vi.fn<HistoryApi['history']>().mockResolvedValue(data.rows),
    recordingsAccess: vi.fn<HistoryApi['recordingsAccess']>().mockResolvedValue(data.access),
    strayFolders: vi.fn<HistoryApi['strayFolders']>().mockResolvedValue(data.strays),
    dictStats: vi.fn<HistoryApi['dictStats']>().mockResolvedValue(data.totals),
    onRecordingsChanged: vi.fn<HistoryApi['onRecordingsChanged']>(),
  };
}

function pendingCatalog(api: ReturnType<typeof fakeApi>) {
  const rows = Promise.withResolvers<HistoryState['rows']>();
  const access = Promise.withResolvers<HistoryState['access']>();
  const strays = Promise.withResolvers<HistoryState['strays']>();
  const totals = Promise.withResolvers<HistoryState['totals']>();
  api.history.mockReturnValueOnce(rows.promise);
  api.recordingsAccess.mockReturnValueOnce(access.promise);
  api.strayFolders.mockReturnValueOnce(strays.promise);
  api.dictStats.mockReturnValueOnce(totals.promise);
  return { rows, access, strays, totals };
}

describe('createHistoryStore', () => {
  it.each(['rows', 'access', 'strays', 'totals'] as const)('waits for %s before committing the entire catalog', async (last) => {
    const data = catalog();
    const api = fakeApi(data);
    const pending = pendingCatalog(api);
    const history = createHistoryStore(api);
    const initial = history.getSnapshot();
    expect(initial).toEqual({ rows: [], strays: [], totals: null, access: null });
    const changes: HistoryState[] = [];
    history.subscribe(() => changes.push(history.getSnapshot()));
    const reload = history.reload();
    for (const method of [api.history, api.recordingsAccess, api.strayFolders, api.dictStats]) {
      expect(method).toHaveBeenCalledExactlyOnceWith();
    }
    expect(api.history.mock.invocationCallOrder[0]).toBeLessThan(api.recordingsAccess.mock.invocationCallOrder[0]!);
    expect(api.recordingsAccess.mock.invocationCallOrder[0]).toBeLessThan(api.strayFolders.mock.invocationCallOrder[0]!);
    expect(api.strayFolders.mock.invocationCallOrder[0]).toBeLessThan(api.dictStats.mock.invocationCallOrder[0]!);
    const resolve = {
      rows: () => pending.rows.resolve(data.rows),
      access: () => pending.access.resolve(data.access),
      strays: () => pending.strays.resolve(data.strays),
      totals: () => pending.totals.resolve(data.totals),
    };
    for (const key of ['rows', 'access', 'strays', 'totals'] as const) {
      if (key !== last) resolve[key]();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(history.getSnapshot()).toBe(initial);
    expect(changes).toEqual([]);
    resolve[last]();
    await reload;
    const committed = history.getSnapshot();
    expect(committed).not.toBe(initial);
    expect(committed.rows).toBe(data.rows);
    expect(committed.strays).toBe(data.strays);
    expect(committed.totals).toBe(data.totals);
    expect(committed.access).toBe(data.access);
    expect(changes).toEqual([committed]);
    expect(initial).toEqual({ rows: [], strays: [], totals: null, access: null });
  });

  it.each(['rows', 'access', 'strays', 'totals'] as const)('rejects without changing the loaded snapshot when %s fails', async (failed) => {
    const api = fakeApi();
    const history = createHistoryStore(api);
    await history.reload();
    const before = history.getSnapshot();
    const changes: HistoryState[] = [];
    history.subscribe(() => changes.push(history.getSnapshot()));
    const pending = pendingCatalog(api);
    const error = new Error('catalog unavailable');
    const rejected = expect(history.reload()).rejects.toBe(error);
    pending[failed].reject(error);
    await rejected;
    const next = catalog('meeting-2');
    pending.rows.resolve(next.rows);
    pending.access.resolve(next.access);
    pending.strays.resolve(next.strays);
    pending.totals.resolve(next.totals);
    await Promise.resolve();
    await Promise.resolve();
    expect(history.getSnapshot()).toBe(before);
    expect(changes).toEqual([]);
  });

  it('commits overlapping reloads in completion order without discarding the older request', async () => {
    const api = fakeApi();
    const history = createHistoryStore(api);
    const first = catalog('first');
    const second = catalog('second');
    const pendingFirst = pendingCatalog(api);
    const pendingSecond = pendingCatalog(api);
    const changes: HistoryState[] = [];
    history.subscribe(() => changes.push(history.getSnapshot()));
    const firstReload = history.reload();
    const secondReload = history.reload();
    pendingFirst.rows.resolve(first.rows);
    pendingFirst.access.resolve(first.access);
    pendingFirst.strays.resolve(first.strays);
    pendingSecond.rows.resolve(second.rows);
    pendingSecond.access.resolve(second.access);
    pendingSecond.strays.resolve(second.strays);
    pendingSecond.totals.resolve(second.totals);
    await secondReload;
    expect(history.getSnapshot().rows).toBe(second.rows);
    expect(changes).toEqual([second]);
    pendingFirst.totals.resolve(first.totals);
    await firstReload;
    expect(history.getSnapshot().rows).toBe(first.rows);
    expect(changes).toEqual([second, first]);
    expect(changes[1]).not.toBe(changes[0]);
  });

  it('notifies synchronously after each commit and before reload resolves, even for identical values', async () => {
    const data = catalog();
    const history = createHistoryStore(fakeApi(data));
    const changes: HistoryState[] = [];
    const unsubscribe = history.subscribe(() => changes.push(history.getSnapshot()));
    expect(changes).toEqual([]);
    for (let i = 0; i < 2; i++) {
      const before = history.getSnapshot();
      const reload = history.reload();
      for (let tick = 0; tick < 10 && history.getSnapshot() === before; tick++) await Promise.resolve();
      expect(history.getSnapshot()).not.toBe(before);
      expect(changes).toHaveLength(i + 1);
      expect(changes[i]).toBe(history.getSnapshot());
      expect(history.getSnapshot().rows).toBe(data.rows);
      await reload;
      expect(changes).toHaveLength(i + 1);
    }
    expect(changes[1]).not.toBe(changes[0]);
    unsubscribe();
    await history.reload();
    expect(changes).toHaveLength(2);
    expect(history.getSnapshot()).not.toBe(changes[1]);
  });

  it('connects once and reloads for every recordings-changed event', async () => {
    const data = catalog();
    const api = fakeApi(data);
    const history = createHistoryStore(api);
    expect(api.onRecordingsChanged).not.toHaveBeenCalled();
    history.connect();
    history.connect();
    expect(api.onRecordingsChanged).toHaveBeenCalledTimes(1);
    expect(api.history).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const committed = Promise.withResolvers<void>();
      const unsubscribe = history.subscribe(() => committed.resolve());
      api.onRecordingsChanged.mock.calls[0]![0]();
      await committed.promise;
      expect(history.getSnapshot().rows).toBe(data.rows);
      expect(api.history).toHaveBeenCalledTimes(i + 1);
      unsubscribe();
      history.connect();
    }
    expect(api.onRecordingsChanged).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined])('defaults nullish strays and totals (%s) on each commit', async (missing) => {
    const api = fakeApi();
    const history = createHistoryStore(api);
    await history.reload();
    api.strayFolders.mockResolvedValue(missing);
    api.dictStats.mockResolvedValue(missing);
    api.recordingsAccess.mockResolvedValue(missing);
    await history.reload();
    const before = history.getSnapshot();
    expect(before.strays).toEqual([]);
    expect(before.totals).toBeNull();
    expect(before.access).toBe(missing);
    await history.reload();
    expect(history.getSnapshot().strays).toEqual([]);
    expect(history.getSnapshot().strays).not.toBe(before.strays);
    expect(history.getSnapshot().totals).toBeNull();
  });

  it('preserves source dependency identities until catalog fields change on commit', async () => {
    const data = { ...catalog(), strays: [] };
    const api = fakeApi(data);
    const history = createHistoryStore(api);
    const source = createSource(
      () => ({ rows: history.getSnapshot().rows, totals: history.getSnapshot().totals, strays: history.getSnapshot().strays }),
      () => [history.getSnapshot().rows, history.getSnapshot().totals, history.getSnapshot().strays],
    );
    history.subscribe(() => source.changed());
    await history.reload();
    const before = source.getSnapshot();
    await history.reload();
    expect(source.getSnapshot()).toBe(before);
    expect(history.getSnapshot().strays).toBe(data.strays);
    const pending = pendingCatalog(api);
    const reload = history.reload();
    const rows = [...data.rows];
    pending.rows.resolve(rows);
    pending.strays.resolve(data.strays);
    pending.totals.resolve(data.totals);
    await Promise.resolve();
    expect(source.getSnapshot()).toBe(before);
    pending.access.resolve(data.access);
    await reload;
    expect(source.getSnapshot()).not.toBe(before);
    expect(source.getSnapshot().rows).toBe(rows);
    expect(source.getSnapshot().totals).toBe(before.totals);
    expect(source.getSnapshot().strays).toBe(before.strays);
  });
});
