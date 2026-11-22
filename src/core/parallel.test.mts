import { describe, expect, it } from 'vitest';
import { envCount, meetingServers } from './parallel.mjs';

const GB = 1024 ** 3;

describe('meetingServers', () => {
  it('조각이 하나(또는 없음)면 언제나 1', () => {
    expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 1, env: {} })).toBe(1);
    expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 0, env: {} })).toBe(1);
    expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 1, env: { MR_MEETING_SERVERS: '4' } })).toBe(1);
  });

  it('조각이 둘 이상이면 메모리 24GB 이상에서 2, 그 아래는 1', () => {
    expect(meetingServers({ totalMemBytes: 24 * GB, pieces: 5, env: {} })).toBe(2);
    expect(meetingServers({ totalMemBytes: 51 * GB, pieces: 2, env: {} })).toBe(2);
    expect(meetingServers({ totalMemBytes: 24 * GB - 1, pieces: 5, env: {} })).toBe(1);
    expect(meetingServers({ totalMemBytes: 16 * GB, pieces: 12, env: {} })).toBe(1);
  });

  it('MR_MEETING_SERVERS=<1..4>가 규칙을 이긴다 (조각 수보다 많이는 아니다)', () => {
    expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 5, env: { MR_MEETING_SERVERS: '1' } })).toBe(1);
    expect(meetingServers({ totalMemBytes: 16 * GB, pieces: 5, env: { MR_MEETING_SERVERS: '3' } })).toBe(3);
    expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 5, env: { MR_MEETING_SERVERS: ' 4 ' } })).toBe(4);
    expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 2, env: { MR_MEETING_SERVERS: '4' } })).toBe(2);
  });

  it('틀린 값은 무시하고 규칙대로', () => {
    for (const v of ['', ' ', '0', '5', '-1', '2.5', 'abc', 'Infinity', '1e9', 'two']) {
      expect(meetingServers({ totalMemBytes: 64 * GB, pieces: 5, env: { MR_MEETING_SERVERS: v } }), v).toBe(2);
      expect(meetingServers({ totalMemBytes: 8 * GB, pieces: 5, env: { MR_MEETING_SERVERS: v } }), v).toBe(1);
    }
  });
});

describe('envCount', () => {
  it('범위 안의 정수만', () => {
    expect(envCount({ N: '16' }, 'N', 1, 16)).toBe(16);
    expect(envCount({ N: '17' }, 'N', 1, 16)).toBeNull();
    expect(envCount({}, 'N', 1, 16)).toBeNull();
    expect(envCount({ N: '3.0' }, 'N', 1, 16)).toBe(3);
  });
});
