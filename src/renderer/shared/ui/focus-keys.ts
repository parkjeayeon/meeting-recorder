// 다시 그리면(안을 통째로 새로 만들면) 풀리는 포커스·커서를 되살리는 도우미.
// 포커스를 둘 만한 요소에 data-focus="열쇠"를 단다 — 다시 그려도 같은 것을 가리키면 같은 열쇠 (예: review-add, guess:r1, chat).
// 주인이 그리기 전에 focusMark로 어디에 있었는지(열쇠·고른 범위) 적어 두고, 그린 뒤 restoreFocus로 같은 열쇠의 새 요소를 찾아 되돌린다.
// 열쇠를 상자(예: 확인 필요 카드)에 달면 그 안에서 data-focus-entry(선택자)가 가리키는 첫 요소로, 없으면 첫 컨트롤로 간다.

export interface FocusMark {
  readonly key: string;
  /** 글 입력칸이면 고른 범위 (커서만 있으면 start === end) */
  readonly start: number | null;
  readonly end: number | null;
  readonly dir: 'forward' | 'backward' | 'none' | null;
  readonly scrollTop: number;
}
/** 주인이 이번 그리기에 정해 둔 포커스 — 그리기 전 자리보다 먼저. 함수면 그린 뒤 불러 찾는다 (채팅을 연 버튼처럼 열쇠가 없는 것) */
export type FocusWant =
  | { readonly key: string; readonly caret?: 'end'; readonly reveal?: boolean }
  | (() => HTMLElement | null);

const FOCUSABLE = 'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
// 고른 범위가 있는 입력칸 (email·number 등은 selectionStart를 읽으면 null이거나 오류)
const isText = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|url|tel|password)$/.test(el.type));

/** root 안의 열쇠 → 포커스를 줄 요소 (열쇠가 상자에 있으면 그 안의 첫 요소). 없거나 비활성이면 null */
export function findFocusKey(root: ParentNode, key: string): { readonly host: HTMLElement; readonly el: HTMLElement } | null {
  const host = [...root.querySelectorAll<HTMLElement>('[data-focus]')].find((x) => x.dataset.focus === key);
  if (!host) return null;
  const el = host.matches(FOCUSABLE) ? host : host.matches('input, textarea, select, button') ? null : host.querySelector<HTMLElement>(host.dataset.focusEntry || FOCUSABLE);
  return el ? { host, el } : null;
}

/** 그리기 전: 포커스가 root 안의 열쇠 달린 요소(또는 그 상자 안)에 있으면 그 열쇠와 고른 범위 */
export function focusMark(root: Element): FocusMark | null {
  const a = document.activeElement;
  if (!a || a === document.body || !root.contains(a)) return null;
  const host = a.closest<HTMLElement>('[data-focus]');
  if (!host || !root.contains(host)) return null;
  const text = host === a && isText(a);
  return {
    key: host.dataset.focus!,
    start: text ? a.selectionStart : null,
    end: text ? a.selectionEnd : null,
    dir: text ? a.selectionDirection : null,
    scrollTop: a instanceof HTMLTextAreaElement ? a.scrollTop : 0,
  };
}

/** 그린 뒤: 주인이 정한 곳(want)이 있고 찾으면 그리로. 아니면 그리기 전 자리(mark)와 같은 열쇠의 새 요소로 — 포커스가 그리기 때문에 풀렸을 때만
 *  (몸통으로 빠졌을 때. 그사이 다른 곳으로 간 포커스는 건드리지 않는다). 같은 것이 없으면 아무 데도 옮기지 않는다. 화면은 굴리지 않는다 */
export function restoreFocus(root: Element, mark: FocusMark | null, want: FocusWant | null = null): HTMLElement | null {
  if (want) {
    const found = typeof want === 'function' ? want() : findFocusKey(root, want.key);
    const el = found instanceof HTMLElement ? found : found?.el ?? null;
    if (el) {
      el.focus({ preventScroll: true });
      if (typeof want !== 'function') {
        if (want.caret === 'end' && isText(el)) el.setSelectionRange(el.value.length, el.value.length);
        if (want.reveal) (found as { host: HTMLElement }).host.scrollIntoView?.({ block: 'nearest' });
      }
      return el;
    }
  }
  if (!mark) return null;
  const now = document.activeElement;
  if (now && now !== document.body && now.isConnected) return null;
  const el = findFocusKey(root, mark.key)?.el;
  if (!el) return null;
  el.focus({ preventScroll: true });
  if (mark.start !== null && isText(el)) {
    const n = el.value.length;
    el.setSelectionRange(Math.min(mark.start, n), Math.min(mark.end ?? mark.start, n), mark.dir ?? 'none');
  }
  if (el instanceof HTMLTextAreaElement) el.scrollTop = mark.scrollTop;
  return el;
}
