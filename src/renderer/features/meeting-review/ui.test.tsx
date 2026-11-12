// @vitest-environment jsdom
// 확인 필요 탭·채팅: 상태는 주인이 준 대로 그리고, 고르기·적용·그대로 두기·구간 다시 받아쓰기·되돌리기·확인 마치기는 주인의 명령
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createIslands } from '../../shared/page-host/index.tsx';
import { createJobs } from '../../shared/lib/index.ts';
import { ReviewBody, ReviewChatBody, needsRewrite, type ReviewActions, type ReviewItem, type ReviewProps } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const item = (over: Partial<ReviewItem>): ReviewItem => ({ id: 'x', kind: 'word', at: null, heard: null, heardNote: null, guess: null, note: '', status: 'open', ...over });
const items = [
  item({ id: 'r1', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 용어' }),
  item({ id: 'r3', kind: 'name', heardNote: '도윤님', note: '누구인지' }),
  item({ id: 'r4', kind: 'meaning', at: '00:40', note: '근거 없음', source: 'check' }),
  item({ id: 'r6', kind: 'meaning', note: '잠깐 끊긴 말' }),
  item({ id: 'r5', heard: '큐에이', applied: 'QA', count: 1, status: 'applied' }),
];
let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.append(host);
});
function mount(over: Partial<ReviewProps> = {}) {
  const actions = Object.fromEntries(['setFilter', 'select', 'selectAll', 'setGuess', 'apply', 'keep', 'openChat', 'redo', 'toggleRedoPick', 'reopen', 'revert', 'cancelEdit', 'setAddDraft', 'add', 'warn'].map((k) => [k, vi.fn()])) as unknown as ReviewActions;
  Object.assign(actions, { reapply: vi.fn(async () => {}), makeReview: vi.fn(async () => true), finalize: vi.fn(async () => false) });
  const p: ReviewProps = { review: { items }, minutes: '', transcript: '', filter: 'open', selected: new Set(), guessDraft: new Map(), redoPick: new Set(), addDraft: '', seek: vi.fn(), now: () => 75, jobs: createJobs(), addKey: 'd|확인추가', actions, ...over };
  act(() => createIslands().mount(host, ReviewBody, p));
  return actions;
}
const btn = (root: ParentNode, t: string) => [...root.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(t))!;
const card = (t: string) => [...host.querySelectorAll('.ritem')].find((c) => c.textContent!.includes(t))!;

describe('확인 필요 탭', () => {
  it('항목마다: 추정이 채워진 고칠 말, 이름은 확인한 내용·녹취 글자 칸, 근거 확인 표시, 시각은 그 자리부터', () => {
    const a = mount();
    expect(card('캐시 용어').querySelector('input:not([type=checkbox])')!.getAttribute('value')).toBeNull();
    expect((card('캐시 용어').querySelector('.ritem-fix input') as HTMLInputElement).value).toBe('Memcached');
    expect(card('누구인지').querySelector('input[aria-label="확인한 내용"]')).not.toBeNull();
    expect(card('근거 없음').querySelector('.tag')!.textContent).toBe('근거 확인');
    act(() => (card('캐시 용어').querySelector('.seek') as HTMLElement).click());
    act(() => btn(card('캐시 용어'), '적용').click());
    expect(a.apply).toHaveBeenCalledWith([{ id: 'r1', guess: 'Memcached' }]);
  });

  it('고르면 한 번에: 추정이 있는 것만 적용 수에, 채팅·그대로 두기는 고른 것 모두', () => {
    const a = mount({ selected: new Set(['r1', 'r3']) });
    expect(btn(host, '추정대로 적용').textContent).toBe('추정대로 적용 1');
    expect((host.querySelector('input[aria-label="모두 고르기"]') as HTMLInputElement).indeterminate).toBe(true);
    act(() => btn(host, '그대로 두기').click());
    expect(a.keep).toHaveBeenCalledWith(['r1', 'r3']);
    const cb = card('누구인지').querySelector('input[aria-label="고르기"]') as HTMLInputElement;
    act(() => {
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
    });
    expect(a.select).toHaveBeenCalledWith('r3', false);
  });

  it('구간 다시 받아쓰기: 구간을 알면 바로, 모르면 직접 고르는 줄 (지금 재생 위치·끝을 비우면 1분)', () => {
    const a = mount({ redoPick: new Set(['r6']) });
    act(() => btn(card('근거 없음'), '구간 다시').click());
    expect(a.redo).toHaveBeenCalledWith('r4', { start: 30, end: 90 });
    const pick = card('잠깐 끊긴 말');
    expect(btn(pick, '구간 다시').getAttribute('aria-expanded')).toBe('true');
    act(() => btn(pick, '지금 재생 위치').click());
    expect((pick.querySelector('input[aria-label="시작 시각"]') as HTMLInputElement).value).toBe('01:15');
    act(() => btn(pick, '다시 받아쓰기').click());
    expect(a.redo).toHaveBeenLastCalledWith('r6', { start: 75, end: 135 });
  });

  it('처리한 항목: 고치기는 그 자리에서 입력칸으로, 같은 말이면 그만두기, 되돌리기', () => {
    const a = mount({ filter: 'done' });
    act(() => btn(card('큐에이'), '고치기').click());
    const input = card('큐에이').querySelector('input') as HTMLInputElement;
    expect([input.value, card('큐에이').querySelector('.ritem-done')!.className]).toEqual(['QA', 'ritem-done ritem-fix']);
    act(() => btn(card('큐에이'), '적용').click());
    expect(a.cancelEdit).toHaveBeenCalled();
    input.value = 'QA팀';
    act(() => btn(card('큐에이'), '적용').click());
    expect(a.reapply).toHaveBeenCalledWith(items[4], 'QA팀');
  });

  it('확인 마치기: 이름·뜻 고침이 있으면 회의록에 반영한다고, 실패하면 다시 시도', async () => {
    expect(needsRewrite([item({ status: 'applied', kind: 'name' })])).toBe(true);
    expect(needsRewrite([item({ status: 'applied', kind: 'word' })])).toBe(false);
    const a = mount();
    await act(async () => btn(host.querySelector('.finalize')!, '남은').click());
    expect(a.finalize).toHaveBeenCalled();
    expect(btn(host.querySelector('.finalize')!, '다시').textContent).toBe('다시 시도');
  });

  it('확인 필요 섹션만 있고 나누지 않았으면 정리하기', async () => {
    const a = mount({ review: null, minutes: '## 요약\n…\n## 확인 필요\n- 하나' });
    await act(async () => btn(host, '정리하기').click());
    expect(a.makeReview).toHaveBeenCalled();
  });
});

describe('확인 필요 채팅', () => {
  it('제안: 적용·그대로 두기·확인됨, 처리한 것은 결과로, 녹취에서 못 찾은 제안은 녹취 글자로 고쳐 적용', async () => {
    const p = {
      items: [items[0]!, items[1]!, { ...items[4]!, id: 'r9' }], busy: false, redoing: null, applying: new Set<string>(), draft: '',
      messages: [{ role: 'assistant' as const, text: '**Memcached**로 보입니다', proposals: [{ id: 'r1', heard: '랩캐시도', guess: 'Memcached' }, { id: 'r3', resolve: '외부 개발자' }, { id: 'r9', heard: '큐에이', guess: 'QA' }], unmatched: [{ id: 'r1', heard: '랩 캐시 도', guess: 'Memcached' }] }],
      setDraft: vi.fn(), send: vi.fn(), close: vi.fn(), apply: vi.fn(), applyUnmatched: vi.fn(async () => {}), redo: vi.fn(), applyRedo: vi.fn(),
    };
    act(() => createIslands().mount(host, ReviewChatBody, p));
    expect([...host.querySelectorAll('.chat-ctx .tag')].map((t) => t.textContent)).toEqual(['00:15 랩캐시도', '도윤님', '큐에이']);
    expect(host.querySelector('.proposal.done .proposal-state')!.textContent).toBe('적용됨');
    act(() => btn(host, '확인됨으로').click());
    expect(p.apply).toHaveBeenCalledWith([{ id: 'r3', resolve: '외부 개발자' }]);
    const target = host.querySelector('.unmatched input') as HTMLInputElement;
    target.value = '랩캐시도';
    await act(async () => btn(host.querySelector('.unmatched')!, '적용').click());
    expect(p.applyUnmatched).toHaveBeenCalledWith({ id: 'r1', heard: '랩캐시도', guess: 'Memcached' });
  });
});
