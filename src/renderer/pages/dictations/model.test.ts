import { describe, expect, it } from 'vitest';
import { countLine, dayGroups, footText } from './model.ts';

const now = new Date(2026, 10, 12, 15);
const at = (day: number, h: number, id = `${day}-${h}`) => ({ id, startedAt: new Date(2026, 10, day, h).toISOString(), durationSec: 3, transcript: { raw: 'x' } });

describe('받아쓰기 기록 계산', () => {
  it('날짜별로 묶고, 더 받을 게 있으면 마지막 날만 "N건+"', () => {
    const items = [at(12, 10), at(12, 9), at(11, 20), at(10, 8)];
    expect(dayGroups(items, false, now).map((g) => [g.label, g.count, g.items.length])).toEqual([['오늘', '2건', 2], ['어제', '1건', 1], ['11월 10일 (화)', '1건', 1]]);
    expect(dayGroups(items, true, now).map((g) => g.count)).toEqual(['2건', '1건', '1건+']);
    expect(dayGroups([], true, now)).toEqual([]);
  });
  it('위 한 줄: 검색이면 찾은 개수와 전체', () => {
    expect(countLine('', 0, 1234)).toBe('전체 1,234개');
    expect(countLine('배포', 3, 1234)).toBe('"배포" 3개 · 전체 1,234개에서');
  });
  it('아래 줄: 이어 받는 중 / 한 묶음보다 많이 봤을 때만 "다 보았습니다"', () => {
    expect(footText('', 30, { next: 'd29', matched: 75 })).toBe('30 / 75개 · 더 불러오는 중…');
    expect(footText('', 75, { next: null, matched: 75 })).toBe('모든 받아쓰기 75개를 다 보았습니다');
    expect(footText('배포', 31, { next: null, matched: 31 })).toBe('찾은 받아쓰기 31개를 다 보았습니다');
    expect(footText('', 30, { next: null, matched: 30 })).toBe('');
  });
});
