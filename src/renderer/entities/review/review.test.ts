import { expect, it } from 'vitest';
import { contextLines, itemRange } from './model.ts';

it('다시 받아쓸 구간: 설명의 mm:ss~mm:ss, 없으면 시각 앞 10초~뒤 50초, 시각도 없으면 없음', () => {
  expect(itemRange({ at: '00:20', note: '00:20~00:40 구간 녹음이 빠짐' })).toEqual({ start: 20, end: 40 });
  expect(itemRange({ at: '00:05', note: '뜻을 모름' })).toEqual({ start: 0, end: 55 });
  expect(itemRange({ at: '01:00', heardNote: '00:50 – 00:40' })).toEqual({ start: 50, end: 110 });
  expect(itemRange({ note: '시각 없음' })).toBeNull();
});

const script = '[00:05] [화자 1] 이번에는 통신 한정성을 먼저 봅니다\n[00:14] [민준] 네 랩캐시도 붙여 보죠\n[00:25] [화자 1] 한정성 얘기는 여기까지\n[00:40] 화자 없는 줄';
it('카드의 녹취 문맥: 들린 말이 나온 줄 중 항목 시각에 가장 가까운 줄과 그 앞 줄, 들린 말 자리 표시', () => {
  expect(contextLines({ at: '00:25', heard: '한정성' }, script)).toEqual([
    { at: '00:14', speaker: '민준', text: '네 랩캐시도 붙여 보죠', hit: null },
    { at: '00:25', speaker: '화자 1', text: '한정성 얘기는 여기까지', hit: [0, 3] },
  ]);
  expect(contextLines({ at: null, heard: '한정성' }, script).at(-1)).toMatchObject({ at: '00:05', hit: [8, 11] });
});
it('카드의 녹취 문맥: 들린 말이 없으면 항목 시각의 줄(그 시각까지의 마지막 줄), 단서가 없으면 없음', () => {
  expect(contextLines({ at: '00:20' }, script).map((l) => l.at)).toEqual(['00:05', '00:14']);
  expect(contextLines({ at: '00:40' }, script).at(-1)).toEqual({ at: '00:40', speaker: null, text: '화자 없는 줄', hit: null });
  expect(contextLines({ at: '00:01' }, script).map((l) => l.at)).toEqual(['00:05']);
  expect(contextLines({ heard: '없는 말' }, script)).toEqual([]);
  expect(contextLines({}, script)).toEqual([]);
  expect(contextLines({ at: '00:05' }, '')).toEqual([]);
});
