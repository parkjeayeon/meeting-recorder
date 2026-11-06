import { describe, expect, it } from 'vitest';
import { dictationStats, pageDictations, parseDictationLog, type DictRecord } from './dictlog.mjs';

const rec = (i: number, extra: Partial<DictRecord> = {}): DictRecord => ({
  id: `d${String(i).padStart(4, '0')}`,
  startedAt: new Date(Date.UTC(2026, 10, 7, 0, 0, 0) - i * 3600e3).toISOString(),
  raw: `말 ${i}`,
  text: `글 ${i}`,
  chars: 10,
  app: i % 2 ? 'Slack' : 'Notes',
  wpm: 100,
  language: i % 5 === 0 ? 'en' : 'ko',
  ...extra,
});

describe('parseDictationLog', () => {
  it('최신순, 빈·지어낸 시도·깨진 줄은 뺀다', () => {
    const lines = [JSON.stringify(rec(3)), '{깨짐', JSON.stringify(rec(1)), JSON.stringify({ ...rec(2), status: 'empty' }), JSON.stringify({ ...rec(4), raw: null }), ''].join('\n');
    expect(parseDictationLog(lines).map((r) => r.id)).toEqual(['d0001', 'd0003']);
  });
});

describe('pageDictations', () => {
  const all = Array.from({ length: 120 }, (_, i) => rec(i));
  it('50개씩 이어 받기, 끝나면 next 없음, 전체 개수', () => {
    const p1 = pageDictations(all, { limit: 50 });
    expect(p1.items.length).toBe(50);
    expect(p1.total).toBe(120);
    const p2 = pageDictations(all, { before: p1.next, limit: 50 });
    expect(p2.items[0]!.id).toBe('d0050');
    const p3 = pageDictations(all, { before: p2.next, limit: 50 });
    expect(p3.items.length).toBe(20);
    expect(p3.next).toBeNull();
  });
  it('찾기는 전체 기록에서 (예전엔 최근 300개 안에서만)', () => {
    const many = Array.from({ length: 1000 }, (_, i) => rec(i, i === 900 ? { text: '오래된 배포 메모' } : {}));
    const r = pageDictations(many, { q: '배포' });
    expect(r.items.map((x) => x.id)).toEqual(['d0900']);
    expect(r.matched).toBe(1);
    expect(r.total).toBe(1000);
    expect(pageDictations(many, { q: 'SLACK' }).matched).toBe(500);
  });
});

describe('dictationStats', () => {
  it('전체 기록으로 합계·언어별·앱별·최근 14일', () => {
    const all = Array.from({ length: 400 }, (_, i) => rec(i)); // 300개를 넘는 기록
    const s = dictationStats(all, new Date(Date.UTC(2026, 10, 7, 3)));
    expect(s.count).toBe(400);
    expect(s.total).toBe(4000);
    expect(s.languages).toEqual([{ language: 'ko', chars: 3200, count: 320 }, { language: 'en', chars: 800, count: 80 }]);
    expect(s.apps.map((a) => a.app).sort()).toEqual(['Notes', 'Slack']);
    expect(s.days.length).toBe(14);
    expect(s.days.reduce((n, d) => n + d.count, 0)).toBeLessThanOrEqual(400);
    expect(s.wpm).toBe(100);
    expect(s.streak).toBeGreaterThan(10);
  });
  it('언어가 없는 예전 기록은 한국어로', () => {
    expect(dictationStats([rec(1, { language: null })]).languages[0]!.language).toBe('ko');
  });
});
