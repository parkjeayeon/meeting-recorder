// 커서 위치에 붙여 넣기 (src/dictation/paste.mts) — 가짜 클립보드·가짜 붙여넣기 도우미·가짜 시계로 (진짜 클립보드는 쓰지 않는다)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasteResult } from '../platform/index.mjs';
import { createPaste, type ClipboardEntry } from './paste.mjs';

// 가짜 ClipboardItem: 받은 것을 그대로 들고 있다
class FakeItem {
  readonly data: Record<string, unknown>;
  constructor(data: Record<string, unknown>) {
    this.data = data;
  }
}

let log: string[];
let current: ClipboardEntry[];
let written: unknown[] | null;
let result: PasteResult;
let readFails: boolean;

const entry = (data: Record<string, string>, broken: string[] = []): ClipboardEntry => ({
  types: [...Object.keys(data), ...broken],
  getType: async (type) => {
    if (broken.includes(type)) throw new Error('못 읽음');
    return data[type];
  },
});

function make() {
  return createPaste({
    clipboard: {
      read: async () => {
        log.push('read');
        if (readFails) throw new Error('read 실패');
        return current;
      },
      write: async (items) => {
        log.push('write');
        written = items;
      },
      writeText: async (text) => {
        log.push(`writeText ${text}`);
      },
      clear: () => {
        log.push('clear');
      },
    },
    ClipboardItem: FakeItem,
    platform: {
      paster: {
        sendPaste: async (bin) => {
          log.push(`sendPaste ${bin}`);
          return result;
        },
      },
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  current = [entry({ 'text/plain': '원래 글', 'text/html': '<b>원래</b>' })];
  written = null;
  result = 'pasted';
  readFails = false;
});
afterEach(() => vi.useRealTimers());

describe('paste', () => {
  it('보관 → 글 넣기 → 붙여넣기 키, 붙였으면 0.6초 뒤 되돌린다', async () => {
    expect(await make()('받아쓴 글', '/helper')).toBe('pasted');
    expect(log).toEqual(['read', 'writeText 받아쓴 글', 'sendPaste /helper']);
    await vi.advanceTimersByTimeAsync(599);
    expect(log).not.toContain('write');
    await vi.advanceTimersByTimeAsync(1);
    expect(log.at(-1)).toBe('write');
    expect(written).toEqual([new FakeItem({ 'text/plain': '원래 글', 'text/html': '<b>원래</b>' })]);
  });

  it('못 읽는 형식은 빼고, 남는 것이 없는 항목은 버린다', async () => {
    current = [entry({ 'text/plain': 'a' }, ['image/png']), entry({}, ['x/y'])];
    await make()('t', '/h');
    await vi.runAllTimersAsync();
    expect(written).toEqual([new FakeItem({ 'text/plain': 'a' })]);
  });

  it('클립보드가 비어 있었으면 되돌릴 때 비운다', async () => {
    current = [];
    await make()('t', '/h');
    await vi.runAllTimersAsync();
    expect(log.at(-1)).toBe('clear');
    expect(written).toBeNull();
  });

  for (const r of ['no-permission', 'failed', 'elevated'] as const) {
    it(`붙이지 못하면(${r}) 클립보드에 받아쓴 글을 남긴다`, async () => {
      result = r;
      expect(await make()('t', '/h')).toBe(r);
      await vi.runAllTimersAsync();
      expect(log).toEqual(['read', 'writeText t', 'sendPaste /h']);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('보관에 실패하면 붙여도 되돌리지 않는다', async () => {
    readFails = true;
    expect(await make()('t', '/h')).toBe('pasted');
    await vi.runAllTimersAsync();
    expect(log).toEqual(['read', 'writeText t', 'sendPaste /h']);
  });
});
