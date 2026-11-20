// ── 본문 안 찾기 (⌘F): 지금 보고 있는 탭의 본문만. CSS Highlight로 표시만 하고 글은 고치지 않는다 ──
// 막대(div.find-bar)는 React 밖에서 만들어 .panel에 붙인다 — 페이지를 다시 그려도 남는다. 키(⌘F·⌘G·Escape)는 keys.ts
import { el, icon } from '../../shared/ui/index.tsx';

export interface FindRole {
  readonly open: () => void;
  readonly close: () => void;
  /** d: 1 다음, -1 이전 */
  readonly step: (d: number) => void;
  readonly isOpen: () => boolean;
  /** 다시 그린 뒤: 막대가 열려 있으면 새 본문에서 찾던 말을 다시 찾는다 (고른 차례는 남긴다) */
  readonly refresh: () => void;
  /** 그린 탭 본문 (React의 ref) */
  readonly setScope: (node: HTMLElement | null) => void;
}

export function createFind(): FindRole {
  let findScope: HTMLElement | null = null; // 그린 탭 본문
  let findBar: HTMLElement | null = null;
  let findHits: Range[] = [];
  let findIdx = -1;
  const canHighlight = typeof Highlight !== 'undefined' && Boolean(CSS.highlights);
  const clearFindMarks = () => {
    if (!canHighlight) return;
    CSS.highlights.delete('find');
    CSS.highlights.delete('find-now');
  };
  function runFind({ keep = false } = {}) {
    if (!findBar) return;
    const q = findBar.querySelector('input')!.value.toLowerCase();
    findHits = [];
    if (q && findScope?.isConnected) {
      // 본문 글자를 이어 붙여 찾는다 (용어 밑줄·시각 칩 경계를 넘는 말도 찾게)
      const nodes: { n: Text; at: number }[] = [];
      let text = '';
      const walker = document.createTreeWalker(findScope, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push({ n: n as Text, at: text.length });
        text += n.nodeValue;
      }
      const hay = text.toLowerCase();
      const nodeAt = (i: number) => {
        let lo = 0;
        let hi = nodes.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (nodes[mid]!.at <= i) lo = mid;
          else hi = mid - 1;
        }
        return nodes[lo]!;
      };
      for (let i = hay.indexOf(q); i !== -1 && findHits.length < 5000; i = hay.indexOf(q, i + q.length)) {
        const a = nodeAt(i);
        const b = nodeAt(i + q.length - 1);
        const range = document.createRange();
        range.setStart(a.n, i - a.at);
        range.setEnd(b.n, i + q.length - b.at);
        findHits.push(range);
      }
    }
    findIdx = !findHits.length ? -1 : keep ? Math.min(Math.max(findIdx, 0), findHits.length - 1) : 0;
    showFind(!keep);
  }
  function stepFind(d: number) {
    if (!findHits.length) return;
    findIdx = (findIdx + d + findHits.length) % findHits.length;
    showFind(true);
  }
  function showFind(scroll: boolean) {
    clearFindMarks();
    const bar = findBar!;
    const q = bar.querySelector('input')!.value;
    bar.querySelector('.find-count')!.textContent = !q ? '' : findHits.length ? `${findIdx + 1}/${findHits.length}` : '없음';
    bar.classList.toggle('none', Boolean(q) && !findHits.length);
    if (!findHits.length || !canHighlight) return;
    CSS.highlights.set('find', new Highlight(...findHits));
    CSS.highlights.set('find-now', new Highlight(findHits[findIdx]!));
    if (!scroll) return;
    const v = document.getElementById('view')!;
    const vr = v.getBoundingClientRect();
    const rr = findHits[findIdx]!.getBoundingClientRect();
    if (rr.top < vr.top + 64 || rr.bottom > vr.bottom - 40) v.scrollTop += rr.top - vr.top - vr.height / 3;
  }
  function openFind() {
    if (!findBar) {
      const input = el('input', { type: 'search', placeholder: '이 탭에서 찾기', 'aria-label': '이 탭 본문에서 찾기' }) as HTMLInputElement;
      input.spellcheck = false; // el()은 false 값을 건너뛰므로 직접
      input.oninput = () => runFind();
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          stepFind(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      };
      findBar = el('div', { class: 'find-bar', role: 'search' }, icon('i-search') as unknown as Node, input, el('span', { class: 'find-count' }),
        el('button', { class: 'icon-btn find-up', title: '이전 (⇧↩)', 'aria-label': '이전', onclick: () => stepFind(-1) }, icon('i-left') as unknown as Node),
        el('button', { class: 'icon-btn find-down', title: '다음 (↩)', 'aria-label': '다음', onclick: () => stepFind(1) }, icon('i-left') as unknown as Node),
        el('button', { class: 'icon-btn', title: '닫기 (esc)', 'aria-label': '찾기 닫기', onclick: closeFind }, icon('i-x') as unknown as Node));
      document.querySelector('.panel')!.append(findBar);
    }
    const input = findBar.querySelector('input')!;
    input.focus();
    input.select();
    if (input.value) runFind({ keep: true });
  }
  function closeFind() {
    clearFindMarks();
    findBar?.remove();
    findBar = null;
    findHits = [];
    findIdx = -1;
  }
  return {
    open: openFind,
    close: closeFind,
    step: stepFind,
    isOpen: () => Boolean(findBar),
    refresh: () => {
      if (findBar) runFind({ keep: true });
    },
    setScope: (node) => {
      if (node) findScope = node;
    },
  };
}
