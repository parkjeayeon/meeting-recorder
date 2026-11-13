// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { PageHandle } from '../shared/page-host/index.tsx';
import { createRouter } from './index.ts';

const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;

function fixture() {
  const mount = (_arg: string | null): PageHandle => ({ el: document.createElement('article'), leave: vi.fn() });
  const table = {
    home: { title: '홈', mount: vi.fn(mount) },
    meetings: { title: '회의', mount: vi.fn(mount) },
    meeting: { title: '회의', mount: vi.fn(mount) },
    stats: { title: '통계', mount: vi.fn(mount) },
  };
  let swipe: (dir: string) => void = () => {};
  const api = { onSwipe: vi.fn((cb: (dir: string) => void) => { swipe = cb; }) };
  const router = createRouter(table, { api });
  return { router, table, api, swipe: (dir: string) => swipe(dir) };
}

function visit(hash: string, state: unknown = null) {
  window.history.pushState(state, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function key(value: string, target: EventTarget = document, metaKey = true) {
  const event = new KeyboardEvent('keydown', { key: value, metaKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

let documentListeners: MockInstance<typeof document.addEventListener>;
let windowListeners: MockInstance<typeof window.addEventListener>;

beforeEach(() => {
  window.history.replaceState(null, '', '/#home');
  document.body.innerHTML = '<button id="navBack"></button><button id="navFwd"></button><nav class="nav"><a class="nav-item" data-route="home"></a><a class="nav-item" data-route="meetings"></a><a class="nav-item" data-route="stats"></a></nav><div id="crumbs"></div><main id="view"></main><input id="input"><textarea id="textarea"></textarea>';
  documentListeners = vi.spyOn(document, 'addEventListener');
  windowListeners = vi.spyOn(window, 'addEventListener');
});

afterEach(() => {
  for (const [type, listener, options] of documentListeners.mock.calls) document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls) window.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
});

describe('createRouter', () => {
  it('parses at creation without mounting, tracking history, or connecting', () => {
    window.history.replaceState(null, '', '#meeting/%ED%9A%8C%EC%9D%98/a%2Fb');
    const { router, table, api } = fixture();
    expect(router.route()).toEqual({ name: 'meeting', arg: '회의/a/b' });
    expect(router.current()).toBeNull();
    expect(table.home.mount).not.toHaveBeenCalled();
    expect(window.history.state).toBeNull();
    expect(api.onSwipe).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '#stats');
    expect(router.route().name).toBe('meeting');
    router.refresh();
    expect(get('view').childNodes).toHaveLength(0);
    router.navigate();
    expect(router.route()).toEqual({ name: 'stats', arg: null });
  });

  it('indexes the first unindexed entry at zero and disables both buttons', () => {
    window.history.replaceState({ other: true, idx: '7' }, '');
    const { router } = fixture();
    router.navigate();
    expect(window.history.state).toEqual({ idx: 0 });
    expect(router.canGoBack()).toBe(false);
    expect(get<HTMLButtonElement>('navBack').disabled).toBe(true);
    expect(get<HTMLButtonElement>('navFwd').disabled).toBe(true);
  });

  it('keeps a pre-indexed reload entry and treats its index as the current maximum', () => {
    window.history.replaceState({ idx: 4, other: true }, '');
    const { router } = fixture();
    router.navigate();
    expect(window.history.state).toEqual({ idx: 4, other: true });
    expect(router.canGoBack()).toBe(true);
    expect(get<HTMLButtonElement>('navBack').disabled).toBe(false);
    expect(get<HTMLButtonElement>('navFwd').disabled).toBe(true);
  });

  it('retains forward bounds on indexed traversal and truncates them on a new navigation', () => {
    const { router } = fixture();
    router.connect();
    router.navigate();
    visit('#meetings');
    expect(window.history.state).toEqual({ idx: 1 });
    visit('#stats');
    expect(window.history.state).toEqual({ idx: 2 });
    visit('#home', { idx: 0 });
    expect(get<HTMLButtonElement>('navFwd').disabled).toBe(false);
    expect(router.canGoBack()).toBe(false);
    visit('#meeting/new');
    expect(window.history.state).toEqual({ idx: 1 });
    expect(get<HTMLButtonElement>('navFwd').disabled).toBe(true);
    expect(router.canGoBack()).toBe(true);
  });

  it.each(['keyboard', 'mouse', 'swipe'] as const)('bounds back and forward through %s', (kind) => {
    const { router, swipe } = fixture();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
    const move = (direction: 'back' | 'forward') => {
      if (kind === 'keyboard') expect(key(direction === 'back' ? '[' : ']').defaultPrevented).toBe(true);
      else if (kind === 'mouse') window.dispatchEvent(new MouseEvent('mouseup', { button: direction === 'back' ? 3 : 4 }));
      else swipe(direction === 'back' ? 'left' : 'right');
    };
    router.connect();
    router.navigate();
    move('back');
    move('forward');
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    visit('#stats');
    move('back');
    move('forward');
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).not.toHaveBeenCalled();
    visit('#home', { idx: 0 });
    move('back');
    move('forward');
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
    visit('#meetings');
    move('forward');
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it('ignores command brackets in inputs and textareas, unmodified keys, and unrelated events', () => {
    const { router, swipe } = fixture();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
    router.connect();
    router.navigate();
    visit('#stats', { idx: 2 });
    visit('#meetings', { idx: 1 });
    for (const id of ['input', 'textarea']) {
      expect(key('[', get(id)).defaultPrevented).toBe(false);
      expect(key(']', get(id)).defaultPrevented).toBe(false);
    }
    expect(key('[', document, false).defaultPrevented).toBe(false);
    expect(key(']', document, false).defaultPrevented).toBe(false);
    expect(key('k').defaultPrevented).toBe(false);
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    swipe('up');
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    expect(key('[', editable).defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledOnce();
  });

  it('connects once, keeps registration order, and wires nav buttons', () => {
    const { router, table, api } = fixture();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const forward = vi.spyOn(window.history, 'forward').mockImplementation(() => {});
    router.connect();
    const onclick = get('navBack').onclick;
    router.connect();
    expect(get('navBack').onclick).toBe(onclick);
    expect(api.onSwipe).toHaveBeenCalledOnce();
    const keyIndex = documentListeners.mock.calls.findIndex(([type]) => type === 'keydown');
    const mouseIndex = windowListeners.mock.calls.findIndex(([type]) => type === 'mouseup');
    const hashIndex = windowListeners.mock.calls.findIndex(([type]) => type === 'hashchange');
    expect(documentListeners.mock.invocationCallOrder[keyIndex]).toBeLessThan(windowListeners.mock.invocationCallOrder[mouseIndex]!);
    expect(windowListeners.mock.invocationCallOrder[mouseIndex]).toBeLessThan(api.onSwipe.mock.invocationCallOrder[0]!);
    expect(api.onSwipe.mock.invocationCallOrder[0]).toBeLessThan(windowListeners.mock.invocationCallOrder[hashIndex]!);
    const laterKeydown = vi.fn((event: KeyboardEvent) => {
      if (event.key === '[') expect(back).toHaveBeenCalledTimes(2);
    });
    document.addEventListener('keydown', laterKeydown);
    router.navigate();
    visit('#stats');
    expect(table.stats.mount).toHaveBeenCalledOnce();
    get('navBack').click();
    key('[');
    expect(laterKeydown).toHaveBeenCalledOnce();
    visit('#home', { idx: 0 });
    get('navFwd').click();
    expect(forward).toHaveBeenCalledOnce();
  });

  it('can connect without a swipe API', () => {
    const router = createRouter({ home: { title: '홈', mount: () => ({ el: document.createElement('main') }) } }, { api: {} });
    expect(() => router.connect()).not.toThrow();
    router.navigate();
    expect(get('crumbs').innerHTML).toBe('<b>홈</b>');
  });

  it('replaces the current entry with its index and immediately navigates without pushing', () => {
    const { router, table } = fixture();
    router.connect();
    router.navigate();
    visit('#meeting/deleted');
    const old = router.current()!;
    const length = window.history.length;
    router.replace('#meetings');
    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ idx: 1 });
    expect(window.location.hash).toBe('#meetings');
    expect(router.route()).toEqual({ name: 'meetings', arg: null });
    expect(old.leave).toHaveBeenCalledOnce();
    expect(table.meetings.mount).toHaveBeenCalledOnce();
  });

  it.each([
    ['', 'home', null],
    ['#unknown/a%2Fb/c', 'home', 'a/b/c'],
    ['#meeting', 'meeting', null],
    ['#meeting/', 'meeting', ''],
  ] as const)('parses %s with the legacy fallback and argument rules', (hash, name, arg) => {
    window.history.replaceState(null, '', `/${hash}`);
    const { router, table } = fixture();
    router.navigate();
    expect(router.route()).toEqual({ name, arg });
    expect(table[name].mount).toHaveBeenCalledWith(arg);
  });

  it('throws for malformed URI escapes at creation and after history tracking on navigation', () => {
    window.history.replaceState(null, '', '#unknown/%');
    expect(() => fixture()).toThrow(URIError);
    window.history.replaceState(null, '', '#home');
    const { router } = fixture();
    router.navigate();
    const old = router.current();
    window.history.pushState(null, '', '#meeting/%');
    expect(() => router.navigate()).toThrow(URIError);
    expect(window.history.state).toEqual({ idx: 1 });
    expect(router.route()).toEqual({ name: 'home', arg: null });
    expect(router.current()).toBe(old);
    expect(old!.leave).not.toHaveBeenCalled();
  });

  it('does not remount for a same-hash assignment but does for an explicit navigate', async () => {
    const { router, table } = fixture();
    router.connect();
    router.navigate();
    const changed = new Promise<void>((resolve) => window.addEventListener('hashchange', () => resolve(), { once: true }));
    window.location.hash = '#meetings';
    await changed;
    const current = router.current();
    window.location.hash = '#meetings';
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(table.meetings.mount).toHaveBeenCalledOnce();
    expect(router.current()).toBe(current);
    router.navigate();
    expect(table.meetings.mount).toHaveBeenCalledTimes(2);
    expect(current!.leave).toHaveBeenCalledOnce();
    expect(window.history.state).toEqual({ idx: 1 });
  });

  it('tracks, parses, highlights, leaves, mounts, replaces, scrolls, then sets crumbs', () => {
    const { router, table } = fixture();
    router.navigate();
    const old = router.current()!;
    get('view').scrollTop = 83;
    vi.mocked(old.leave!).mockImplementation(() => {
      expect(window.history.state).toEqual({ idx: 1 });
      expect(router.route()).toEqual({ name: 'meeting', arg: 'id' });
      expect(document.querySelector('[data-route="meetings"]')!.getAttribute('aria-current')).toBe('page');
      expect(get('view').firstChild).toBe(old.el);
    });
    table.meeting.mount.mockImplementation((arg) => {
      expect(arg).toBe('id');
      expect(old.leave).toHaveBeenCalledOnce();
      expect(get('view').firstChild).toBe(old.el);
      expect(get('view').scrollTop).toBe(83);
      expect(get('crumbs').innerHTML).toBe('<b>홈</b>');
      return { el: document.createElement('section') };
    });
    const replace = get('crumbs').replaceChildren.bind(get('crumbs'));
    vi.spyOn(get('crumbs'), 'replaceChildren').mockImplementation((...nodes) => {
      expect(get('view').firstChild).toBe(router.current()!.el);
      expect(get('view').scrollTop).toBe(0);
      replace(...nodes);
    });
    window.history.pushState(null, '', '#meeting/id');
    router.navigate();
    expect(get('crumbs').innerHTML).toBe('<a href="#meetings">회의</a><svg><use href="#i-right"></use></svg><b></b>');
  });

  it('refreshes with update while preserving the handle, scroll, and crumbs', () => {
    const { router, table } = fixture();
    const update = vi.fn(() => { get('view').scrollTop = 0; });
    table.home.mount.mockReturnValue({ el: document.createElement('article'), update, leave: vi.fn() });
    router.navigate();
    const current = router.current();
    get('view').scrollTop = 123;
    get('crumbs').textContent = 'keep';
    router.refresh();
    expect(update).toHaveBeenCalledOnce();
    expect(table.home.mount).toHaveBeenCalledOnce();
    expect(current!.leave).not.toHaveBeenCalled();
    expect(router.current()).toBe(current);
    expect(get('view').scrollTop).toBe(123);
    expect(get('crumbs').textContent).toBe('keep');
  });

  it('refreshes without update by remounting without leave or reparsing the hash', () => {
    const { router, table } = fixture();
    router.navigate();
    const old = router.current()!;
    get('view').scrollTop = 91;
    window.history.replaceState(null, '', '#stats');
    router.refresh();
    expect(old.leave).not.toHaveBeenCalled();
    expect(table.home.mount).toHaveBeenCalledTimes(2);
    expect(table.stats.mount).not.toHaveBeenCalled();
    expect(router.current()).not.toBe(old);
    expect(get('view').firstChild).toBe(router.current()!.el);
    expect(get('view').scrollTop).toBe(91);
  });

  it('renders meeting crumbs safely and maps its nav highlight to meetings', () => {
    const { router } = fixture();
    router.connect();
    router.navigate();
    visit('#meeting/id');
    router.setCrumbs('<회의>');
    expect(get('crumbs').innerHTML).toBe('<a href="#meetings">회의</a><svg><use href="#i-right"></use></svg><b>&lt;회의&gt;</b>');
    expect(document.querySelector('[data-route="home"]')!.hasAttribute('aria-current')).toBe(false);
    expect(document.querySelector('[data-route="meetings"]')!.getAttribute('aria-current')).toBe('page');
    router.setCrumbs();
    expect(get('crumbs').lastChild!.textContent).toBe('');
    visit('#stats');
    router.setCrumbs('ignored');
    expect(get('crumbs').innerHTML).toBe('<b>통계</b>');
    expect(document.querySelector('[data-route="meetings"]')!.hasAttribute('aria-current')).toBe(false);
    expect(document.querySelector('[data-route="stats"]')!.getAttribute('aria-current')).toBe('page');
  });
});
