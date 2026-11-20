import { describe, expect, it } from 'vitest';
import { CHUNK_CHARS, joinCleaned, mapLimit, parseJson, splitChunks } from './text.mjs';
import { ORGANIZE_MIN_CHARS, systemFor } from './cleanup.mjs';
import { maxUsed } from './usage.mjs';

describe('splitChunks', () => {
  it('짧은 글은 나누지 않는다', () => {
    expect(splitChunks('내일 4시에 회의합시다.')).toEqual(['내일 4시에 회의합시다.']);
    expect(splitChunks('가'.repeat(CHUNK_CHARS))).toHaveLength(1);
  });

  it('긴 글은 문장 끝에서 나누고, 이으면 내용이 그대로다', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `${i}번째 문장은 조금 길게 적어서 조각이 여러 개가 되게 합니다.`);
    const chunks = splitChunks(sentences.join(' '));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
      expect(c.endsWith('.')).toBe(true);
    }
    expect(chunks.join(' ')).toBe(sentences.join(' '));
  });

  it('문장 하나가 한도보다 길면 그 문장을 통째로 한 조각으로 둔다', () => {
    const long = `${'가'.repeat(900)}.`;
    expect(splitChunks(`짧은 문장. ${long} 끝 문장.`)).toEqual(['짧은 문장.', long, '끝 문장.']);
  });

  it('마침표 없는 끝부분도 버리지 않는다', () => {
    const text = `${'가나다라마 '.repeat(110)}. 그리고 끝에 마침표 없는 말`;
    expect(splitChunks(text).at(-1)).toBe('그리고 끝에 마침표 없는 말');
  });
});

describe('joinCleaned', () => {
  it('조각이 하나면 그대로', () => {
    expect(joinCleaned(['한 조각'])).toBe('한 조각');
  });
  it('여러 조각은 띄어쓰기로 잇는다', () => {
    expect(joinCleaned(['앞 문장.', '뒤 문장.'])).toBe('앞 문장. 뒤 문장.');
  });
  it('여러 줄로 정리한 조각이 있으면 빈 줄로 잇는다', () => {
    expect(joinCleaned(['주제\n- 하나\n- 둘', '뒤 문장.'])).toBe('주제\n- 하나\n- 둘\n\n뒤 문장.');
  });
});

describe('mapLimit', () => {
  it('결과는 입력 순서대로, 동시에 도는 수는 한도 안', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 10], 2, async (ms, i) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return `${i}:${ms}`;
    });
    expect(out).toEqual(['0:30', '1:5', '2:20', '3:1', '4:10']);
    expect(peak).toBe(2);
  });
  it('빈 목록', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});

describe('parseJson', () => {
  it('```json 블록', () => {
    expect(parseJson('설명\n```json\n{"a": 1}\n```\n끝')).toEqual({ a: 1 });
  });
  it('본문 속 첫 {…}', () => {
    expect(parseJson('결과는 {"items": [1, 2]} 입니다')).toEqual({ items: [1, 2] });
  });
  it('JSON이 아니면 null', () => {
    expect(parseJson('그냥 글')).toBeNull();
    expect(parseJson('{깨진')).toBeNull();
  });
});

describe('systemFor', () => {
  it('짧은 받아쓰기에는 주제별 정리 규칙을 넣지 않는다', () => {
    const short = systemFor('가'.repeat(ORGANIZE_MIN_CHARS - 1));
    const long = systemFor('가'.repeat(ORGANIZE_MIN_CHARS));
    expect(short).not.toContain('organize them by topic');
    expect(short).toContain('only when the speaker clearly enumerated items');
    expect(long).toContain('organize them by topic');
    expect(short).not.toContain('{{ORGANIZE}}');
    expect(long).not.toContain('{{ORGANIZE}}');
  });
});

describe('maxUsed', () => {
  const at = '2026-11-20T00:00:00.000Z';
  it('가장 많이 쓴 창의 %', () => {
    expect(maxUsed({ ok: true, windows: [{ kind: 'session', model: null, usedPercent: 12 }, { kind: 'week', model: null, usedPercent: 91 }], credits: null, via: 'rule', fetchedAt: at })).toBe(91);
  });
  it('못 읽었거나 창이 없으면 모름(null)', () => {
    expect(maxUsed(null)).toBeNull();
    expect(maxUsed({ ok: false, error: '실패', fetchedAt: at })).toBeNull();
    expect(maxUsed({ ok: true, windows: [], credits: null, via: 'rule', fetchedAt: at })).toBeNull();
  });
});
