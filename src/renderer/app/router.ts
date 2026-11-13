import type { PageHandle } from '../shared/page-host/index.tsx';
import { el, icon } from '../shared/ui/index.tsx';

export interface Route {
  readonly name: string;
  readonly arg: string | null;
}
export interface RouteTable {
  readonly [name: string]: {
    readonly title: string;
    readonly mount: (arg: string | null) => PageHandle;
  };
}
export interface RouterDeps {
  readonly api: { readonly onSwipe?: (cb: (dir: string) => void) => void };
}
export interface Router {
  readonly route: () => Route;
  readonly navigate: () => void;
  readonly refresh: () => void;
  readonly replace: (hash: string) => void;
  readonly setCrumbs: (title?: string | null) => void;
  readonly canGoBack: () => boolean;
  readonly current: () => PageHandle | null;
  readonly connect: () => void;
}

export function createRouter(table: RouteTable, { api }: RouterDeps): Router {
  const titles = Object.fromEntries(Object.entries(table).map(([name, entry]) => [name, entry.title]));
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  let route = parseHash();
  let current: PageHandle | null = null; // { el, update? }
  let connected = false;

  function parseHash(): Route {
    const [name, ...rest] = location.hash.slice(1).split('/');
    return { name: table[name!] ? name! : 'home', arg: rest.length ? decodeURIComponent(rest.join('/')) : null };
  }

  // 뒤로·앞으로: 해시 이동마다 window.history.state에 순번을 붙여 지금 어디쯤인지 안다
  let navIndex = 0;
  let navMax = 0;
  let navStarted = false;
  function trackHistory(): void {
    const idx = window.history.state?.idx;
    if (typeof idx === 'number') navIndex = idx;
    else if (!navStarted) window.history.replaceState({ idx: 0 }, ''); // 앱을 연 첫 화면
    else {
      navIndex += 1;
      navMax = navIndex; // 새로 이동하면 앞으로 갈 곳은 사라진다
      window.history.replaceState({ idx: navIndex }, '');
    }
    navMax = Math.max(navMax, navIndex);
    navStarted = true;
    $<HTMLButtonElement>('navBack').disabled = navIndex <= 0;
    $<HTMLButtonElement>('navFwd').disabled = navIndex >= navMax;
  }

  // 지운 회의에서 벗어날 때는 기록을 바꿔치워 뒤로 가기로 다시 오지 않게 한다
  function replace(hash: string): void {
    window.history.replaceState({ idx: navIndex }, '', hash);
    navigate();
  }

  function navigate(): void {
    trackHistory();
    route = parseHash();
    const navName = route.name === 'meeting' ? 'meetings' : route.name;
    for (const a of document.querySelectorAll<HTMLAnchorElement>('.nav a.nav-item')) {
      if (a.dataset.route === navName) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    current?.leave?.();
    current = table[route.name]!.mount(route.arg);
    $('view').replaceChildren(current.el);
    $('view').scrollTop = 0;
    setCrumbs();
  }

  function setCrumbs(title?: string | null): void {
    const crumbs = $('crumbs');
    crumbs.replaceChildren();
    if (route.name === 'meeting') {
      crumbs.append(el('a', { href: '#meetings' }, '회의'), icon('i-right'), el('b', null, title ?? ''));
    } else crumbs.append(el('b', null, titles[route.name]));
  }

  // 데이터가 바뀌면 지금 화면만 다시 그린다 (스크롤 위치와 입력칸은 지킨다)
  function refresh(): void {
    if (!current) return;
    const top = $('view').scrollTop;
    if (current.update) current.update();
    else {
      current = table[route.name]!.mount(route.arg);
      $('view').replaceChildren(current.el);
    }
    $('view').scrollTop = top;
  }

  return {
    route: () => route,
    navigate,
    refresh,
    replace,
    setCrumbs,
    canGoBack: () => navIndex > 0,
    current: () => current,
    connect: () => {
      if (connected) return;
      connected = true;
      $('navBack').onclick = () => window.history.back();
      $('navFwd').onclick = () => window.history.forward();
      document.addEventListener('keydown', (e) => {
        if (!e.metaKey || (e.target as Element).closest?.('input, textarea')) return;
        if (e.key === '[') {
          e.preventDefault();
          if (navIndex > 0) window.history.back();
        } else if (e.key === ']') {
          e.preventDefault();
          if (navIndex < navMax) window.history.forward();
        }
      });
      // 마우스 옆 버튼(뒤로·앞으로)
      window.addEventListener('mouseup', (e) => {
        if (e.button === 3 && navIndex > 0) window.history.back();
        if (e.button === 4 && navIndex < navMax) window.history.forward();
      });
      api.onSwipe?.((dir) => {
        if (dir === 'left' && navIndex > 0) window.history.back();
        if (dir === 'right' && navIndex < navMax) window.history.forward();
      });
      window.addEventListener('hashchange', navigate);
    },
  };
}
