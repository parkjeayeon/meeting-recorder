import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findStrayFolders } from './stray.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-stray-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const old = Date.now() - 60 * 60 * 1000;
function folder(name: string, files: Record<string, string>, mtime = old) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, f), data);
    fs.utimesSync(path.join(dir, f), mtime / 1000, mtime / 1000);
  }
  return dir;
}
const meta = JSON.stringify({ mode: 'meeting', startedAt: '2026-11-06T08:47:15.000Z', files: { mic: { file: 'mic.wav', durationSec: 60 } } });

folder('2026-11-05_10-00-00_meeting', { 'meta.json': meta, 'mic.wav': 'RIFF' }); // 정상 (목록에 나온다)
folder('112-06-26_02-26-26_meeting', { 'meta.json': meta, 'mic.wav': 'RIFF....' }); // 날짜를 잘못 읽은 가져오기
folder('112-06-26_02-26-26_meeting-2', { 'meta.json': meta, 'mic.wav': 'RIFF' });
folder('2026-11-04_09-00-00_meeting', { 'mic.wav': 'RIFF' }); // 녹음이 끊겨 meta.json 없음
folder('2026-11-03_09-00-00_meeting', { 'meta.json': '{"mode":"meet', 'mic.wav': 'RIFF' }); // meta.json 깨짐
folder('2026-11-06_11-00-00_meeting', { 'mic.wav': 'RIFF' }, Date.now() - 10_000); // 방금 바뀜: 녹음·가져오기 중일 수 있음
const recording = folder('2026-11-06_12-00-00_meeting', { 'mic.wav': 'RIFF' }); // 지금 녹음 중 (skip)
folder('사진', { 'a.jpg': 'x' }); // 사용자가 고른 녹음 폴더에 있던 다른 폴더
folder('메모 정리', {});
folder('.Trash', { 'mic.wav': 'x' });
fs.writeFileSync(path.join(root, 'dictations.jsonl'), '');

describe('findStrayFolders', () => {
  const found = findStrayFolders(root, { skip: [recording] });
  const by = Object.fromEntries(found.map((f) => [f.id, f]));

  it('목록에 안 나오는 이 앱의 폴더만 이유와 함께', () => {
    expect(Object.keys(by).sort()).toEqual(['112-06-26_02-26-26_meeting', '112-06-26_02-26-26_meeting-2', '2026-11-03_09-00-00_meeting', '2026-11-04_09-00-00_meeting']);
    expect(by['112-06-26_02-26-26_meeting']).toMatchObject({ reason: 'bad-name', audio: true, bytes: meta.length + 8 });
    expect(by['2026-11-04_09-00-00_meeting']!.reason).toBe('no-meta');
    expect(by['2026-11-03_09-00-00_meeting']!.reason).toBe('bad-meta');
  });

  it('지금 쓰는 폴더·방금 바뀐 폴더·사용자 폴더·숨김 폴더·파일은 건드리지 않는다', () => {
    for (const id of ['2026-11-06_12-00-00_meeting', '2026-11-06_11-00-00_meeting', '사진', '메모 정리', '.Trash', 'dictations.jsonl', '2026-11-05_10-00-00_meeting']) expect(by[id], id).toBeUndefined();
    // 시간이 지나면 끊긴 녹음으로 본다
    expect(findStrayFolders(root, { skip: [recording], now: Date.now() + 5 * 60 * 1000 }).map((f) => f.id)).toContain('2026-11-06_11-00-00_meeting');
  });

  it('녹음 폴더가 없으면 빈 목록', () => {
    expect(findStrayFolders(path.join(root, '없음'))).toEqual([]);
  });
});
