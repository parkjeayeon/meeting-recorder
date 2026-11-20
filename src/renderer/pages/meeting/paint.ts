// 그리기: 주인이 만든 view를 창구로 넘기고 그 자리에서 그려 둔다(commit). 그릴 때마다 React가 안을 새로 만든다 — 옛 화면처럼.
// 이 역할이 view·version·그린 페이지(root)·다음 그리기의 포커스(focusWant)·한글 조합 중 미룬 그리기를 든다.
import { createSource, type Source } from '../../shared/lib/index.ts';
import { commit } from '../../shared/page-host/index.tsx';
import { focusMark, restoreFocus, type FocusWant } from '../../shared/ui/index.tsx';
import type { MeetingView } from './ui.tsx';

export interface PaintRole {
  readonly source: Source<MeetingView | null>;
  /** 이 view로 그린다 (빠진 칸은 비운다) */
  readonly show: (v: Partial<MeetingView>) => void;
  /** 이번 그리기 뒤에 포커스를 줄 곳 */
  readonly want: (w: FocusWant) => void;
  readonly root: () => HTMLElement | null;
  /** 그린 페이지를 받아 한글 조합을 지켜본다 (redraw: 조합이 끝난 뒤 미룬 그리기) */
  readonly attach: (page: HTMLElement, redraw: () => void) => void;
}

/** afterPaint: 그린 뒤 할 일 (찾기 막대가 열려 있으면 새 본문에서 다시 찾기) */
export function createPaint({ afterPaint }: { readonly afterPaint: () => void }): PaintRole {
  let view: MeetingView | null = null;
  let version = 0;
  const source = createSource(() => view, () => [view]);
  const show = (v: Partial<MeetingView>) => {
    view = { version: ++version, gone: null, head: null, menu: null, speakerBar: null, player: null, compress: null, state: null, tabs: [], tab: null, body: { kind: 'none' }, chat: null, flowChat: null, ...v };
    paint();
  };
  // 그리기 = 안을 통째로 새로 만들기라 포커스·커서가 풀린다 → 그리기 전 자리를 열쇠(data-focus)로 적어 두고 그린 뒤 같은 열쇠의 새 요소로 되돌린다.
  // 주인이 이번 그리기에 정해 둔 곳(focusWant: 처리한 다음 항목·고른 탭·채팅 입력칸·채팅을 연 버튼)이 먼저다.
  // 한글을 조합하는 중이면 입력칸을 바꾸면 조합이 깨진다(다음 자모가 새 글자로 붙는다) → 조합이 끝날 때까지 그리기를 미룬다
  let root: HTMLElement | null = null; // 그린 페이지 (지워진 회의 화면에는 없음)
  let focusWant: FocusWant | null = null;
  let composing = false;
  let held = false;
  function paint() {
    if (composing) {
      held = true;
      return;
    }
    held = false;
    const mark = root ? focusMark(root) : null;
    const want = focusWant;
    focusWant = null;
    commit(() => source.changed());
    if (!root) return;
    restoreFocus(root, mark, want);
    afterPaint(); // 탭을 바꾸거나 다시 그려도 찾던 말을 그대로 표시
  }
  function attach(page: HTMLElement, redraw: () => void) {
    root = page;
    page.addEventListener('compositionstart', () => {
      composing = true;
    });
    // 조합이 끝나면 미룬 그리기를 한다. 한 박자 뒤에 — 한글은 한 글자를 끝내자마자 같은 키로 다음 글자 조합을 시작한다.
    // 미룬 view에는 그때의 쓰던 글이 들어 있으므로 view를 다시 만든다(draw)
    const composed = () => {
      composing = false;
      setTimeout(() => {
        if (held && !composing) redraw();
      });
    };
    page.addEventListener('compositionend', composed);
    page.addEventListener('focusout', () => composing && composed());
  }
  return {
    source,
    show,
    want: (w) => {
      focusWant = w;
    },
    root: () => root,
    attach,
  };
}
