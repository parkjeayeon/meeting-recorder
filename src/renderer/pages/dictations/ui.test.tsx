// @vitest-environment jsdom
// 받아쓰기 기록 화면: 본체에서 이어 받기, 늦게 온 답 버리기, 기록이 바뀌면 보던 만큼 다시 받기, 검색, 주인의 명령
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { reactPage } from '../../shared/page-host/index.tsx';
import { createSource } from '../../shared/lib/index.ts';
import { DictationsPage, type DictationsActions, type DictationsInput, type DictPage } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let observed: (() => void) | null = null; // jsdom에는 IntersectionObserver가 없다 — 스크롤 끝에 닿은 것처럼 부를 수 있게
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
      observed = () => cb([{ isIntersecting: true }]);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const all = Array.from({ length: 75 }, (_, i) => ({ id: `d${i}`, startedAt: new Date(2026, 10, 12, 12, 59 - (i % 60)).toISOString(), durationSec: 3, transcript: { raw: `글 ${i}`, text: `글 ${i}` } }));
function fakePage({ q, before, limit }: { q: string; before: string | null; limit: number }): DictPage {
  const matched = all.filter((r) => r.transcript.text.includes(q));
  const start = before ? matched.findIndex((r) => r.id === before) + 1 : 0;
  const items = matched.slice(start, start + limit);
  return { items, total: all.length, matched: matched.length, next: start + limit < matched.length ? items.at(-1)!.id : null };
}
const flush = () => act(async () => {});

function mount(loadPage: DictationsActions['loadPage'] = async (query) => fakePage(query)) {
  let state: DictationsInput = { version: 1, folder: null, freshId: null, showMarks: true, openRaw: new Set() };
  const source = createSource(() => state, () => [state]);
  const actions: DictationsActions = { loadPage: vi.fn(loadPage), copy: vi.fn(), repaste: vi.fn(), toggleRaw: vi.fn(), remove: vi.fn(), setShowMarks: vi.fn() };
  const page = reactPage(DictationsPage, { source, actions });
  document.body.replaceChildren(page.el);
  const set = (over: Partial<DictationsInput>) => act(() => {
    state = { ...state, ...over };
    source.changed();
  });
  const rows = () => page.el.querySelectorAll('.ditem').length;
  const text = (sel: string) => page.el.querySelector(sel)?.textContent;
  return { page, actions, set, rows, text };
}

describe('받아쓰기 기록 화면', () => {
  it('30개씩 이어 받고, 다 받으면 "다 보았습니다"', async () => {
    const { page, rows, text } = mount();
    await flush();
    expect([rows(), text('.page-head h1 .num'), text('.dict-count'), text('.load-more')]).toEqual([30, '75', '전체 75개', '30 / 75개 · 더 불러오는 중…']);
    await act(async () => observed!());
    await act(async () => observed!());
    expect(rows()).toBe(75);
    expect(text('.load-more')).toBe('모든 받아쓰기 75개를 다 보았습니다');
    page.leave?.();
  });

  it('기록이 바뀌면 보던 만큼(60개) 다시 받는다', async () => {
    const { page, actions, set, rows } = mount();
    await flush();
    await act(async () => observed!());
    set({ version: 2 });
    await flush();
    expect(vi.mocked(actions.loadPage).mock.calls.at(-1)?.[0]).toEqual({ q: '', before: null, limit: 60 });
    expect(rows()).toBe(60);
    page.leave?.();
  });

  it('검색은 입력이 멈추고 0.3초 뒤, 거품이 안 오르는 input 이벤트도 받는다. 늦게 온 앞 검색의 답은 버린다', async () => {
    vi.useFakeTimers();
    const slow: ((p: DictPage) => void)[] = [];
    const { page, text } = mount(async (query) => (query.q === '1' ? new Promise<DictPage>((r) => slow.push(() => r(fakePage(query)))) : fakePage(query)));
    await flush();
    const box = page.el.querySelector('input[type=search]') as HTMLInputElement;
    box.value = '1';
    box.dispatchEvent(new Event('input')); // 화면 시험이 넣는 방식 그대로
    await act(async () => vi.advanceTimersByTime(300));
    box.value = '글 7';
    box.dispatchEvent(new Event('input'));
    await act(async () => vi.advanceTimersByTime(300));
    expect(text('.dict-count')).toBe('"글 7" 6개 · 전체 75개에서');
    await act(async () => slow[0]!(fakePage({ q: '1', before: null, limit: 30 })));
    expect(text('.dict-count')).toBe('"글 7" 6개 · 전체 75개에서');
    page.leave?.();
  });

  it('원문·삭제·고친 곳 표시는 주인의 명령', async () => {
    const { page, actions, set } = mount(async () => ({ items: [{ id: 'x', startedAt: new Date().toISOString(), durationSec: 2, transcript: { raw: '음 다음 주에 배포 일정 잡아 주세요', text: '다음 주에 배포 일정을 잡아 주세요.' } }], total: 1, matched: 1, next: null }));
    await flush();
    (page.el.querySelector('[aria-label="원문"]') as HTMLButtonElement).click();
    (page.el.querySelector('[aria-label="삭제"]') as HTMLButtonElement).click();
    expect(actions.toggleRaw).toHaveBeenCalledWith('x');
    expect(actions.remove).toHaveBeenCalledWith('x');
    set({ openRaw: new Set(['x']) });
    expect(page.el.querySelector('.draw')?.textContent).toBe('음 다음 주에 배포 일정 잡아 주세요');
    expect(page.el.querySelector('[aria-label="원문"]')?.getAttribute('title')).toBe('원문 닫기');
    const marks = page.el.querySelector('.inline-switch input') as HTMLInputElement;
    expect([marks.checked, marks.hasAttribute('checked')]).toEqual([true, false]);
    act(() => marks.click());
    expect(actions.setShowMarks).toHaveBeenCalledWith(false);
    page.leave?.();
  });
});
