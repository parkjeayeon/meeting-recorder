// React 밖에서 만드는 작은 요소(⌘F 찾기 막대, body에 붙는 카드의 뿌리)를 옛 화면 도우미 h()와 같은 규칙으로 — 속성이 같게 나온다.
// class → className, on… → 처리기, 요소가 가진 이름(aria·data 빼고) → 속성 값, 그 밖은 attribute. null·undefined·false는 건너뛴다.
type Kid = Node | string | number | boolean | null | undefined | Kid[];

export function el(tag: string, props: Record<string, unknown> | null = null, ...kids: Kid[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v as string;
    else if (k.startsWith('on')) (e as unknown as Record<string, unknown>)[k] = v;
    else if (k in e && !k.startsWith('aria') && !k.startsWith('data')) (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, v === true ? '' : v as string);
  }
  e.append(...(kids as unknown[]).flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false) as (Node | string)[]);
  return e;
}

/** SVG 묶음의 아이콘 하나 (옛 icon()) */
export function icon(id: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}
