// @vitest-environment jsdom
// 회의록 본문: 덩어리마다 그리기, 시각 칩(뒤 문장부호까지 한 덩어리)은 눌러서 듣기, 할 일 체크는 그 번호로, 용어 밑줄은 문단의 처음 한 번
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { termMatcher } from '../../entities/minutes/index.ts';
import { createJobs } from '../../shared/lib/index.ts';
import { createIslands } from '../../shared/page-host/index.tsx';
import { MinutesBody, type MinutesProps } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const md = ['# 제목', '## 요약', '**QA**는 QA 팀이 맡는다 (00:06, 00:11).', '## 할 일', '- [ ] QA 마치기', '- [x] 공지', '## 확인 필요', '- "랩캐시도"'].join('\n');
let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('article');
  document.body.append(host);
});
function mount(over: Partial<MinutesProps> = {}) {
  const jobs = createJobs();
  const p: MinutesProps = {
    md, seek: vi.fn(), matcher: termMatcher([{ id: 'g1', term: 'QA', note: '품질 검사', status: 'confirmed' }]), openTerm: vi.fn(), flows: null,
    flowRow: { data: null, jobs, jobKey: 'd|흐름도', make: vi.fn() }, actionsRow: { found: false, jobs, jobKey: 'd|액션', find: vi.fn() },
    glossary: { terms: [], exists: false, openCard: vi.fn(), change: vi.fn(), make: vi.fn(async () => {}) },
    review: { finalized: false, open: 1, go: vi.fn() }, toggleTodo: vi.fn(), ...over,
  };
  act(() => createIslands().mount(host, MinutesBody, p));
  return p;
}

describe('회의록 본문', () => {
  it('제목·확인 필요 섹션은 빼고, 시각은 묶음으로(뒤 마침표까지), 용어는 문단에서 처음 한 번', () => {
    const p = mount();
    expect([...host.children].map((c) => c.tagName.toLowerCase() + (c.className ? `.${c.className.split(' ')[0]}` : ''))).toEqual(['h3', 'p', 'h3', 'ul', 'div.flow-row', 'div.flow-row', 'section.glossary', 'div.review-callout']);
    expect(host.querySelector('p .stamps')!.textContent).toBe('00:06 00:11.');
    expect(host.querySelectorAll('p .term')).toHaveLength(1);
    expect(host.querySelector('p b .term')).not.toBeNull(); // 굵게 안의 첫 'QA'
    act(() => (host.querySelectorAll('.seek')[1] as HTMLElement).click());
    expect(p.seek).toHaveBeenCalledWith(11);
  });
  it('할 일: 체크하면 바로 줄을 지우고(거품 없는 change도) 그 번호로 저장', () => {
    const p = mount();
    const cb = host.querySelector('li.todo input') as HTMLInputElement;
    expect([cb.checked, host.querySelectorAll('li.todo.done').length]).toEqual([false, 1]);
    act(() => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    });
    expect(p.toggleTodo).toHaveBeenCalledWith(0, true);
    expect(host.querySelectorAll('li.todo.done')).toHaveLength(2);
  });
  it('녹음이 없으면 시각은 글자만, 확인 필요 안내는 확인하기', () => {
    const p = mount({ seek: null, actionsRow: null });
    expect(host.querySelector('.seek')).toBeNull();
    expect(host.querySelector('.stamps .num')!.textContent).toBe('00:06');
    act(() => (host.querySelector('.review-callout button') as HTMLElement).click());
    expect(p.review!.go).toHaveBeenCalled();
    expect(host.querySelectorAll('.flow-row')).toHaveLength(1);
  });
});
