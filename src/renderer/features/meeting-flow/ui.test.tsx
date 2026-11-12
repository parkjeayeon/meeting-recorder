// @vitest-environment jsdom
// 흐름도 카드·만들기 줄·채팅: 버튼은 주인의 명령, 시각 칩을 누르면 그 자리부터, 채팅은 거품 없는 입력도
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createIslands } from '../../shared/page-host/index.tsx';
import { createJobs } from '../../shared/lib/index.ts';
import { FlowChatBody, FlowRowBody, FlowsBody, FlowSvg } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const wrap = (t: unknown) => [String(t ?? '')];
const f = { id: 'f1', title: '배포', summary: '순서', lanes: [], steps: [{ id: 'a', title: '하나', detail: '첫째', at: '00:12', quote: '말' }, { id: 'b', title: '둘', detail: '둘째', at: '00:20', quote: '말', optional: true }], edges: [{ from: 'a', to: 'b' }], notes: [], annotations: [] };
let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});

describe('흐름도', () => {
  it('그림: 단계마다 번호·제목·선택 표시, 시각 칩을 누르면 그 자리부터 (녹음이 없으면 칩만)', () => {
    const seek = vi.fn();
    act(() => createIslands().mount(host, FlowSvg, { f, seek, wrap }));
    expect([...host.querySelectorAll('.fl-num')].map((n) => n.textContent)).toEqual(['1', '2']);
    expect(host.querySelector('.fl-step.optional .fl-tag')!.textContent).toBe('선택');
    act(() => (host.querySelector('.fl-stamp.play') as SVGGElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(seek).toHaveBeenCalledWith(12);
    act(() => createIslands().mount(host, FlowSvg, { f, seek: null, wrap }));
    expect(host.querySelector('.fl-stamp.play')).toBeNull();
  });

  it('카드: 채팅·SVG·다시 만들기(찾는 중이면 막힘)·지우기는 주인에게, 인수인계는 넘겨줄 것·할 일·정해진 것 중 있는 칸만', () => {
    const jobs = createJobs();
    const p = { wrap, data: { flows: [f], handoff: { from: '민준', to: '서연', give: [{ text: '스크립트', owner: '민준' }], todo: [], decided: [{ text: '화요일' }] } }, seek: null, avail: 2000, jobs, remakeKey: (id: string) => `d|${id}`, openChat: vi.fn(), saveSvg: vi.fn(), remake: vi.fn(), remove: vi.fn() };
    act(() => createIslands().mount(host, FlowsBody, p));
    const click = (t: string) => act(() => [...host.querySelectorAll('button')].find((b) => b.textContent!.includes(t))!.click());
    click('채팅');
    click('SVG');
    click('다시 만들기');
    click('지우기');
    expect([p.openChat.mock.calls[0], p.saveSvg.mock.calls[0]![0].id, p.remake.mock.calls.length, p.remove.mock.calls.length]).toEqual([['f1'], 'f1', 1, 1]);
    expect([...host.querySelectorAll('.handoff-col b')].map((b) => b.textContent)).toEqual(['민준이 넘겨줄 것', '정해진 것']);
    act(() => void jobs.run('d|f1', '다시 그리는 중…', () => new Promise(() => {})));
    expect([...host.querySelectorAll('button')].find((b) => b.textContent!.includes('다시 그리는 중'))!.disabled).toBe(true);
  });

  it('만들기 줄: 적은 흐름으로 만들고 입력칸을 막는다', () => {
    const make = vi.fn();
    act(() => createIslands().mount(host, FlowRowBody, { data: null, jobs: createJobs(), jobKey: 'd|흐름도', make }));
    const input = host.querySelector<HTMLInputElement>('.flow-focus')!;
    input.value = '데이터 처리 순서만';
    act(() => host.querySelector('button')!.click());
    expect([make.mock.calls[0], input.disabled]).toEqual([['데이터 처리 순서만'], true]);
  });

  it('채팅: 쓰던 말이 남고(거품 없는 input도 받음), Enter로 보내고, 제안은 이대로 바꾸기', () => {
    const p = { f, messages: [{ role: 'user' as const, text: '백업도' }, { role: 'assistant' as const, text: '**고쳤습니다**', revision: f }], busy: false, draft: '쓰던 말', setDraft: vi.fn(), send: vi.fn(), apply: vi.fn(async () => {}), close: vi.fn() };
    act(() => createIslands().mount(host, FlowChatBody, p));
    const ta = host.querySelector('textarea')!;
    expect(ta.value).toBe('쓰던 말');
    ta.value = '메모 짧게';
    act(() => {
      ta.dispatchEvent(new Event('input'));
    });
    expect(p.setDraft).toHaveBeenCalledWith('메모 짧게');
    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(p.send).toHaveBeenCalledWith('메모 짧게');
    expect(host.querySelector('.msg.assistant b')!.textContent).toBe('고쳤습니다');
    expect([...host.querySelectorAll('.redo-line')].map((l) => l.textContent)).toEqual(['1하나 — 첫째', '2둘 — 둘째']);
    act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === '이대로 바꾸기')!.click());
    expect(p.apply).toHaveBeenCalledWith(1);
  });
});
