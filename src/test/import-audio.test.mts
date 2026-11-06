import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

type Guess = { at: Date; source: 'name' | 'mtime' | 'now' };
const mod = createRequire(import.meta.url)('../import-audio.js') as {
  timeFromName: (name: string, now?: Date) => Date | null;
  guessStart: (files: string[]) => Promise<Guess>;
  importAudio: (files: string[], dir: string, opts?: { startedAt?: string | null }) => Promise<string>;
};
const { timeFromName } = mod;
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

// ── 확인 창에서 고른 회의 날짜로 가져오기 (실제 afconvert 변환) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-import-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
function wav(name: string, sec = 1, mtime?: Date) {
  const rate = 16000;
  const n = rate * sec;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 3000), 44 + i * 2);
  const f = path.join(tmp, name);
  fs.writeFileSync(f, b);
  if (mtime) fs.utimesSync(f, mtime, mtime);
  return f;
}

describe.runIf(process.platform === 'darwin' && fs.existsSync('/usr/bin/afconvert'))('가져오기 회의 날짜', () => {
  it('짐작: 파일 이름 → 수정 시각 − 길이 → 지금 (있을 수 없는 수정 시각은 버림)', async () => {
    expect((await mod.guessStart([wav('통화 01012345678_261106_174715.wav')])).source).toBe('name');
    const g = await mod.guessStart([wav('새 녹음.wav', 2, new Date(2026, 9, 3, 10, 0, 2))]);
    expect([g.source, g.at.getHours(), g.at.getMinutes(), g.at.getSeconds()]).toEqual(['mtime', 10, 0, 0]);
    expect((await mod.guessStart([wav('압축 푼 녹음.wav', 1, new Date(1980, 0, 1))])).source).toBe('now');
  });

  it('고른 날짜로 폴더·meta.json을 만든다, 있을 수 없는 날짜면 짐작으로', async () => {
    const root = fs.mkdtempSync(path.join(tmp, 'rec-'));
    const dir = await mod.importAudio([wav('a.wav')], root, { startedAt: new Date(2025, 2, 4, 9, 30).toISOString() });
    expect(path.basename(dir)).toBe('2025-03-04_09-30-00_meeting');
    expect(new Date(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).startedAt).getTime()).toBe(new Date(2025, 2, 4, 9, 30).getTime());
    const dir2 = await mod.importAudio([wav('2026-01-02 10-00-00.wav')], root, { startedAt: '2099-01-01T00:00:00Z' });
    expect(path.basename(dir2)).toBe('2026-01-02_10-00-00_meeting');
  }, 30000);
});
