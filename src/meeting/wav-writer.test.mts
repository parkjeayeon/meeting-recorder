import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpDir } from '../test/meeting.mjs';
import { WavWriter } from './wav-writer.mjs';

let root = '';
afterEach(() => {
  vi.restoreAllMocks();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});
// 파일 머리에 적힌 길이 (RIFF 크기, data 크기)와 형식
const head = (file: string) => {
  const b = fs.readFileSync(file);
  return { riff: b.readUInt32LE(4), data: b.readUInt32LE(40), size: b.length, rate: b.readUInt32LE(24), channels: b.readUInt16LE(22), byteRate: b.readUInt32LE(28), align: b.readUInt16LE(32), tags: [b.toString('ascii', 0, 4), b.toString('ascii', 8, 16), b.toString('ascii', 36, 40)] };
};

describe('WavWriter', () => {
  it('열자마자 빈 머리, 쓴 소리는 16bit로 (넘친 값은 -1..1로 자름)', () => {
    root = tmpDir('mr-wav-');
    const file = path.join(root, 'mic.wav');
    const w = new WavWriter(file, { sampleRate: 48000 });
    expect(head(file)).toEqual({ riff: 36, data: 0, size: 44, rate: 48000, channels: 1, byteRate: 96000, align: 2, tags: ['RIFF', 'WAVEfmt ', 'data'] });
    w.append(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    w.close();
    const b = fs.readFileSync(file);
    expect([0, 1, 2, 3, 4, 5].map((i) => b.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
    expect(head(file)).toMatchObject({ riff: 36 + 12, data: 12, size: 56 });
  });

  it('머리는 5초가 넘게 지났을 때만 다시 쓰고, 닫을 때 마지막으로 쓴다 (앱이 죽어도 그때까지는 재생된다)', () => {
    root = tmpDir('mr-wav-');
    const file = path.join(root, 'sys.wav');
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const w = new WavWriter(file, { sampleRate: 16000, channels: 2 });
    const chunk = new Float32Array(100);
    w.append(chunk);
    expect(head(file).data).toBe(0); // 바로는 안 쓴다
    now += 5000;
    w.append(chunk);
    expect(head(file).data).toBe(0); // 딱 5초는 아직
    now += 1;
    w.append(chunk);
    expect(head(file)).toMatchObject({ data: 600, riff: 636, channels: 2, byteRate: 64000, align: 4 });
    now += 3000;
    w.append(chunk);
    expect(head(file).data).toBe(600); // 마지막으로 쓴 때부터 다시 센다
    expect(w.durationSec).toBeCloseTo(800 / (16000 * 2 * 2));
    w.close();
    expect(head(file)).toMatchObject({ data: 800, riff: 836, size: 844 });
  });
});
