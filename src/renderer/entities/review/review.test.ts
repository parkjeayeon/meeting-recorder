import { expect, it } from 'vitest';
import { itemRange } from './model.ts';

it('다시 받아쓸 구간: 설명의 mm:ss~mm:ss, 없으면 시각 앞 10초~뒤 50초, 시각도 없으면 없음', () => {
  expect(itemRange({ at: '00:20', note: '00:20~00:40 구간 녹음이 빠짐' })).toEqual({ start: 20, end: 40 });
  expect(itemRange({ at: '00:05', note: '뜻을 모름' })).toEqual({ start: 0, end: 55 });
  expect(itemRange({ at: '01:00', heardNote: '00:50 – 00:40' })).toEqual({ start: 50, end: 110 });
  expect(itemRange({ note: '시각 없음' })).toBeNull();
});
