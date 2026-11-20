import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { noise, readJson, tmpDir, wavFile } from '../test/meeting.mjs';
import { audioInfo, BITRATE, compressMeeting, declineCompress } from './compress.mjs';

let root = '';
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
// 회의 폴더: mic.wav + meta.json (sampleRate·durationSec는 시험마다)
function meeting(rate: number, sec: number, meta: Record<string, unknown> = {}) {
  root = tmpDir('mr-compress-test-');
  const dir = path.join(root, 'm');
  fs.mkdirSync(dir);
  wavFile(path.join(dir, 'mic.wav'), rate, noise(rate, sec));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mode: 'meeting', sampleRate: rate, files: { mic: { file: 'mic.wav', durationSec: sec } }, ...meta }));
  return dir;
}

describe('audioInfo', () => {
  it('크기는 트랙 파일을 더하고, 짐작은 96kbps × 길이 × 1.01', () => {
    const dir = meeting(48000, 2);
    const info = audioInfo(dir, readJson(dir, 'meta.json'));
    expect(info).toEqual({ bytes: 44 + 48000 * 2 * 2, wav: true, supported: true, compressed: false, estimate: Math.round(2 * (BITRATE / 8) * 1.01), declined: false });
  });

  it('32kHz 미만은 압축 대상이 아니다, 표본율이 없으면 48kHz로 본다, 없는 파일은 0바이트', () => {
    expect(audioInfo('/없는/폴더', { sampleRate: 16000, files: { mic: { file: 'mic.wav' } } })).toMatchObject({ supported: false, bytes: 0, estimate: 0 });
    expect(audioInfo('/없는/폴더', { sampleRate: 32000, files: {} })).toMatchObject({ supported: true, wav: false });
    expect(audioInfo('/없는/폴더', { files: { mic: { file: 'mic.m4a' } }, compressed: { at: 'x' }, compressDeclined: true })).toMatchObject({ supported: true, wav: false, compressed: true, declined: true });
    // WAV가 남아 있으면 압축했다는 표시가 있어도 압축 안 된 것으로
    expect(audioInfo('/없는/폴더', { files: { mic: { file: 'mic.wav' } }, compressed: { at: 'x' } }).compressed).toBe(false);
  });
});

describe('compressMeeting', () => {
  it('16kHz 녹음은 바꾸지 않고 멈춘다 (afconvert를 부르기 전)', async () => {
    const dir = meeting(16000, 1);
    await expect(compressMeeting(dir)).rejects.toThrow('표본율이 낮은 녹음(16000Hz)은 압축하지 않습니다');
    expect(fs.readdirSync(dir).sort()).toEqual(['meta.json', 'mic.wav']);
  });

  it('녹음 파일이 없으면 알린다', async () => {
    const dir = meeting(48000, 1);
    fs.rmSync(path.join(dir, 'mic.wav'));
    await expect(compressMeeting(dir)).rejects.toThrow('mic 녹음 파일이 없습니다');
  });

  it('지난번에 meta를 고친 뒤 끊겼으면 남은 WAV만 지운다', async () => {
    const dir = meeting(48000, 1, { files: { mic: { file: 'mic.m4a', durationSec: 1 } } });
    await compressMeeting(dir);
    expect(fs.existsSync(path.join(dir, 'mic.wav'))).toBe(false);
  });

  describe.runIf(process.platform === 'darwin' && fs.existsSync('/usr/bin/afconvert'))('실제 afconvert', () => {
    it('길이가 1초 넘게 다르면 원본을 두고 멈춘다 (임시 파일도 지움)', async () => {
      const dir = meeting(48000, 2);
      const meta = readJson(dir, 'meta.json');
      meta.files.mic.durationSec = 3.2;
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
      await expect(compressMeeting(dir)).rejects.toThrow(/압축한 녹음의 길이가 다릅니다 \(2\.0초, 원본 3\.2초\) — 원본은 그대로 두었습니다/);
      expect(fs.readdirSync(dir).sort()).toEqual(['meta.json', 'mic.wav']);
      expect(readJson(dir, 'meta.json').files.mic.file).toBe('mic.wav');
    }, 30000);

    it('맞으면 m4a로 바꾸고 meta에 적은 뒤 WAV를 지운다', async () => {
      const dir = meeting(48000, 2);
      const r = await compressMeeting(dir);
      const meta = readJson(dir, 'meta.json');
      expect(fs.readdirSync(dir).sort()).toEqual(['meta.json', 'mic.m4a']);
      expect(meta.files.mic).toEqual({ file: 'mic.m4a', durationSec: 2 });
      expect(meta.compressed).toMatchObject({ codec: 'aac', bitrate: 96000, beforeBytes: 44 + 48000 * 2 * 2 });
      expect(r.before).toBe(44 + 48000 * 2 * 2);
      expect(r.after).toBeLessThan(r.before / 4);
    }, 30000);
  });
});

describe('declineCompress', () => {
  it('그대로 두기 표시를 달고 뗀다, 다른 meta는 그대로', () => {
    const dir = meeting(48000, 1, { title: 'x' });
    declineCompress(dir);
    expect(readJson(dir, 'meta.json')).toMatchObject({ compressDeclined: true, title: 'x' });
    declineCompress(dir, false);
    expect(readJson(dir, 'meta.json').compressDeclined).toBeUndefined();
    expect(readJson(dir, 'meta.json').title).toBe('x');
  });
});
