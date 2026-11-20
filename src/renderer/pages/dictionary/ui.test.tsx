// @vitest-environment jsdom
// 사전 화면: 단어 입력칸은 맞춤법 검사를 끈다 (이름·용어에 빨간 밑줄이 생기지 않게)
import { describe, expect, it, vi } from 'vitest';
import { reactPage } from '../../shared/page-host/index.tsx';
import { DictionaryPage } from './ui.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('사전 화면', () => {
  it('단어 입력칸은 spellcheck="false"', () => {
    const words: readonly string[] = [];
    const model = { subscribe: () => () => {}, getSnapshot: () => words, add: vi.fn(async () => true), remove: vi.fn(async () => {}), changed: vi.fn() };
    const page = reactPage(DictionaryPage, { model });
    document.body.replaceChildren(page.el);
    expect(page.el.querySelector('.add-row input')?.getAttribute('spellcheck')).toBe('false');
    page.leave?.();
  });
});
