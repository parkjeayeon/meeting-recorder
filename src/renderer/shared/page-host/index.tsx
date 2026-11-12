// 옛 라우터(legacy/app.js의 ROUTES)에 React 화면을 끼우는 이음새.
// 옛 화면 함수는 { el, update?, leave?, reload? }를 돌려준다. reactPage가 React 화면을 같은 모양으로 감싼다:
//   ROUTES = { …, dictionary: pageDictionary, … }  →  { …, dictionary: () => reactPage(DictionaryPage, { model }), … }
// 화면 하나를 옮기는 일은 ROUTES의 그 자리 한 줄과, 그 화면이 읽는 상태의 창구(model)뿐이다.
//
// 동작을 옛 화면과 맞추려고 하는 일:
// - 첫 그리기는 동기(flushSync): navigate()가 el을 #view에 넣는 순간 이미 그려져 있다 (시험의 고정 대기와 같은 시점).
// - el은 display: contents라 #view 아래 상자 구조가 그대로다 (화면이 자기 .page 뿌리를 그린다).
// - update()는 같은 뿌리를 다시 그린다 — 입력 중인 글자·포커스가 남는다. refresh()가 화면을 새로 만들지 않게 늘 둔다.
// - leave()는 한 번만 내린다(두 번 불러도 안전). 전역 작업(LLM 작업·질문 작업)은 주인이 들고 있어 화면을 떠나도 계속된다.
// - 입력칸은 값을 쥐지 않는(uncontrolled) 방식으로 쓴다: 시험이 el.value = …; input 이벤트로 넣는데, 값을 쥐는 React 입력칸은 그걸 놓친다.
// - 시험이 찾는 클래스(.page, .add-row 등)는 옮긴 화면에도 그대로 둔다 (Playwright로 바꿀 때까지).
import type { ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

/** 옛 라우터가 화면 함수에서 받는 모양 (legacy/app.js navigate()·refresh()가 쓴다) */
export interface PageHandle {
  readonly el: HTMLElement;
  readonly update?: () => void;
  readonly leave?: () => void;
  readonly reload?: () => void;
}

/** hooks — reload: 파일이 바뀌어 다시 읽기 · update: 옛 refresh()가 부를 때 (주지 않으면 같은 값으로 다시 그림) · leave: 떠날 때 치우기 (내리기 전에) */
export function reactPage<P extends object>(Page: ComponentType<P>, props: P, hooks?: { readonly reload?: () => void; readonly update?: () => void; readonly leave?: () => void }): PageHandle {
  const el = document.createElement('div');
  el.style.display = 'contents';
  const root = createRoot(el);
  let gone = false;
  const draw = () => {
    if (!gone) flushSync(() => root.render(<Page {...props} />));
  };
  draw();
  return {
    el,
    update: () => {
      if (gone) return;
      if (hooks?.update) hooks.update();
      else draw();
    },
    leave: () => {
      if (gone) return;
      hooks?.leave?.();
      gone = true;
      root.unmount();
    },
    ...(hooks?.reload ? { reload: () => !gone && hooks.reload?.() } : {}),
  };
}

/** 화면 밖에 늘 떠 있는 React 부품(둥근 버튼·질문 창 등)을 옛 코드가 만든 자리(host)에 붙인다. 첫 그리기는 동기 */
export function mountReact<P extends object>(host: HTMLElement, Part: ComponentType<P>, props: P): void {
  const root = createRoot(host);
  flushSync(() => root.render(<Part {...props} />));
}

/** 옛 화면이 아직 그리는 페이지 안의 React 부품들 (회의 페이지를 나눠 옮기는 동안).
 *  옛 코드가 부품의 뿌리 요소(예: section.glossary)를 만들고 React는 그 안을 그린다 — 감싸는 상자가 생기지 않아
 *  형제 선택자(.flow-row + .glossary) 같은 CSS가 그대로 맞는다. 옛 화면은 그릴 때마다 새로 만드므로 clear()로 모두 내린다 */
export function createIslands() {
  const roots = new Map<HTMLElement, Root>();
  return {
    mount<P extends object>(host: HTMLElement, Part: ComponentType<P>, props: P): HTMLElement {
      roots.get(host)?.unmount();
      const root = createRoot(host);
      flushSync(() => root.render(<Part {...props} />));
      roots.set(host, root);
      return host;
    },
    /** 이 뿌리(host)의 부품만 내린다 */
    unmount(host: HTMLElement | null | undefined) {
      if (!host) return;
      roots.get(host)?.unmount();
      roots.delete(host);
    },
    clear() {
      for (const r of roots.values()) r.unmount();
      roots.clear();
    },
  };
}

/** 옛 코드가 창구(source)를 바꾼 뒤 그 자리에서 다 그려 두게 (뒤이어 그린 화면을 읽는 코드가 있을 때) */
export function commit(fn: () => void): void {
  flushSync(fn);
}
