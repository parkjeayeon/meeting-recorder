// @vitest-environment jsdom
// 회의 페이지 주인의 포커스 되돌리기: 다시 그리면 안이 통째로 바뀌어도 쓰던 입력칸·커서가 그대로이고,
// 주인이 정한 곳(채팅 입력칸·고른 탭·다음 항목)이 먼저이며, 같은 것이 없어지면 아무 데도 옮기지 않는다
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createJobs } from '../../shared/lib/index.ts';
import type { PageHandle } from '../../shared/page-host/index.tsx';
import { meetingPage, type MeetingDeps, type MeetingDoc, type MeetingRecord } from './index.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = { id: 'm1', dir: '/m1', mode: 'meeting', startedAt: '2026-11-01T14:00:00Z', durationSec: 60, firstFile: null, minutes: { status: 'done', title: '배포 회의' } } as unknown as MeetingRecord;
type Items = NonNullable<MeetingDoc['review']>['items'];
let items: Items;
const doc = (): MeetingDoc => ({
  minutes: '# 배포 회의\n\n## 확인 필요\n- 랩캐시도\n',
  transcript: '[00:02] [화자 1] 다음 주 배포 일정\n[00:15] [화자 2] 랩캐시도 쪽 확인만\n',
  scriptClean: '',
  review: { items: items.map((it) => ({ ...it })) },
});
let handle: PageHandle;
let api: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  document.body.innerHTML = '';
  items = [
    { id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 용어', status: 'open' },
    { id: 'r3', kind: 'name', at: null, heard: null, heardNote: '도윤님', note: '누구인지', status: 'open' },
  ] as unknown as Items;
  api = {
    readMinutes: vi.fn(async () => doc()),
    watchMeeting: vi.fn(),
    applyReview: vi.fn(async (_d: string, fixes: { id: string; guess: string }[]) => {
      for (const f of fixes) Object.assign(items.find((it) => it.id === f.id)!, { status: 'applied', applied: f.guess, count: 1 });
      return { items };
    }),
    chatReview: vi.fn(),
  };
  const deps: MeetingDeps = {
    api: api as unknown as MeetingDeps['api'],
    records: () => [record],
    docs: new Map(),
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    loadHistory: vi.fn(async () => {}),
    refreshSettings: vi.fn(async () => {}),
    replaceRoute: vi.fn(),
    canGoBack: () => false,
    setCrumbs: vi.fn(),
    takeOpenReview: () => true, // 확인 필요 탭으로 연다
    playback: { audio: { pause: vi.fn(), src: '', currentTime: 0 } } as unknown as MeetingDeps['playback'],
    jobs: createJobs(),
    fullDate: () => '2026년 11월 1일 (일) 23:00',
  };
  handle = meetingPage('m1', deps);
  document.body.append(handle.el);
});
afterEach(() => handle.leave?.());

const tick = () => new Promise((r) => setTimeout(r));
const settle = () => act(async () => {
  for (let i = 0; i < 5; i++) await tick();
});
/** 파일이 바뀐 소식 → 문서를 다시 읽어 페이지를 통째로 다시 그린다 */
const redraw = async () => {
  await act(async () => handle.reload!());
  await settle();
};
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string, caret: number) => {
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.setSelectionRange(caret, caret);
};

describe('다시 그려도 포커스·커서가 남는다', () => {
  it('직접 추가 입력칸: 같은 글·같은 커서 자리의 새 입력칸에 포커스', async () => {
    await settle();
    const before = q<HTMLTextAreaElement>('.review-add textarea')!;
    type(before, '통신 한정성은 안정성', 4);
    await redraw();
    const after = q<HTMLTextAreaElement>('.review-add textarea')!;
    expect(after).not.toBe(before); // 정말 새로 그렸다
    expect([document.activeElement === after, after.value, after.selectionStart, after.selectionEnd]).toEqual([true, '통신 한정성은 안정성', 4, 4]);
  });

  it('카드 안의 둘째·셋째 칸: 카드의 첫 칸으로 가지 않고 그 칸으로, 쓰던 글(주인이 들고 있다)과 고른 범위도', async () => {
    await settle();
    type(q<HTMLInputElement>('[data-focus="from:r3"]')!, '도윤님', 3);
    const to = q<HTMLInputElement>('[data-focus="to:r3"]')!;
    type(to, '외부 개발자', 2);
    to.setSelectionRange(1, 4);
    await redraw();
    const from = q<HTMLInputElement>('[data-focus="from:r3"]')!;
    const to2 = q<HTMLInputElement>('[data-focus="to:r3"]')!;
    expect(to2).not.toBe(to);
    expect([document.activeElement === to2, to2.value, to2.selectionStart, to2.selectionEnd, from.value]).toEqual([true, '외부 개발자', 1, 4, '도윤님']);
  });

  it('카드 안의 열쇠 없는 버튼에 있었으면 그 카드의 첫 입력칸으로 (옛 카드 되돌리기)', async () => {
    await settle();
    [...document.querySelectorAll<HTMLButtonElement>('.ritem[data-id="r3"] .ritem-acts button')].at(-1)!.focus();
    await redraw();
    expect(document.activeElement).toBe(q('[data-focus="resolve:r3"]'));
  });

  it('같은 것이 없어지면(다른 데서 처리됨) 아무 데도 옮기지 않는다', async () => {
    await settle();
    type(q<HTMLInputElement>('[data-focus="to:r3"]')!, '외부', 2);
    Object.assign(items[1]!, { status: 'resolved' });
    await redraw();
    expect(q('.ritem[data-id="r3"]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('주인이 정한 곳이 먼저', () => {
  it('채팅을 열면 채팅 입력칸으로 — 그 뒤 다른 입력칸으로 옮기면 나중에 빼앗지 않는다 (예전엔 50ms 뒤에 채팅으로 끌고 갔다)', async () => {
    await settle();
    const add = q<HTMLTextAreaElement>('.review-add textarea')!;
    add.focus();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.ritem[data-id="r1"] button')].find((b) => b.textContent === '채팅')!.click());
    await settle();
    expect(document.activeElement).toBe(q('.chat textarea'));
    const add2 = q<HTMLTextAreaElement>('.review-add textarea')!;
    type(add2, '놓친 말', 3);
    await act(async () => new Promise((r) => setTimeout(r, 120)));
    expect(document.activeElement).toBe(add2);
    await redraw();
    expect(document.activeElement).toBe(q('.review-add textarea'));
  });

  it('탭에서 ←: 그리기 전의 탭이 아니라 새로 고른 탭에', async () => {
    await settle();
    const tab = q('[data-focus="tab:review"]')!;
    tab.focus();
    await act(async () => tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    await settle();
    expect(document.activeElement).toBe(q('[data-focus="tab:minutes"]'));
    expect(q('[data-focus="tab:minutes"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('입력칸에서 Enter로 적용하면 다음 항목 카드로 (적용한 칸의 자리보다 먼저)', async () => {
    await settle();
    const guess = q<HTMLInputElement>('[data-focus="guess:r1"]')!;
    guess.focus();
    await act(async () => guess.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle();
    expect(api.applyReview).toHaveBeenCalledWith('/m1', [{ id: 'r1', guess: 'Memcached' }]);
    expect(document.activeElement).toBe(q('[data-focus="resolve:r3"]'));
  });
});

describe('한글 조합 중에는 그리기를 미룬다', () => {
  it('조합이 끝날 때까지 입력칸을 바꾸지 않고, 끝나면 그려서 같은 자리로', async () => {
    await settle();
    const add = q<HTMLTextAreaElement>('.review-add textarea')!;
    type(add, '안녕하', 3);
    add.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await redraw();
    expect([add.isConnected, document.activeElement === add]).toEqual([true, true]); // 조합 중인 입력칸 그대로
    type(add, '안녕하세', 4);
    add.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await settle();
    const after = q<HTMLTextAreaElement>('.review-add textarea')!;
    expect(after).not.toBe(add); // 미룬 그리기를 했다
    expect([document.activeElement === after, after.value, after.selectionStart]).toEqual([true, '안녕하세', 4]);
  });
});
