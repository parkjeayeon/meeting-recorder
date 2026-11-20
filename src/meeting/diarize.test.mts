import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeDeps, tmpDir } from '../test/meeting.mjs';
import { configure } from './deps.mjs';
import { diarizeAvailable, labelRedoLines, speakerTurns } from './diarize.mjs';

let dir = '';
const write = (f: string, data: unknown) => fs.writeFileSync(path.join(dir, f), JSON.stringify(data));
beforeEach(() => {
  dir = tmpDir('mr-diarize-');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('speakerTurns', () => {
  it('화자 구분이 없으면 null', () => {
    expect(speakerTurns(dir)).toBeNull();
    write('diarization.json', { segments: [] });
    expect(speakerTurns(dir)).toBeNull();
  });

  it('말한 구간에 녹취 화자 번호·바꾼 이름을 붙이고, 녹취가 8초 넘게 비는 말한 구간을 찾는다', () => {
    write('diarization.json', {
      segments: [
        { start: 0, end: 10, speaker: 'SPEAKER_00' },
        { start: 10, end: 40, speaker: 'SPEAKER_01' },
        { start: 40, end: 45, speaker: 'SPEAKER_02' }, // 녹취 줄이 없는 화자 → 번호가 없어 뺀다
      ],
    });
    write('segments.json', {
      segments: [
        { start: 1, end: 9, text: '안녕하세요', track: 'mic' },
        { start: 11, end: 15, text: '네', track: 'mic' },
        { start: 36, end: 39, text: '끝으로', track: 'mic' },
        { start: 20, end: 30, text: '다른 트랙', track: 'system' },
      ],
    });
    write('meta.json', { speakerNames: { '화자 2': '기록자' } });
    expect(speakerTurns(dir)).toEqual({
      turns: [
        { start: 0, end: 10, who: '화자 1' },
        { start: 10, end: 40, who: '기록자' },
      ],
      missing: [{ start: 16, end: 35 }], // 40~45초도 녹취가 없지만 8초가 안 된다
    });
  });
});

describe('labelRedoLines', () => {
  it('마이크 트랙은 기존 녹취로 만든 번호 표를 이어 쓴다', () => {
    write('diarization.json', { segments: [{ start: 0, end: 10, speaker: 'B' }, { start: 10, end: 20, speaker: 'A' }] });
    write('segments.json', { segments: [{ start: 1, end: 3, text: '먼저', track: 'mic' }, { start: 12, end: 14, text: '다음', track: 'mic' }] });
    const lines = labelRedoLines(dir, [{ start: 11, end: 13, text: '새 줄' }], 'mic', ['mic']);
    expect(lines).toEqual([{ start: 11, end: 13, text: '새 줄', track: 'mic', label: '화자 2' }]);
  });
  it('화자 구분이 없으면 두 트랙 녹음만 나·상대방으로', () => {
    expect(labelRedoLines(dir, [{ start: 1, end: 2, text: '말' }], 'system', ['mic', 'system'])[0]!.label).toBe('상대방');
    expect(labelRedoLines(dir, [{ start: 1, end: 2, text: '말' }], 'mic', ['mic'])[0]!.label).toBeNull();
  });
});

describe('diarizeAvailable', () => {
  it('앱 데이터의 파이썬 환경이 있어야 한다 (스크립트는 개발 중엔 저장소의 native/diarize.py, 설치본은 resources)', () => {
    fakeDeps(dir);
    expect(diarizeAvailable()).toBe(false);
    fs.mkdirSync(path.join(dir, 'diarize-env', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'diarize-env', 'bin', 'python'), '');
    expect(diarizeAvailable()).toBe(true);
    configure({ isPackaged: () => true, resourcesPath: () => path.join(dir, 'res') });
    expect(diarizeAvailable()).toBe(false);
    fs.mkdirSync(path.join(dir, 'res'));
    fs.writeFileSync(path.join(dir, 'res', 'diarize.py'), '');
    expect(diarizeAvailable()).toBe(true);
  });
});
