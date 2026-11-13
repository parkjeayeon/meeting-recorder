// 라우터(app/router.ts)에 React 화면을 끼우는 이음새.
// reactPage가 React 화면을 { el, update?, leave?, reload? }로 감싼다.
// 경로 표와 화면이 읽는 창구(model)는 app/pages.ts에서 엮는다.
//
// 화면의 수명과 그리기 규칙:
// - 첫 그리기는 동기(flushSync): navigate()가 el을 #view에 넣는 순간 이미 그려져 있다 (시험의 고정 대기와 같은 시점).
// - el은 display: contents라 #view 아래 상자 구조가 그대로다 (화면이 자기 .page 뿌리를 그린다).
// - update()는 같은 뿌리를 다시 그린다 — 입력 중인 글자·포커스가 남는다. refresh()가 화면을 새로 만들지 않게 늘 둔다.
// - leave()는 한 번만 내린다(두 번 불러도 안전). 전역 작업(LLM 작업·질문 작업)은 주인이 들고 있어 화면을 떠나도 계속된다.
// - 입력칸은 값을 쥐지 않는(uncontrolled) 방식으로 쓴다: 시험이 el.value = …; input 이벤트로 넣는데, 값을 쥐는 React 입력칸은 그걸 놓친다.
// - 시험이 찾는 클래스(.page, .add-row 등)는 옮긴 화면에도 그대로 둔다 (Playwright로 바꿀 때까지).
import type { ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

/** 라우터가 화면 함수에서 받는 모양 (app/router.ts의 navigate()·refresh()가 쓴다) */
export interface PageHandle {
  readonly el: HTMLElement;
  readonly update?: () => void;
  readonly leave?: () => void;
  readonly reload?: () => void;
}

/** hooks — reload: 파일이 바뀌어 다시 읽기 · update: 라우터의 refresh()가 부를 때 (주지 않으면 같은 값으로 다시 그림) · leave: 떠날 때 치우기 (내리기 전에) */
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

/** React 부품을 주어진 자리(host)에 붙인다. 첫 그리기는 동기 */
export function mountReact<P extends object>(host: HTMLElement, Part: ComponentType<P>, props: P): void {
  const root = createRoot(host);
  flushSync(() => root.render(<Part {...props} />));
}

/** 주인이 만든 뿌리 요소 안에 그리는 React 부품들 (body에 붙는 용어 카드·설명 추가).
 *  감싸는 상자 없이 주어진 뿌리 안을 그린다. 뿌리를 다시 만들거나 페이지를 떠날 때 clear()로 모두 내린다 */
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

/** 주인이 창구(source)를 바꾼 뒤 그 자리에서 다 그려 두게 (뒤이어 그린 화면을 읽는 코드가 있을 때) */
export function commit(fn: () => void): void {
  flushSync(fn);
}
