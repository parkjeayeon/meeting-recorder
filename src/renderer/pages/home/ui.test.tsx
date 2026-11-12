// @vitest-environment jsdom
// 홈(React)이 주인의 값이 바뀌면 다시 읽고, 단추는 주인이 준 명령을 부르는지
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { reactPage } from '../../shared/page-host/index.tsx';
import { createSource } from '../../shared/lib/index.ts';
import { HomePage, type HomeActions, type HomeInput } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

function mount(start: Partial<HomeInput>) {
  let state: HomeInput = { meetings: [], dictations: [], totals: null, issues: [], strayCount: 0, freshId: null, showMarks: true, openRaw: new Set(), ...start };
  const source = createSource(() => state, () => [state]);
  const actions: HomeActions = { openSettings: vi.fn(), openMeetingStart: vi.fn(), openMeetings: vi.fn(), dismissIssue: vi.fn(), copy: vi.fn(), repaste: vi.fn() };
  const page = reactPage(HomePage, { source, actions });
  document.body.replaceChildren(page.el);
  const set = (over: Partial<HomeInput>) => act(() => {
    state = { ...state, ...over };
    source.changed();
  });
  const button = (name: string) => [...page.el.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
  return { page, actions, set, button };
}
const dict = { id: 'd1', startedAt: new Date().toISOString(), durationSec: 2, transcript: { raw: '음 다음 주에 배포 일정 잡아 주세요', text: '다음 주에 배포 일정을 잡아 주세요.' } };

describe('홈 화면', () => {
  it('주인이 changed()를 부르면 다시 읽는다 (문제 알림이 생기고 닫기는 주인에게)', () => {
    const { page, actions, set, button } = mount({});
    expect(page.el.querySelector('.issues')).toBeNull();
    set({ issues: [['fnUsage', { title: 'fn 키가 다른 동작과 겹칩니다', dismiss: true, sec: 'general' }]] });
    expect(page.el.querySelector('.issue b')?.textContent).toBe('fn 키가 다른 동작과 겹칩니다');
    act(() => button('닫기').click());
    expect(actions.dismissIssue).toHaveBeenCalledWith('fnUsage');
    page.leave?.();
  });

  it('시작하기 단추는 그 설정 칸으로, 챙길 일은 회의 갈래로', () => {
    const { page, actions, button } = mount({ strayCount: 1 });
    act(() => button('권한 보기')?.click());
    expect(button('권한 보기')).toBeUndefined(); // 권한 문제가 없으면 이미 끝난 칸
    act(() => button('설정 보기').click());
    act(() => button('녹음 시작').click());
    expect(actions.openSettings).toHaveBeenCalledWith('general');
    expect(actions.openMeetingStart).toHaveBeenCalled();
    act(() => (page.el.querySelector('.todo-row') as HTMLButtonElement).click());
    expect(actions.openMeetings).toHaveBeenCalledWith('all');
    page.leave?.();
  });

  it('최근 받아쓰기: 다듬은 글을 복사하고 1.4초 동안 체크, 교정 표시를 끄면 plain, 새 기록은 fresh', async () => {
    vi.useFakeTimers();
    const { page, actions, set, button } = mount({ dictations: [dict], freshId: 'd1' });
    expect(page.el.querySelector('.ditem')?.className).toBe('ditem fresh');
    expect(page.el.querySelector('.dtext')?.innerHTML).toBe('<del title="다듬기가 지운 말">음</del> 다음 주에 배포 <del title="다듬기가 지운 말">일정</del> <ins title="다듬기가 넣은 말">일정을</ins> 잡아 주세요<ins title="다듬기가 넣은 말">.</ins>');
    await act(async () => button('복사').click());
    expect(actions.copy).toHaveBeenCalledWith('다음 주에 배포 일정을 잡아 주세요.');
    expect(button('복사').className).toBe('icon-btn ok');
    expect(button('복사').querySelector('use')?.getAttribute('href')).toBe('#i-check');
    await act(async () => vi.advanceTimersByTime(1400));
    expect(button('복사').className).toBe('icon-btn');
    act(() => button('다시 붙여넣기').click());
    expect(actions.repaste).toHaveBeenCalledWith('다음 주에 배포 일정을 잡아 주세요.');
    set({ showMarks: false });
    expect(page.el.querySelector('.dtext')?.className).toBe('dtext plain');
    page.leave?.();
  });
});
