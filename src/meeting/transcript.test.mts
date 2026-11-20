import { describe, expect, it } from 'vitest';
import { clock as coreClock } from '../core/script.mjs';
import { assignSpeakers, buildTranscript, clock, collapseRepeats, findLoops, formatLine, type LabeledLine, type Segment, type TranscriptLine } from './transcript.mjs';

// 지어낸 녹취: 말마다 [길이(초), 글] → 이어 붙인 구간
const segs = (...said: [number, string][]): Segment[] => {
  let at = 0;
  return said.map(([sec, text]) => {
    const s = { start: at, end: at + sec, text };
    at += sec;
    return s;
  });
};

describe('findLoops', () => {
  it('같은 줄이 세 번 이상, 15초 이상 이어지면 그 구간', () => {
    const s = segs([4, '안건부터 보겠습니다'], [5, '다음 주까지 정리해 주세요'], [5, '다음 주까지 정리해 주세요'], [5, '다음 주까지 정리해 주세요'], [5, '다음 주까지 정리해 주세요'], [3, '네 알겠습니다']);
    expect(findLoops(s)).toEqual([{ start: 4, end: 24 }]);
  });
  it('두 줄·세 줄이 번갈아 되풀이되는 구간', () => {
    const two = segs([3, '그 부분은'], [3, '네'], [3, '그 부분은'], [3, '네'], [3, '그 부분은'], [3, '네']);
    expect(findLoops(two)).toEqual([{ start: 0, end: 18 }]);
    const three = segs([2, '가'], [2, '나'], [2, '다'], [2, '가'], [2, '나'], [2, '다'], [2, '가'], [2, '나'], [2, '다']);
    expect(findLoops(three)).toEqual([{ start: 0, end: 18 }]);
  });
  it('한 줄 안에서 같은 말을 다섯 번 넘게 되풀이 (15초 이상일 때만)', () => {
    expect(findLoops(segs([20, '그래서 그래서 그래서 그래서 그래서']))).toEqual([{ start: 0, end: 20 }]);
    expect(findLoops(segs([10, '그래서 그래서 그래서 그래서 그래서']))).toEqual([]);
    expect(findLoops(segs([20, '그래서 그래서 그래서 그래서']))).toEqual([]);
  });
  it('세 번 미만이거나 15초 미만이면 아니다', () => {
    expect(findLoops(segs([10, '같은 말'], [10, '같은 말'], [3, '다른 말']))).toEqual([]);
    expect(findLoops(segs([3, '같은 말'], [3, '같은 말'], [3, '같은 말'], [3, '같은 말']))).toEqual([]);
    expect(findLoops([])).toEqual([]);
  });
  it('띄어쓰기·문장부호(. , ! ? … ~)는 무시하고 비교한다', () => {
    const s = segs([5, '좋습니다.'], [5, '좋 습니다'], [5, '좋습니다!'], [5, '좋습니다…~']);
    expect(findLoops(s)).toEqual([{ start: 0, end: 20 }]);
  });
  it('반복 구간이 둘이면 둘 다', () => {
    const s = segs([5, 'A'], [5, 'A'], [5, 'A'], [2, '중간'], [6, 'B'], [6, 'B'], [6, 'B']);
    expect(findLoops(s)).toEqual([{ start: 0, end: 15 }, { start: 17, end: 35 }]);
  });
});

describe('assignSpeakers', () => {
  const line = (start: number, end: number): LabeledLine => ({ start, end });
  it('가장 많이 겹치는 화자', () => {
    const lines = [line(0, 10)];
    expect(assignSpeakers(lines, [{ start: 0, end: 3, speaker: 'A' }, { start: 3, end: 10, speaker: 'B' }])).toBe(1);
    expect(lines[0]!.label).toBe('화자 1');
  });
  it('겹치는 화자가 없으면 2초 안의 가장 가까운 화자, 2초 이상 떨어지면 붙이지 않는다', () => {
    const turns = [{ start: 13, end: 15, speaker: 'A' }, { start: 20, end: 25, speaker: 'B' }];
    const near = [line(10, 12)];
    assignSpeakers(near, turns);
    expect(near[0]!.label).toBe('화자 1');
    const far = [line(10, 11)]; // A까지 2초
    expect(assignSpeakers(far, turns)).toBe(0);
    expect(far[0]!.label).toBeUndefined();
  });
  it('처음 말한 순서대로 화자 1, 2', () => {
    const lines = [line(0, 5), line(5, 10), line(10, 15)];
    const turns = [{ start: 0, end: 5, speaker: 'SPEAKER_01' }, { start: 5, end: 10, speaker: 'SPEAKER_00' }, { start: 10, end: 15, speaker: 'SPEAKER_01' }];
    expect(assignSpeakers(lines, turns)).toBe(2);
    expect(lines.map((l) => l.label)).toEqual(['화자 1', '화자 2', '화자 1']);
  });
  it('이미 정한 번호를 넘기면 이어서 매긴다', () => {
    const names = new Map([['S0', '화자 1']]);
    const lines = [line(0, 5), line(10, 15)];
    expect(assignSpeakers(lines, [{ start: 0, end: 5, speaker: 'S1' }, { start: 10, end: 15, speaker: 'S0' }], names)).toBe(2);
    expect(lines.map((l) => l.label)).toEqual(['화자 2', '화자 1']);
    expect([...names]).toEqual([['S0', '화자 1'], ['S1', '화자 2']]);
  });
  it('같은 사람 말 사이에 몇 초만 끼어든 다른 사람은 앞뒤 사람으로 (smoothTurns)', () => {
    const lines = [line(0, 5), line(10.5, 12)];
    expect(assignSpeakers(lines, [{ start: 0, end: 10, speaker: 'A' }, { start: 10.5, end: 12, speaker: 'B' }, { start: 12.5, end: 20, speaker: 'A' }])).toBe(1);
    expect(lines.map((l) => l.label)).toEqual(['화자 1', '화자 1']);
  });
});

describe('collapseRepeats', () => {
  it('같은 화자가 연달아 같은 말을 하면 한 줄로 (끝 시각은 늘림), 원본은 그대로', () => {
    const lines: TranscriptLine[] = [
      { start: 0, end: 1, text: '그', label: '화자 1' },
      { start: 1, end: 2, text: '그.', label: '화자 1' },
      { start: 2, end: 3, text: '그', label: '화자 2' },
      { start: 3, end: 4, text: '다른 말', label: '화자 2' },
      { start: 4, end: 5, text: '그', label: '화자 2' },
    ];
    const before = structuredClone(lines);
    expect(collapseRepeats(lines)).toEqual([
      { start: 0, end: 2, text: '그', label: '화자 1' },
      { start: 2, end: 3, text: '그', label: '화자 2' },
      { start: 3, end: 4, text: '다른 말', label: '화자 2' },
      { start: 4, end: 5, text: '그', label: '화자 2' },
    ]);
    expect(lines).toEqual(before);
  });
});

describe('buildTranscript', () => {
  it('두 트랙이고 화자 구분이 없으면 나·상대방', () => {
    const r = buildTranscript(
      [
        { start: 1.4, end: 3, text: '안녕하세요', track: 'mic' },
        { start: 3.2, end: 5, text: '네 반갑습니다', track: 'system' },
      ],
      null,
      ['mic', 'system'],
    );
    expect(r).toEqual({ text: '[00:01] [나] 안녕하세요\n[00:03] [상대방] 네 반갑습니다', speakerCount: 0 });
  });
  it('한 트랙이고 화자 구분이 없으면 이름 없이, 한 시간이 넘으면 [h:mm:ss]', () => {
    const r = buildTranscript([{ start: 59 * 60 + 59.9, end: 3601, text: '정리하면', track: 'mic' }, { start: 3725, end: 3730, text: '끝', track: 'mic' }], undefined, ['mic']);
    expect(r.text).toBe('[59:59] 정리하면\n[1:02:05] 끝');
  });
  it('화자 구분이 있으면 마이크 줄에 화자 N, 시스템 줄은 상대방, 연달은 같은 말은 합친다', () => {
    const segments = [
      { start: 0, end: 4, text: '시작하겠습니다', track: 'mic' },
      { start: 4, end: 6, text: '그', track: 'mic' },
      { start: 6, end: 7, text: '그', track: 'mic' },
      { start: 7, end: 9, text: '들립니까', track: 'system' },
      { start: 9, end: 12, text: '네 좋습니다', track: 'mic' },
    ];
    const before = structuredClone(segments);
    const diarization = { segments: [{ start: 0, end: 7, speaker: 'SPEAKER_02' }, { start: 9, end: 12, speaker: 'SPEAKER_00' }] };
    expect(buildTranscript(segments, diarization, ['mic', 'system'])).toEqual({
      text: '[00:00] [화자 1] 시작하겠습니다\n[00:04] [화자 1] 그\n[00:07] [상대방] 들립니까\n[00:09] [화자 2] 네 좋습니다',
      speakerCount: 2,
    });
    expect(segments).toEqual(before);
  });
  it('화자 구분이 실패했으면(segments 없음) 트랙 이름으로', () => {
    const failed: { segments?: undefined; error: string } = { error: '화자 구분 실패' };
    const r = buildTranscript([{ start: 0, end: 1, text: '하나', track: 'mic' }], failed, ['mic', 'system']);
    expect(r).toEqual({ text: '[00:00] [나] 하나', speakerCount: 0 });
  });
  it('빈 녹취', () => {
    expect(buildTranscript([], null, ['mic'])).toEqual({ text: '', speakerCount: 0 });
  });
});

describe('clock · formatLine', () => {
  it('mm:ss, 한 시간부터 h:mm:ss, 소수점은 버림', () => {
    expect(clock(0)).toBe('00:00');
    expect(clock(59.99)).toBe('00:59');
    expect(clock(754.5)).toBe('12:34');
    expect(clock(3599.9)).toBe('59:59');
    expect(clock(3600)).toBe('1:00:00');
    expect(clock(5093)).toBe('1:24:53');
    expect(clock(36000 + 61)).toBe('10:01:01');
  });
  it('코어(src/core/script.mts)의 clock을 그대로 쓴다', () => {
    expect(clock).toBe(coreClock);
  });
  it('formatLine: 화자가 있으면 시각 뒤에 [화자]', () => {
    expect(formatLine({ start: 65, end: 70, text: '다음 안건', label: '화자 2' })).toBe('[01:05] [화자 2] 다음 안건');
    expect(formatLine({ start: 3725, end: 3730, text: '끝', label: null })).toBe('[1:02:05] 끝');
  });
});
