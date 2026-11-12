// 흐름도를 SVG 파일 내용으로: 화면은 색을 CSS 변수·클래스로 칠해서 그대로 저장하면 색이 빠진다 → 실제 색·글꼴을 요소마다 박고 배경을 깐다.
// 화면이 좁아 나눠 그린 흐름도도 저장은 한 장으로. 지금 테마(라이트·다크)의 색으로 저장한다
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { FlowDoc } from '../../entities/flow/index.ts';
import { FlowSvg } from './svg.tsx';

const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];

export function flowSvgFile(f: FlowDoc, seek: ((sec: number) => void) | null): string {
  // 화면 밖에 그려 실제로 칠해진 값을 읽는다
  const host = document.createElement('div');
  host.setAttribute('style', 'position:fixed;left:-100000px;top:0;visibility:hidden');
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(<FlowSvg f={f} seek={seek} />));
  const svg = host.querySelector('svg')!;
  const out = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [out, ...out.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    dst[i]!.removeAttribute('class');
    dst[i]!.setAttribute('style', SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  const bg = getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#ffffff';
  root.unmount();
  host.remove();
  out.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  out.removeAttribute('role');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of [['width', '100%'], ['height', '100%'], ['fill', bg]]) rect.setAttribute(k!, v!);
  out.insertBefore(rect, out.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(out)}\n`;
}
