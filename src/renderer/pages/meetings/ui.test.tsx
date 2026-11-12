// @vitest-environment jsdom
// 회의 목록(React): 갈래는 주인에게, 질문 탭(질문으로 찾기 store를 읽음), 끌어다 놓기
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { reactPage } from '../../shared/page-host/index.tsx';
import { createSource } from '../../shared/lib/index.ts';
import type { AskJob } from '../../entities/ask/index.ts';
import { createAskStore } from '../../features/ask/index.ts';
import type { MeetingItem } from '../../entities/meeting/index.ts';
import { MeetingsPage, type MeetingsActions, type MeetingsInput } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  document.body.innerHTML = '<div id="view"></div>';
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});

const meet = (i: number, over: Partial<MeetingItem> = {}): MeetingItem => ({ id: `m${i}`, startedAt: new Date(2026, 10, 1, i).toISOString(), durationSec: 600, minutes: { status: 'done', title: `회의 ${i}` }, review: { finalized: true }, ...over });
const job: AskJob = { id: 'a1', q: '배포 얘기한 회의', scope: { count: null, from: '', to: '' }, status: 'done', stage: 'done', t0: 0, ms: 3000, conds: { topic: '배포' }, results: [{ id: 'm1', level: 'main', reason: '배포 일정을 정함', quote: '화요일 오전' }, { id: 'm2', level: 'mention' }] };

function mount(over: Partial<MeetingsInput> = {}) {
  let state: MeetingsInput = { meetings: [meet(1), meet(2, { minutes: { status: 'error' } })], strays: [], folder: null, filter: 'all', asks: [], ...over };
  const source = createSource(() => state, () => [state]);
  const actions = {
    setFilter: vi.fn((id: string) => act(() => { state = { ...state, filter: id }; source.changed(); })),
    openMeeting: vi.fn(), openReview: vi.fn(), trash: vi.fn(), trashStrays: vi.fn(), reveal: vi.fn(), importMeeting: vi.fn(), openMeetingStart: vi.fn(),
    filePath: vi.fn((f: File) => `/x/${f.name}`),
  } satisfies MeetingsActions;
  const askApi = { askStart: vi.fn(), askList: vi.fn(async () => []), askStop: vi.fn(), askRemove: vi.fn(async () => true), askSeen: vi.fn(), onAsk: vi.fn() };
  const ask = createAskStore({ api: askApi, viewing: () => true, openTab: vi.fn(), notifyError: vi.fn() });
  ask.load(state.asks);
  const page = reactPage(MeetingsPage, { source, ask, actions });
  document.getElementById('view')!.replaceChildren(page.el);
  const chip = (t: string) => [...page.el.querySelectorAll<HTMLButtonElement>('.chip')].find((b) => b.textContent!.startsWith(t))!;
  return { page, actions, chip, askApi };
}

describe('회의 목록 화면', () => {
  it('갈래 칩은 주인의 setFilter, 고른 갈래가 눌림', () => {
    const { page, actions, chip } = mount();
    act(() => chip('녹음만').click());
    expect(actions.setFilter).toHaveBeenCalledWith('rest');
    expect(chip('녹음만').getAttribute('aria-pressed')).toBe('true');
    expect(page.el.querySelectorAll('.lrow')).toHaveLength(1);
    page.leave?.();
  });

  it('질문 탭: 주로 다룸·잠깐 언급과 걸린 이유(인용은 title), 보면 본 것으로, 검색 칸 숨김. 탭 닫기는 질문 store에', () => {
    const { page, chip, askApi } = mount({ asks: [job], filter: 'ask:a1' });
    expect([...page.el.querySelectorAll('.mix-sec .sec-h h2')].map((h) => h.textContent)).toEqual(['주제로 다룬 회의', '잠깐 언급된 회의']);
    const reason = page.el.querySelector('.ltitle .reason')!;
    expect([reason.textContent, reason.getAttribute('title')]).toEqual(['배포 일정을 정함', '“화요일 오전”']);
    expect(askApi.askSeen).toHaveBeenCalledWith('a1');
    expect((page.el.querySelector('label.search') as HTMLElement).hidden).toBe(true);
    expect(chip('배포').getAttribute('aria-pressed')).toBe('true');
    act(() => (page.el.querySelector('.chip.ask .x') as HTMLElement).click());
    expect(askApi.askRemove).toHaveBeenCalledWith('a1');
    page.leave?.();
  });

  it('녹음 파일을 끌어다 놓으면 그 경로로 가져오기', () => {
    const { page, actions } = mount();
    const root = page.el.querySelector('.page')!;
    const file = new File(['x'], 'a.m4a');
    const ev = (type: string) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: { types: ['Files'], files: [file] } });
    act(() => { root.dispatchEvent(ev('dragover')); });
    expect(root.className).toBe('page wide drop');
    act(() => { root.dispatchEvent(ev('drop')); });
    expect(actions.importMeeting).toHaveBeenCalledWith(['/x/a.m4a']);
    expect(root.className).toBe('page wide');
    page.leave?.();
  });
});
