// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { el, icon } from './dom.ts';

describe('el', () => {
  it('자식을 깊이에 상관없이 펼치고 null·undefined·false만 뺀다', () => {
    const child = el('b', null, '끝');
    const root = el('div', null, ['시작', [null, undefined, false, ['', [0, true, child]]]]);
    expect(root.innerHTML).toBe('시작0true<b>끝</b>');
    expect([...root.childNodes].map((node) => node.textContent)).toEqual(['시작', '', '0', 'true', '끝']);
    expect(root.lastChild).toBe(child);
  });

  it('속성·처리기·aria·data와 spellcheck의 옛 규칙을 지킨다', () => {
    const onchange = vi.fn();
    const input = el('input', { class: 'field', value: '입력', checked: true, disabled: false, spellcheck: false, onchange, 'aria-label': '이름', 'data-ready': true, 'data-skip': false }) as HTMLInputElement;
    expect(input.outerHTML).toBe('<input class="field" aria-label="이름" data-ready="">');
    expect(input.value).toBe('입력');
    expect(input.checked).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.hasAttribute('spellcheck')).toBe(false);
    input.dispatchEvent(new Event('change'));
    expect(onchange).toHaveBeenCalledOnce();
    expect(icon('i-check').outerHTML).toBe('<svg><use href="#i-check"></use></svg>');
  });
});
