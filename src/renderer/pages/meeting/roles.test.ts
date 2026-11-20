// @vitest-environment jsdom
// 회의 페이지 역할 모듈을 작은 가짜 맥락으로: 확인 필요 명령의 차례(API → 포커스 → 알림 → 사전 → 다시 읽기), ⌘F 찾기 차례,
// 녹취부터 다시 만들기의 잃는 것, 문서 키의 Escape 차례(⌘F 막대 → 채팅, 용어 카드·대화상자가 먼저)와 스페이스
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobs } from '../../shared/lib/index.ts';
import { createFind } from './find.ts';
import { createKeys, type KeysParts } from './keys.ts';
import { createMenu } from './menu.ts';
import { createReview } from './review.ts';
import { createDrafts, type MeetingDeps, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';

type Items = NonNullable<MeetingDoc['review']>['items'];
const record = { id: 'm1', dir: '/m1', mode: 'meeting', startedAt: '2026-11-01T14:00:00Z', durationSec: 60, firstFile: null, minutes: { status: 'done', title: '배포 회의' } } as unknown as MeetingRecord;

/** 부른 차례를 한 줄씩 적는 가짜 맥락 (api의 함수는 over.api로) */
function fakeCtx(over: { api?: Record<string, (...a: never[]) => unknown>; doc?: MeetingDoc; confirm?: boolean } = {}) {
  const log: string[] = [];
  const docs = new Map<string, MeetingDoc>(over.doc ? [['m1', over.doc]] : []);
  const api = new Proxy(over.api ?? {}, {
    get: (impl, name: string) => (...a: unknown[]) => {
      log.push(`api.${name}`);
      return (impl[name] as ((...x: unknown[]) => unknown) | undefined)?.(...a);
    },
  });
  const deps = {
    records: () => [record],
    confirm: vi.fn(async (title: string, text: string) => {
      log.push(`confirm ${title} | ${text}`);
      return over.confirm ?? true;
    }),
    refreshSettings: vi.fn(async () => void log.push('refreshSettings')),
    replaceRoute: vi.fn(),
  } as unknown as MeetingDeps;
  const ctx: PageCtx = {
    id: 'm1',
    deps,
    api: api as unknown as PageCtx['api'],
    docs,
    toast: (title: string, detail?: string) => void log.push(`toast ${title}${detail ? ` | ${detail}` : ''}`),
    loadHistory: async () => void log.push('loadHistory'),
    playback: { toggle: () => log.push('toggle') } as unknown as PageCtx['playback'],
    audio: { currentTime: 0, pause: () => log.push('pause') } as unknown as HTMLAudioElement,
    jobs: createJobs(),
    islands: { mount: vi.fn(), unmount: vi.fn(), clear: vi.fn() } as unknown as PageCtx['islands'],
    page: () => document.body,
    rec: () => record,
    recNow: () => record,
    seek: vi.fn(),
    seekOf: () => null,
    tab: () => 'review',
    setTab: (t) => void log.push(`setTab ${t}`),
    wantFocus: (w) => void log.push(`focus ${typeof w === 'function' ? 'fn' : w.key}`),
    drafts: createDrafts(),
    draw: async () => void log.push('draw'),
    refreshDoc: async () => void log.push('refreshDoc'),
  };
  return { ctx, log, docs, deps };
}
const settle = () => new Promise((r) => setTimeout(r));

describe('확인 필요 명령의 차례 (review.ts)', () => {
  const items = (): Items => [
    { id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', status: 'open' },
    { id: 'r2', kind: 'word', at: '00:20', heard: '쿠버', guess: '쿠버네티스', status: 'open' },
  ] as unknown as Items;
  const chat = { open: vi.fn(), runRedo: vi.fn(async () => {}) };

  it('적용: API → 다음 항목 포커스 → 알림(사전에 넣은 말) → 사전 다시 그리기 → 다시 읽기', async () => {
    const applied = items().map((it, i) => (i === 0 ? { ...it, status: 'applied', count: 2 } : it));
    const { ctx, log } = fakeCtx({ doc: { review: { items: items() } as MeetingDoc['review'] }, api: { applyReview: async () => ({ items: applied, addedWords: ['Memcached'] }) } });
    const review = createReview(ctx, chat);
    review.view(record, ctx.docs.get('m1')!).actions.apply([{ id: 'r1', guess: 'Memcached' }]);
    await settle();
    expect(log).toEqual(['api.applyReview', 'focus card:r2', 'toast 1개를 고쳤습니다 | 녹취·정리본·회의록에서 2곳을 바꿨습니다 · 사전에 추가: Memcached', 'refreshSettings', 'refreshDoc']);
  });

  it('적용했는데 바꾼 곳이 없으면 이유를 알리고 다시 읽기만, 실패하면 알림만', async () => {
    const same = fakeCtx({ api: { applyReview: async () => ({ items: items(), skipped: [{ reason: 'same', heard: '랩캐시도' }] }) } });
    await createReview(same.ctx, chat).applyFixes(record, [{ id: 'r1', guess: '랩캐시도' }]);
    expect(same.log).toEqual(['api.applyReview', "toast 바꿀 곳이 없습니다 | 고칠 말이 들린 말('랩캐시도')과 같습니다. 이 표기가 맞다면 '그대로 두기'를 누르세요", 'refreshDoc']);
    const bad = fakeCtx({ api: { applyReview: async () => { throw new Error('잠김'); } } });
    await createReview(bad.ctx, chat).applyFixes(record, [{ id: 'r1', guess: 'x' }]);
    expect(bad.log).toEqual(['api.applyReview', 'toast 적용하지 못했습니다 | 잠김']);
  });

  it('그대로 두기: API → 다음 항목 포커스 → 알림 → 다시 읽기', async () => {
    const { ctx, log } = fakeCtx({ doc: { review: { items: items() } as MeetingDoc['review'] } });
    createReview(ctx, chat).view(record, ctx.docs.get('m1')!).actions.keep(['r1']);
    await settle();
    expect(log).toEqual(['api.setReviewStatus', 'focus card:r2', 'toast 1개를 그대로 두었습니다 | 나중에 다시 열 수 있습니다', 'refreshDoc']);
  });

  it('되돌리기: 사전에서 뺀 말이 있으면 사전도 다시 그린 뒤 다시 읽기', async () => {
    const { ctx, log } = fakeCtx({ api: { revertReview: async () => ({ removedWord: 'Memcached', reapplied: ['r2'] }) } });
    createReview(ctx, chat).view(record, {}).actions.revert(items()[0]!);
    await settle();
    expect(log).toEqual(['api.revertReview', "toast 되돌렸습니다 | 사전에서 'Memcached'를 뺐습니다 · 같은 줄을 나중에 고친 1개는 다시 적용했습니다", 'refreshSettings', 'refreshDoc']);
  });

  it('남은 항목이 있는 확인 마치기는 묻고, 그만두면 아무것도 하지 않는다', async () => {
    const { ctx, log } = fakeCtx({ confirm: false });
    const res = await createReview(ctx, chat).view(record, { review: { items: items() } as MeetingDoc['review'] }).actions.finalize();
    expect([res, log]).toEqual([null, ['confirm 남은 2개는 그대로 두고 확인을 마칠까요? | 마치면 회의록이 확정됩니다. 나중에 다시 열어 손볼 수 있습니다.']]);
  });

  it('고르기·보기 바꾸기는 한 박자 뒤에 다시 그린다 (누른 부품을 그 처리 중에 내리지 않게)', async () => {
    const { ctx, log } = fakeCtx();
    const review = createReview(ctx, chat);
    const doc: MeetingDoc = { review: { items: items() } as MeetingDoc['review'] };
    review.view(record, doc).actions.select('r1', true);
    expect(log).toEqual([]);
    await Promise.resolve();
    expect(log).toEqual(['draw']);
    expect([...review.view(record, doc).selected]).toEqual(['r1']);
  });
});

describe('⌘F 찾기 (find.ts)', () => {
  let scope: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="view"><div class="panel"></div></div>';
    scope = document.createElement('div');
    scope.innerHTML = '<p>다음 주 <b>배포</b> 일정</p><p>배포 전에 확인, 배</p><p>포 뒤</p>';
    document.getElementById('view')!.append(scope);
  });
  const bar = () => document.querySelector<HTMLElement>('.find-bar');
  const count = () => bar()!.querySelector('.find-count')!.textContent;
  const input = () => bar()!.querySelector('input')!;
  const typeQ = (q: string) => {
    input().value = q;
    input().dispatchEvent(new Event('input'));
  };
  const enter = (shiftKey = false) => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, cancelable: true }));

  it('본문 글자를 이어 붙여 찾고(태그·줄 경계를 넘어), Enter·⇧Enter로 돌며 끝에서 처음으로', () => {
    const find = createFind();
    find.setScope(scope);
    find.open();
    expect([find.isOpen(), document.activeElement === input()]).toEqual([true, true]);
    typeQ('배포');
    expect(count()).toBe('1/3');
    enter();
    enter();
    expect(count()).toBe('3/3');
    enter();
    expect(count()).toBe('1/3');
    enter(true);
    expect(count()).toBe('3/3');
    find.step(-1);
    expect(count()).toBe('2/3');
  });

  it('없으면 "없음"과 none, 다시 그린 뒤(refresh)는 고른 차례를 남기고, 닫으면 막대를 뗀다', () => {
    const find = createFind();
    find.setScope(scope);
    find.open();
    typeQ('없는 말');
    expect([count(), bar()!.classList.contains('none')]).toEqual(['없음', true]);
    typeQ('배포');
    find.step(1);
    scope.innerHTML = '<p>배포 배포 배포 배포</p>'; // 다시 그린 본문
    find.refresh();
    expect(count()).toBe('2/4');
    find.close();
    expect([bar(), find.isOpen()]).toEqual([null, false]);
    find.refresh(); // 닫힌 뒤에는 아무것도 하지 않는다
    expect(bar()).toBeNull();
  });
});

describe('녹취부터 다시 만들기 (menu.ts)', () => {
  const doc = (): MeetingDoc => ({
    transcript: '[00:02] [화자 1] 다음 주 배포\n[00:15] [사회자] 일정 확인\n[00:20] [나] 네\n',
    review: { items: [{ id: 'r1', status: 'applied' }, { id: 'r2', status: 'kept' }, { id: 'r3', status: 'open' }], finalizedAt: '2026-11-01T15:00:00Z' } as unknown as MeetingDoc['review'],
  });

  it('잃는 것: 처리한 확인 항목·바꿔 둔 화자 이름(화자 N·나·상대방은 빼고)·확정', () => {
    expect(createMenu(fakeCtx({ doc: doc() }).ctx).remakeLoss()).toEqual(['처리한 확인 항목 2개', '바꿔 둔 화자 이름 1개', '회의록 확정']);
    expect(createMenu(fakeCtx({ doc: { transcript: '[00:02] [화자 1] 배포\n' } }).ctx).remakeLoss()).toEqual([]);
  });

  it('잃는 것이 있으면 그 목록으로 묻고, 그만두면 만들지 않는다', async () => {
    const no = fakeCtx({ doc: doc(), confirm: false });
    await createMenu(no.ctx).commands.remake('3');
    expect(no.log).toEqual(['confirm 녹취부터 다시 만들까요? | 다시 만들면 사라집니다: 처리한 확인 항목 2개, 바꿔 둔 화자 이름 1개, 회의록 확정. 녹음은 그대로 둡니다.']);
    expect(no.docs.has('m1')).toBe(true);
  });

  it('잃는 것이 없으면 묻지 않고 문서 캐시를 비우고 만든다 (자동 인원은 null)', async () => {
    const { ctx, log, docs } = fakeCtx({ doc: { transcript: '[00:02] [화자 1] 배포\n' } });
    vi.useFakeTimers();
    try {
      await createMenu(ctx).commands.remake('');
      expect([docs.has('m1'), log]).toEqual([false, ['api.makeMinutes', 'toast 회의록을 다시 만듭니다 | 녹취·화자 구분·회의록을 처음부터 만듭니다']]);
      vi.advanceTimersByTime(400);
      expect(log.at(-1)).toBe('loadHistory');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('문서 키의 차례 (keys.ts)', () => {
  let calls: string[];
  let state: { find: boolean; card: boolean; chat: boolean; waiting: boolean; draft: string };
  let keys: ReturnType<typeof createKeys>;
  beforeEach(() => {
    document.body.innerHTML = '<div id="view"><div class="page"><input class="field"><aside class="chat"><textarea></textarea></aside></div></div>';
    calls = [];
    state = { find: false, card: false, chat: true, waiting: false, draft: '' };
    const parts: KeysParts = {
      page: () => document.querySelector<HTMLElement>('.page')!,
      find: { open: () => void calls.push('find.open'), close: () => void calls.push('find.close'), step: (d) => void calls.push(`find.step ${d}`), isOpen: () => state.find },
      terms: { cardOpen: () => state.card },
      chats: { anyOpen: () => state.chat, waiting: () => state.waiting, draft: () => state.draft, close: () => void calls.push('chat.close') },
      playback: { toggle: () => void calls.push('toggle') },
    };
    keys = createKeys(parts);
    // controller.ts와 같은 차례로 붙인다
    document.addEventListener('keydown', keys.onFindKey);
    document.addEventListener('keydown', keys.onEscChat);
    document.addEventListener('keydown', keys.onKey);
  });
  afterEach(() => {
    document.removeEventListener('keydown', keys.onFindKey);
    document.removeEventListener('keydown', keys.onEscChat);
    document.removeEventListener('keydown', keys.onKey);
  });
  const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const view = () => document.querySelector('.page')!;

  it('Escape 한 번에 하나: ⌘F 막대가 열려 있으면 막대만 닫고 채팅은 그대로', () => {
    state.find = true;
    expect(press(view(), 'Escape')).toBe(true);
    expect(calls).toEqual(['find.close']);
  });

  it('용어 카드가 열려 있으면(카드가 붙잡기 단계에서 먼저 닫는다) 막대도 채팅도 건드리지 않는다', () => {
    state.find = true;
    state.card = true;
    expect(press(view(), 'Escape')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('앞에서 이미 처리한 Escape(defaultPrevented)·대화상자가 열린 동안·조합 중에는 채팅을 닫지 않는다', () => {
    const prevent = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', prevent, true);
    press(view(), 'Escape');
    document.removeEventListener('keydown', prevent, true);
    document.body.insertAdjacentHTML('beforeend', '<dialog open></dialog>');
    press(view(), 'Escape');
    document.querySelector('dialog')!.remove();
    press(view(), 'Escape', { isComposing: true });
    expect(calls).toEqual([]);
  });

  it('채팅: 본문·채팅 안에서는 닫고, 본문의 입력칸에서는 닫지 않으며, 기다리는 중이거나 쓴 글이 있으면 그대로', () => {
    press(document.querySelector('.field')!, 'Escape');
    expect(calls).toEqual([]);
    state.waiting = true;
    press(view(), 'Escape');
    state.waiting = false;
    document.querySelector('textarea')!.value = '쓰던 말';
    press(document.querySelector('textarea')!, 'Escape');
    expect(calls).toEqual([]);
    document.querySelector('textarea')!.value = '  ';
    press(document.querySelector('textarea')!, 'Escape');
    press(view(), 'Escape');
    expect(calls).toEqual(['chat.close', 'chat.close']);
  });

  it('⌘F는 열고, ⌘G는 막대가 열렸을 때만 다음·⇧이전', () => {
    press(view(), 'g', { metaKey: true });
    press(view(), 'F', { metaKey: true });
    state.find = true;
    press(view(), 'g', { metaKey: true });
    press(view(), 'g', { metaKey: true, shiftKey: true });
    expect(calls).toEqual(['find.open', 'find.step 1', 'find.step -1']);
  });

  it('스페이스는 재생·멈춤 — 입력칸·⌘ 조합은 빼고', () => {
    state.chat = false;
    press(document.querySelector('.field')!, ' ');
    press(view(), ' ', { metaKey: true });
    expect(press(view(), ' ')).toBe(true);
    expect(calls).toEqual(['toggle']);
  });
});
