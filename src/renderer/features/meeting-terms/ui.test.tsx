// @vitest-environment jsdom
// 용어 칸·설명 카드: 뿌리는 옛 페이지가 만들고 안을 그린다. 버튼은 주인의 명령
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createIslands } from '../../shared/page-host/index.tsx';
import { GlossaryBody, TermCardBody } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  document.body.innerHTML = '';
});
const terms = [
  { id: 'g1', term: 'QA', note: '품질 검사', status: 'confirmed', basis: 'general', at: ['00:11'] },
  { id: 'g2', term: '알림', note: '푸시 알림', status: 'suggested', basis: 'meeting' },
  { id: 'g3', term: '랩캐시도', note: '설명 없음', status: 'suggested', basis: 'unknown' },
];
const btn = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.includes(text))!;

describe('용어', () => {
  it('용어 칸: 확인 전 모두 확인, 만들기는 누르면 찾는 중, 스티커를 누르면 그 용어 카드', () => {
    const host = document.createElement('section');
    host.className = 'glossary';
    document.body.append(host);
    const p = { terms, exists: true, openCard: vi.fn(), change: vi.fn(), make: vi.fn(async () => {}) };
    act(() => createIslands().mount(host, GlossaryBody, p));
    act(() => btn(host, '모두 확인').click());
    expect(p.change).toHaveBeenCalledWith('*', { status: 'confirmed' }, '2개를 확인했습니다');
    act(() => btn(host, '추정 설명 다시 찾기').click());
    expect(btn(host, '용어 찾는 중').getAttribute('aria-busy')).toBe('true');
    act(() => (host.querySelector('.gl-item.guess') as HTMLElement).click());
    expect(p.openCard.mock.calls[0]![1]).toBe(terms[1]);
    expect(host.firstElementChild!.className).toBe('glossary-head'); // 감싸는 상자 없이 뿌리 바로 안에
  });

  it('설명 카드: 확인 전이면 맞아요, 고치기·취소는 새 카드로, 저장은 고친 설명으로, 시각을 누르면 그 자리부터', () => {
    const host = document.createElement('div');
    const anchor = document.createElement('span');
    document.body.append(anchor, host);
    const islands = createIslands();
    const p = { t: terms[1]!, host, anchor, seek: vi.fn(), change: vi.fn(), editing: false, reopen: vi.fn() };
    act(() => islands.mount(host, TermCardBody, p));
    expect(host.querySelector('.tc-badge')!.textContent).toBe('LLM 추정 · 확인 전');
    act(() => btn(host, '맞아요').click());
    expect(p.change).toHaveBeenCalledWith('g2', { status: 'confirmed' });
    act(() => btn(host, '고치기').click());
    expect(p.reopen).toHaveBeenCalledWith(true);
    act(() => islands.mount(host, TermCardBody, { ...p, editing: true }));
    const ta = host.querySelector('textarea')!;
    expect(ta.value).toBe('푸시 알림');
    ta.value = '앱 푸시 알림 기능';
    act(() => btn(host, '저장').click());
    expect(p.change).toHaveBeenLastCalledWith('g2', { note: '앱 푸시 알림 기능' }, '설명을 고쳤습니다');
    act(() => islands.mount(host, TermCardBody, { ...p, t: terms[0]! }));
    expect(host.querySelector('.tc-badge')!.textContent).toBe('일반 용어');
    act(() => (host.querySelector('.tc-at .seek') as HTMLElement).click());
    expect(p.seek).toHaveBeenCalledWith(11);
  });
});
