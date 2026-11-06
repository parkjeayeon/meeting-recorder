import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { timeFromName } = createRequire(import.meta.url)('../import-audio.js') as { timeFromName: (name: string, now?: Date) => Date | null };
const now = new Date(2026, 10, 6, 20, 0, 0);
const at = (name: string) => {
  const d = timeFromName(name, now);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

describe('timeFromName (가져온 녹음 파일 이름의 시각)', () => {
  it('녹음 앱들이 짓는 이름', () => {
    expect(at('2026-11-04 오후 4.49.27.m4a')).toBe('2026-11-04 16:49:27');
    expect(at('2026-11-04 오전 12.05.00.m4a')).toBe('2026-11-04 00:05:00');
    expect(at('20261104_164927.m4a')).toBe('2026-11-04 16:49:27');
    expect(at('2026-11-04 16-49-27.wav')).toBe('2026-11-04 16:49:27');
    expect(at('Recording 2026.11.04 09:03:07.mp3')).toBe('2026-11-04 09:03:07');
  });

  // 2026-11-06: 통화 녹음 이름의 전화번호를 날짜로 읽어 112년 폴더가 생기고 목록에 안 나와 "삭제된 녹음"으로 보였다 (번호는 지어낸 것)
  it('통화 녹음: 전화번호 숫자는 건너뛰고 연도 두 자리 시각을 읽는다', () => {
    expect(at('통화 01012345678_261106_174715.m4a')).toBe('2026-11-06 17:47:15');
    expect(at('통화 01099990000_261106_174715.m4a')).toBe('2026-11-06 17:47:15');
    expect(at('Call 821012345678_261106_090000.m4a')).toBe('2026-11-06 09:00:00');
    expect(at('통화 홍길동_261105_235959.m4a')).toBe('2026-11-05 23:59:59');
  });

  it('있을 수 없는 시각이면 읽지 않는다 (파일 수정 시각으로 대신함)', () => {
    expect(at('통화 01012345678.m4a')).toBeNull();
    expect(at('2026-13-04 10-00-00.m4a')).toBeNull();
    expect(at('2026-02-30 10-00-00.m4a')).toBeNull();
    expect(at('2026-11-04 24-00-00.m4a')).toBeNull();
    expect(at('1999-11-04 10-00-00.m4a')).toBeNull();
    expect(at('2027-11-04 10-00-00.m4a')).toBeNull(); // 아직 오지 않은 날
    expect(at('새 녹음 3.m4a')).toBeNull();
  });

  it('어떤 숫자 이름이든 고른 시각은 2000년부터 내일까지, 폴더 이름은 네 자리 연도', () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    const parts = ['통화 ', '_', '-', ' ', '.', '010', '82', '2026', '26', '11', '06', '17', '47', '15', '99', '00', '오후 ', 'Call '];
    for (let k = 0; k < 5000; k++) {
      const name = Array.from({ length: 2 + rnd(8) }, () => parts[rnd(parts.length)]).join('') + String(rnd(1e8)) + '.m4a';
      const d = timeFromName(name, now);
      if (!d) continue;
      expect(d.getFullYear(), name).toBeGreaterThanOrEqual(2000);
      expect(d.getTime(), name).toBeLessThanOrEqual(now.getTime() + 86400e3);
    }
  });
});
