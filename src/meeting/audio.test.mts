import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeTo16k, downsampleTo16k, PIECE_SEC, recordedTracks, sliceTo16k, splitAtPauses, to16k, trackPath, wav16k, writeWav } from './audio.mjs';

// 지어낸 소리: 큰 잡음(0이 되지 않는 톱니)과, 그 사이 [a, b)초는 무음
const noise = (rate: number, sec: number, quiet: [number, number][] = []): Int16Array => {
  const pcm = new Int16Array(Math.round(rate * sec));
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 2 ? 1 : -1) * (1000 + (i % 500));
  for (const [a, b] of quiet) pcm.fill(0, Math.round(a * rate), Math.round(b * rate));
  return pcm;
};

// 표준 44바이트 머리의 16bit 모노 WAV
const wavFile = (file: string, rate: number, pcm: Int16Array): void => {
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + body.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(body.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, body]));
};

const header = (file: string) => {
  const h = fs.readFileSync(file).subarray(0, 44);
  return {
    riff: h.toString('ascii', 0, 4),
    riffSize: h.readUInt32LE(4),
    wave: h.toString('ascii', 8, 16),
    fmtSize: h.readUInt32LE(16),
    format: h.readUInt16LE(20),
    channels: h.readUInt16LE(22),
    rate: h.readUInt32LE(24),
    byteRate: h.readUInt32LE(28),
    align: h.readUInt16LE(32),
    bits: h.readUInt16LE(34),
    data: h.toString('ascii', 36, 40),
    dataSize: h.readUInt32LE(40),
  };
};
const samples = (file: string): Int16Array => {
  const b = fs.readFileSync(file);
  return new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
};
// 긴 샘플 배열은 toEqual(원소마다 비교)이 느려 바이트로 비교한다
const same = (a: Int16Array, b: Int16Array): boolean => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

let tmp = '';
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-meeting-audio-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('trackPath · recordedTracks', () => {
  it('meta.json의 files가 정한 파일, 없으면 <트랙>.wav, 파일이 없으면 null', () => {
    fs.writeFileSync(path.join(tmp, 'mic.m4a'), '');
    fs.writeFileSync(path.join(tmp, 'system.wav'), '');
    const meta = { files: { mic: { file: 'mic.m4a' }, system: {}, other: { file: 'other.wav' } } };
    expect(trackPath(tmp, meta, 'mic')).toBe(path.join(tmp, 'mic.m4a'));
    expect(trackPath(tmp, meta, 'system')).toBe(path.join(tmp, 'system.wav'));
    expect(trackPath(tmp, meta, 'other')).toBeNull();
    expect(recordedTracks(tmp, meta)).toEqual(['mic', 'system']);
    expect(recordedTracks(tmp, {})).toEqual([]);
  });
});

describe('writeWav · wav16k', () => {
  it('writeWav: 원본 머리를 본뜨고 크기 칸만 바꾼다', () => {
    const src = path.join(tmp, 'src.wav');
    wavFile(src, 48000, noise(48000, 0.01));
    const out = path.join(tmp, 'part.wav');
    const body = Buffer.from([1, 0, 2, 0, 3, 0]);
    writeWav(out, fs.readFileSync(src), body);
    expect(header(out)).toEqual({ ...header(src), riffSize: 36 + 6, dataSize: 6 });
    expect([...samples(out)]).toEqual([1, 2, 3]);
  });
  it('wav16k: 16kHz 모노 16bit 표준 머리', () => {
    const out = path.join(tmp, 'w.wav');
    wav16k(out, Int16Array.from([5, -5, 7]));
    expect(header(out)).toEqual({ riff: 'RIFF', riffSize: 42, wave: 'WAVEfmt ', fmtSize: 16, format: 1, channels: 1, rate: 16000, byteRate: 32000, align: 2, bits: 16, data: 'data', dataSize: 6 });
    expect(fs.statSync(out).size).toBe(50);
    expect([...samples(out)]).toEqual([5, -5, 7]);
  });
  it('wav16k: 배열의 일부(subarray)만 쓴다', () => {
    const out = path.join(tmp, 'w.wav');
    wav16k(out, Int16Array.from([1, 2, 3, 4]).subarray(1, 3));
    expect([...samples(out)]).toEqual([2, 3]);
  });
});

describe('splitAtPauses', () => {
  const RATE = 16000;
  it('조각 길이마다 앞뒤 5초 안의 가장 조용한 곳에서 자르고, 조각이 빈틈·겹침 없이 전체를 덮는다', () => {
    // 190초, 60초마다 자르게 하고 62초·117초 근처에 1초짜리 무음
    const pcm = noise(RATE, 190, [[62, 63], [117.3, 118.3]]);
    const src = path.join(tmp, 'small.wav');
    wavFile(src, RATE, pcm);
    const pieces = splitAtPauses(src, tmp, 60);
    expect(pieces.map((p) => path.basename(p.file))).toEqual(['.piece-0.wav', '.piece-1.wav', '.piece-2.wav']);
    const [, cut1, cut2] = pieces.map((p) => p.offset);
    expect(pieces[0]!.offset).toBe(0);
    expect(cut1).toBeGreaterThanOrEqual(62);
    expect(cut1! + 0.1).toBeLessThanOrEqual(63);
    expect(cut2).toBeGreaterThanOrEqual(117.3);
    expect(cut2! + 0.1).toBeLessThanOrEqual(118.3);
    // 조각을 이어 붙이면 원본 그대로, 각 조각의 머리는 원본을 본뜬 것
    let at = 0;
    for (const p of pieces) {
      const s = samples(p.file);
      expect(Math.round(p.offset * RATE)).toBe(at);
      expect(same(s, pcm.subarray(at, at + s.length))).toBe(true);
      expect(header(p.file).rate).toBe(RATE);
      expect(header(p.file).dataSize).toBe(s.length * 2);
      at += s.length;
    }
    expect(at).toBe(pcm.length);
  });
  it('마지막 30초 안쪽은 자르지 않는다', () => {
    const src = path.join(tmp, 'small.wav');
    wavFile(src, RATE, noise(RATE, 89, [[60, 61]]));
    expect(splitAtPauses(src, tmp, 60)).toHaveLength(1);
  });
  it('조각 하나보다 짧으면 한 조각 (기본 길이는 PIECE_SEC = 10분)', () => {
    expect(PIECE_SEC).toBe(600);
    const src = path.join(tmp, 'short.wav');
    const pcm = noise(RATE, 3);
    wavFile(src, RATE, pcm);
    const pieces = splitAtPauses(src, tmp);
    expect(pieces).toEqual([{ file: path.join(tmp, '.piece-0.wav'), offset: 0 }]);
    expect(same(samples(pieces[0]!.file), pcm)).toBe(true);
  });
});

describe('sliceTo16k', () => {
  it('48kHz에서 [from, to)초를 3샘플 평균으로 16kHz로 잘라 내고, 작은 소리는 키운다', () => {
    const src = path.join(tmp, 'rec.wav');
    const pcm = new Int16Array(48000 * 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i % 3 === 0 ? 300 : 0; // 평균 100
    wavFile(src, 48000, pcm);
    const out = path.join(tmp, 'cut.wav');
    const r = sliceTo16k(src, 0.5, 1, out);
    expect(r).toEqual({ start: 0.5, gain: 8 }); // 100 → 8배 (최대)
    expect(header(out).rate).toBe(16000);
    const s = samples(out);
    expect(s.length).toBe(8000);
    expect(new Set(s)).toEqual(new Set([800]));
  });
  it('소리가 크면 그대로 (gain 1), 녹음 끝을 넘는 구간은 끝까지만', () => {
    const src = path.join(tmp, 'rec.wav');
    wavFile(src, 16000, Int16Array.from({ length: 16000 }, (_, i) => (i % 2 ? 20000 : -20000)));
    const out = path.join(tmp, 'cut.wav');
    expect(sliceTo16k(src, 0.75, 5, out)).toEqual({ start: 0.75, gain: 1 });
    expect(samples(out).length).toBe(4000);
    expect(samples(out)[0]).toBe(-20000);
  });
  it('녹음 길이를 벗어난 구간은 오류', () => {
    const src = path.join(tmp, 'rec.wav');
    wavFile(src, 16000, new Int16Array(16000));
    expect(() => sliceTo16k(src, 2, 3, path.join(tmp, 'x.wav'))).toThrow('녹음 길이를 벗어난 구간입니다');
    expect(fs.existsSync(path.join(tmp, 'x.wav'))).toBe(false);
  });
});

describe('downsampleTo16k · to16k', () => {
  it('48kHz → 16kHz 3샘플 평균, 머리 칸을 마지막에 채운다', async () => {
    const src = path.join(tmp, 'mic.wav');
    const pcm = Int16Array.from({ length: 48000 * 3 + 2 }, (_, i) => (i % 3) * 30 - 30); // -30, 0, 30 → 평균 0
    pcm[0] = 2970; // 첫 프레임 평균 (2970 + 0 + 30) / 3 = 1000
    wavFile(src, 48000, pcm);
    const out = path.join(tmp, 'mic-16k.wav');
    await to16k(src, out);
    expect(header(out)).toEqual({ riff: 'RIFF', riffSize: 36 + 96000, wave: 'WAVEfmt ', fmtSize: 16, format: 1, channels: 1, rate: 16000, byteRate: 32000, align: 2, bits: 16, data: 'data', dataSize: 96000 });
    const s = samples(out);
    expect(s[0]).toBe(1000);
    expect(new Set(s.subarray(1))).toEqual(new Set([0]));
  });
  it('16kHz는 그대로 옮긴다', async () => {
    const src = path.join(tmp, 'mic.wav');
    const pcm = noise(16000, 0.5);
    wavFile(src, 16000, pcm);
    const out = path.join(tmp, 'mic-16k.wav');
    await downsampleTo16k(src, out);
    expect(same(samples(out), pcm)).toBe(true);
  });
});

// 실제 afconvert로 압축(AAC)했다가 푼다 — macOS에서만
describe.runIf(process.platform === 'darwin' && fs.existsSync('/usr/bin/afconvert'))('decodeTo16k', () => {
  it('압축한 녹음을 44바이트 머리의 16kHz 모노 WAV로 풀고 임시 파일을 지운다', async () => {
    const src = path.join(tmp, 'mic.wav');
    wavFile(src, 48000, Int16Array.from({ length: 48000 * 2 }, (_, i) => Math.round(8000 * Math.sin(i / 20))));
    const m4a = path.join(tmp, 'mic.m4a');
    execFileSync('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', src, m4a]);
    const out = path.join(tmp, 'mic-16k.wav');
    await to16k(m4a, out);
    const h = header(out);
    expect({ ...h, riffSize: 0, dataSize: 0, byteRate: 0 }).toEqual({ riff: 'RIFF', riffSize: 0, wave: 'WAVEfmt ', fmtSize: 16, format: 1, channels: 1, rate: 16000, byteRate: 0, align: 2, bits: 16, data: 'data', dataSize: 0 });
    expect(h.riffSize).toBe(36 + h.dataSize);
    expect(fs.statSync(out).size).toBe(44 + h.dataSize);
    expect(Math.abs(h.dataSize / 32000 - 2)).toBeLessThan(0.1); // 약 2초
    expect(fs.existsSync(`${out}.af.wav`)).toBe(false);
  });
  it('풀 수 없는 파일은 afconvert 오류 첫 줄로', async () => {
    const bad = path.join(tmp, 'bad.m4a');
    fs.writeFileSync(bad, 'not audio');
    await expect(decodeTo16k(bad, path.join(tmp, 'x.wav'))).rejects.toThrow();
  });
});
