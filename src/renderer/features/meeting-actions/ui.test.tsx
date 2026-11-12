// @vitest-environment jsdom
// 액션 탭: 체크(거품 없는 change도)는 그 할 일만 주인에게, 진행 수, 찾는 중이면 버튼이 막힘
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createIslands } from '../../shared/page-host/index.tsx';
import { createJobs } from '../../shared/lib/index.ts';
import { ActionsBody, ActionsRowBody } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const data = {
  adviceTitle: '알아 둘 것',
  actions: [
    { id: 'a1', owner: '화자 2', task: 'QA 마치기', due: '월요일', kind: 'assigned', at: '00:11', quote: 'QA는 월요일까지', done: false },
    { id: 'a2', owner: '화자 1', task: '공지하기', due: null, kind: 'promise', at: '00:06', quote: 'x', done: true },
  ],
  advice: [
    { id: 'v1', group: '배포', key: true, why: '범위부터', from: '화자 1', to: '화자 2', text: '알림은 다음 배포로', at: '00:11', quote: 'x' },
    { id: 'v2', group: 'QA', key: false, why: null, from: null, to: null, text: '세 가지만 먼저', at: '00:15', quote: 'x' },
  ],
};

describe('액션', () => {
  it('체크하면 그 할 일만 주인에게, 진행 수가 바뀐다 (속성으로만 체크)', () => {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const p = { data, seek: null, jobs: createJobs(), jobKey: 'd|액션', find: vi.fn(), toggle: vi.fn() };
    act(() => createIslands().mount(host, ActionsBody, p));
    expect(host.querySelector('.act-board-head .num')!.textContent).toBe('1/2');
    const cb = host.querySelector<HTMLInputElement>('.act-item input')!;
    expect([cb.checked, cb.hasAttribute('checked')]).toEqual([false, false]);
    act(() => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change')); // 거품 없음
    });
    expect(p.toggle).toHaveBeenCalledWith('a1', true);
    expect(host.querySelector('.act-board-head .num')!.textContent).toBe('2/2');
    expect(host.querySelector('.act-item')!.className).toBe('act-item done');
    expect([...host.querySelectorAll('.act-key b')].map((b) => b.textContent)).toEqual(['★ 알림은 다음 배포로']);
    expect(host.querySelector('.act-who')!.textContent).toBe('화자 1 → 화자 2');
  });

  it('찾는 중이면 버튼이 돌아가는 표시·막힘·작업 이름, 끝나면 돌아온다', async () => {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const jobs = createJobs();
    act(() => createIslands().mount(host, ActionsRowBody, { found: false, jobs, jobKey: 'd|액션', find: vi.fn() }));
    let done!: () => void;
    let run!: Promise<void>;
    act(() => {
      run = jobs.run('d|액션', '찾는 중… (1분 안팎)', () => new Promise<void>((r) => (done = r)));
    });
    const b = host.querySelector('button')!;
    expect([b.className, b.disabled, b.textContent]).toEqual(['btn small busy', true, '찾는 중… (1분 안팎)']);
    await act(async () => {
      done();
      await run;
    });
    expect([b.className, b.disabled, b.textContent]).toEqual(['btn small', false, '액션 찾기']);
  });
});
