import { describe, expect, it } from 'vitest';
import { clock, parseScript, speakerStats } from './script.mjs';

describe('parseScript', () => {
  it('시각·화자·말을 나눈다', () => {
    expect(parseScript('[01:02] [화자 1] 안녕\n[1:00:05] 혼잣말\n머리말')).toEqual([
      { at: 62, stamp: '01:02', who: '화자 1', said: '안녕' },
      { at: 3605, stamp: '1:00:05', who: null, said: '혼잣말' },
      { at: null, stamp: '', who: null, said: '머리말' },
    ]);
  });
});

describe('speakerStats', () => {
  it('다음 줄까지 간격(최대 30초)으로 말한 시간을 어림하고 많이 말한 순서로', () => {
    const lines = parseScript('[00:00] [A] 1\n[00:10] [B] 2\n[01:00] [A] 3');
    expect(speakerStats(lines, 70)).toEqual([
      { who: 'B', sec: 30, lines: 1, first: '00:10' },
      { who: 'A', sec: 20, lines: 2, first: '00:00' },
    ]);
  });
});

it('clock', () => {
  expect(clock(65.9)).toBe('01:05');
  expect(clock(3725)).toBe('1:02:05');
});
