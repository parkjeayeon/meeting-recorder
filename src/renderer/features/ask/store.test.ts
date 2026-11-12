// 질문으로 찾기 상태 주인: 본체 소식 처리(늦은 소식·알림·본 것·막힘), 시작·지우기·멈추기, 놓친 소식 맞추기
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskJob } from '../../entities/ask/index.ts';
import { createAskStore, type AskApi } from './store.ts';

afterEach(() => vi.useRealTimers());
const job = (id: string, over: Partial<AskJob> = {}): AskJob => ({ id, q: `질문 ${id}`, scope: { count: null, from: '', to: '' }, status: 'running', stage: 'parse', t0: Number(id.slice(1)), ms: null, results: [], ...over });

function make({ viewing = false } = {}) {
  let push: (j: AskJob) => void = () => {};
  const list: AskJob[] = [];
  const api = {
    askStart: vi.fn(async (q: string) => job(`a${list.length + 10}`, { q })),
    askList: vi.fn(async () => list),
    askStop: vi.fn(async () => true),
    askRemove: vi.fn(async () => true),
    askSeen: vi.fn(),
    onAsk: (cb: (j: AskJob) => void) => (push = cb),
  } satisfies AskApi;
  const deps = { api, viewing: vi.fn(() => viewing), openTab: vi.fn(), notifyError: vi.fn() };
  const store = createAskStore(deps);
  store.connect();
  return { store, api, deps, push: (j: AskJob) => push(j), list };
}

describe('질문으로 찾기 상태', () => {
  it('지운 질문의 늦은 소식은 버리고, 끝나면 알림(보고 있지 않을 때)과 뱃지 대상', () => {
    vi.useFakeTimers();
    const { store, push } = make();
    push(job('a1', { status: 'done' }));
    expect(store.getSnapshot().jobs).toEqual([]);
    push(job('a1'));
    push(job('a1', { status: 'done', stage: 'done', results: [{ id: 'm' }] }));
    expect(store.getSnapshot().toast?.id).toBe('a1');
    vi.advanceTimersByTime(6000);
    expect(store.getSnapshot().toast).toBeNull();
  });

  it('보고 있는 탭이 끝나면 알림 없이 본 것으로, 막힌 질문은 창을 연다, 멈춘 질문은 알림 없음', () => {
    const v = make({ viewing: true });
    v.push(job('a1'));
    v.push(job('a1', { status: 'done', stage: 'done' }));
    expect([v.store.getSnapshot().toast, v.store.get('a1')?.seen, v.api.askSeen.mock.calls]).toEqual([null, true, [['a1']]]);
    const b = make();
    b.push(job('a2'));
    b.push(job('a2', { status: 'blocked', stage: 'blocked' }));
    expect([b.store.getSnapshot().open, b.store.getSnapshot().justOpened, b.store.getSnapshot().toast]).toEqual([true, true, null]);
    b.push(job('a3'));
    b.push(job('a3', { status: 'stopped' }));
    expect(b.store.getSnapshot().toast).toBeNull();
  });

  it('시작하면 질문 칸을 비우고, 멈추기는 바로 멈춤으로(본체에도), 지우기는 그 알림도 닫는다', async () => {
    const { store, api } = make();
    store.setDraft('배포');
    const t = (await store.start('  배포 회의 '))!;
    expect(api.askStart).toHaveBeenCalledWith('배포 회의', { count: null, from: '', to: '' });
    expect(store.getSnapshot().draft).toBe('');
    await store.stop(t);
    expect([store.get(t.id)?.status, api.askStop.mock.calls]).toEqual(['stopped', [[t.id]]]);
    await store.remove(store.get(t.id)!);
    expect([store.getSnapshot().jobs, api.askRemove.mock.calls]).toEqual([[], [[t.id]]]);
    expect(await store.start('   ')).toBeNull();
  });

  it('막 연 표시(opening)는 질문을 고쳐 쓰거나 범위를 바꿔도 남고, 창을 다시 그릴 일이 생기면 꺼진다', async () => {
    const { store } = make();
    store.toggle(true);
    store.setDraft('배');
    store.setScope({ count: 50, from: '', to: '' });
    expect(store.getSnapshot().justOpened).toBe(true);
    await store.start('배포');
    expect(store.getSnapshot().justOpened).toBe(false);
  });

  it('찾는 동안 5초마다 본체와 맞춘다 (끝난 소식을 놓쳐도)', async () => {
    vi.useFakeTimers();
    const { store, push, list, api } = make();
    push(job('a1'));
    list.push(job('a1', { status: 'done', stage: 'done' }));
    await vi.advanceTimersByTimeAsync(4000);
    expect(api.askList).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.get('a1')?.status).toBe('done');
  });
});
