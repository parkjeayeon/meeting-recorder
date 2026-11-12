// @vitest-environment jsdom
// 둥근 버튼·질문 창: 시험이 넣는 방식(거품 없는 input 이벤트 뒤 바로 보내기), 최근 몇 개는 숫자만, 바깥을 누르면 팝오버 닫힘
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mountReact } from '../../shared/page-host/index.tsx';
import type { AskJob } from '../../entities/ask/index.ts';
import { AskWidget, createAskStore, type AskApi } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
});

function mount(over: { onMeetings?: boolean } = {}) {
  const api = {
    askStart: vi.fn(async (q: string, scope) => ({ id: 'a1', q, scope, status: 'running', stage: 'parse', t0: Date.now(), ms: null, results: [] }) as AskJob),
    askList: vi.fn(async () => []), askStop: vi.fn(), askRemove: vi.fn(), askSeen: vi.fn(), onAsk: vi.fn(),
  } satisfies AskApi;
  const deps = { api, viewing: () => false, openTab: vi.fn(), notifyError: vi.fn() };
  const store = createAskStore(deps);
  const host = document.getElementById('host')!;
  act(() => mountReact(host, AskWidget, { store, deps: { onMeetings: () => over.onMeetings ?? false, usesCodex: () => false, noteClosed: () => false, closeNote: vi.fn(), openSettings: vi.fn() } }));
  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E & HTMLElement>(sel);
  return { store, api, deps, q, host };
}

describe('질문 창', () => {
  it('둥근 버튼으로 열면 opening, 거품 없는 input 뒤 바로 찾기를 눌러도 그 글로 찾고 칸을 비운다. 회의 화면이면 그 탭으로', async () => {
    const { api, deps, q } = mount({ onMeetings: true });
    act(() => q('.fab')!.click());
    expect(q('.askpanel')!.className).toBe('askpanel opening');
    const ta = q<HTMLTextAreaElement>('.askpanel textarea')!;
    await act(async () => {
      ta.value = '배포 회의';
      ta.dispatchEvent(new Event('input'));
      q('.ask-send')!.click();
    });
    expect(api.askStart).toHaveBeenCalledWith('배포 회의', { count: null, from: '', to: '' });
    expect(ta.value).toBe('');
    expect(deps.openTab).toHaveBeenCalledWith('a1');
    expect(q('.askpanel')!.className).toBe('askpanel');
  });

  it('최근 몇 개: 숫자만 남고 칩에 바로, 기간은 처음 누르면 최근 7일, 바깥을 누르면 닫힘', () => {
    const { q, store } = mount();
    act(() => store.toggle(true));
    act(() => q('.cchip[data-chip="count"]')!.click());
    const input = q<HTMLInputElement>('.cpop input')!;
    act(() => {
      input.value = '012a';
      input.dispatchEvent(new Event('input'));
    });
    expect(input.value).toBe('12');
    expect(q('.cchip[data-chip="count"]')!.textContent).toBe('최근 12개');
    act(() => q('.cchip[data-chip="range"]')!.click());
    expect(q('.cchip[data-chip="range"]')!.textContent).toMatch(/–/);
    expect([...document.querySelectorAll('.cpop .opts button')].find((b) => b.textContent === '최근 7일')?.getAttribute('aria-pressed')).toBe('true');
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(q('.cpop')).toBeNull();
    expect(store.getSnapshot().scope.count).toBe(12);
  });

  it('찾는 중이면 둥근 버튼에 둘레, 끝난 알림을 누르면 그 탭으로', () => {
    const { q, store, deps } = mount();
    act(() => store.load([{ id: 'a9', q: 'x', scope: { count: null, from: '', to: '' }, status: 'running', stage: 'search', t0: 0, ms: null, results: [] }]));
    expect(q('.fab .fab-ring')).not.toBeNull();
    act(() => store.update({ id: 'a9', q: 'x', scope: { count: null, from: '', to: '' }, status: 'done', stage: 'done', t0: 0, ms: 2000, results: [{ id: 'm1' }, { id: 'm2' }] }));
    expect(q('.fab-toast')!.textContent).toBe('x 2건을 찾았습니다보기');
    expect(q('.fab-badge')!.textContent).toBe('1');
    act(() => q('.fab-toast')!.click());
    expect(deps.openTab).toHaveBeenCalledWith('a9');
  });
});
