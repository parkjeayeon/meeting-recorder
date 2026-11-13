import { describe, expect, it } from 'vitest';
import { smoothTurns } from './turns.mjs';

const t = (start: number, end: number, speaker: string) => ({ start, end, speaker });

describe('smoothTurns', () => {
  it('같은 사람 사이에 낀 짧은 다른 사람(조각 여럿)을 앞뒤 사람으로', () => {
    // 2026-11-13 회의 12:12~12:29 모양: A 말하는 중 B가 0.0~2.7초 조각으로 끼었다가 다시 A
    const out = smoothTurns([t(732.4, 738.75, 'A'), t(738.75, 738.8, 'B'), t(738.8, 738.82, 'A'), t(738.82, 739.65, 'B'), t(739.7, 739.78, 'B'), t(740.81, 743.48, 'B'), t(743.48, 746.0, 'A')]);
    expect(out).toEqual([t(732.4, 746.0, 'A')]);
  });

  it('5초 넘게 말한 다른 사람은 그대로', () => {
    const out = smoothTurns([t(0, 10, 'A'), t(10.2, 16, 'B'), t(16.1, 20, 'A')]);
    expect(out.map((x) => x.speaker)).toEqual(['A', 'B', 'A']);
  });

  it('앞뒤 사람이 다르면(진짜 주고받기) 그대로', () => {
    const out = smoothTurns([t(0, 10, 'A'), t(10.1, 12, 'B'), t(12.1, 20, 'C')]);
    expect(out.map((x) => x.speaker)).toEqual(['A', 'B', 'C']);
  });

  it('틈이 길면(잠깐 쉬었다 다른 사람이 짧게 말함) 그대로', () => {
    const out = smoothTurns([t(0, 10, 'A'), t(12, 13, 'B'), t(13.2, 20, 'A')]);
    expect(out.map((x) => x.speaker)).toEqual(['A', 'B', 'A']);
  });

  it('같은 사람의 이어진 조각은 한 덩어리로, 순서가 섞여 들어와도', () => {
    expect(smoothTurns([t(5, 6, 'A'), t(0, 4.5, 'A')])).toEqual([t(0, 6, 'A')]);
  });
});
