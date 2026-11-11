import { describe, expect, it } from 'vitest';
import { createVocabularyModel, newWords, parseVocabulary } from './index.ts';

describe('사전 단어 목록', () => {
  it('저장 글자를 쉼표·줄바꿈으로 나눔', () => {
    expect(parseVocabulary('PJY, Whisper\n김신우,, ')).toEqual(['PJY', 'Whisper', '김신우']);
  });
  it('새 단어: 쉼표로 여러 개, 이미 있는 말은 뺌', () => {
    expect(newWords(['PJY', 'Whisper'], '메모리캐시, Whisper, ')).toEqual(['메모리캐시']);
  });
  it('주인의 read·save로만 읽고 쓰며, 같은 글자면 같은 배열(다시 그리지 않게)', async () => {
    let text = 'PJY, Whisper';
    const saved: string[] = [];
    const m = createVocabularyModel({ read: () => text, save: async (v) => { saved.push(v); text = v; } });
    const a = m.getSnapshot();
    expect(m.getSnapshot()).toBe(a);
    expect(await m.add('메모리캐시, PJY')).toBe(true);
    expect(await m.add('PJY')).toBe(false);
    await m.remove('Whisper');
    expect(saved).toEqual(['PJY, Whisper, 메모리캐시', 'PJY, 메모리캐시']);
    expect(m.getSnapshot()).toEqual(['PJY', '메모리캐시']);
    expect(m.getSnapshot()).not.toBe(a);
  });
  it('changed()는 구독자에게 알리고, 해제하면 그만 받는다', () => {
    const m = createVocabularyModel({ read: () => '', save: async () => {} });
    let n = 0;
    const off = m.subscribe(() => n++);
    m.changed();
    off();
    m.changed();
    expect(n).toBe(1);
  });
});
