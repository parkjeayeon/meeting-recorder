// 회의 녹음 소리 다루기: 트랙 파일 찾기, 16kHz 모노 WAV로 줄이기·풀기, 조용한 지점에서 조각 내기, 구간 잘라 내기.
// Electron 없이 돈다. 본체(CommonJS)는 src/minutes.js가 require('../lib/meeting/index.mjs')로 불러 쓴다 (결정 70).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PIECE_SEC = 600; // 긴 녹음은 약 10분씩, 조용한 지점에서 잘라 녹취한다

// meta.json 중 여기서 읽는 부분 (트랙 이름 → 파일)
export interface TrackMeta {
  files?: Record<string, { file?: string } | undefined>;
}

// 트랙의 녹음 파일 (압축했으면 .m4a, 아니면 .wav — meta.json의 files가 정한다). 없으면 null
export function trackPath(dir: string, meta: TrackMeta, track: string): string | null {
  const file = path.join(dir, meta.files?.[track]?.file ?? `${track}.wav`);
  return fs.existsSync(file) ? file : null;
}
export const recordedTracks = (dir: string, meta: TrackMeta): string[] => Object.keys(meta.files ?? {}).filter((t) => trackPath(dir, meta, t));

// 압축한 녹음(AAC .m4a)을 16kHz 모노 WAV(44바이트 머리, 아래 함수들이 읽는 형식)로 푼다. 2시간에 약 1초
export async function decodeTo16k(src: string, dst: string): Promise<void> {
  const tmp = `${dst}.af.wav`;
  await new Promise<void>((resolve, reject) => execFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', src, tmp], (err, _o, stderr) => (err ? reject(new Error((stderr || err.message).trim().split('\n')[0])) : resolve())));
  // afconvert는 확장 WAV 머리(FLLR 등 덧붙은 칸)를 쓴다 → data 칸만 꺼내 표준 44바이트 머리로 다시 쓴다
  const fd = fs.openSync(tmp, 'r');
  let offset = 12;
  let size = 0;
  try {
    const total = fs.fstatSync(fd).size;
    const h8 = Buffer.alloc(8);
    while (offset + 8 <= total) {
      fs.readSync(fd, h8, 0, 8, offset);
      const id = h8.toString('ascii', 0, 4);
      const len = h8.readUInt32LE(4);
      if (id === 'data') {
        size = Math.min(len, total - offset - 8);
        offset += 8;
        break;
      }
      offset += 8 + len + (len & 1);
    }
  } finally {
    fs.closeSync(fd);
  }
  if (!size) throw new Error('압축한 녹음을 풀지 못했습니다');
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + size, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(size, 40);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(dst);
    out.on('error', reject).on('finish', resolve);
    out.write(head);
    fs.createReadStream(tmp, { start: offset, end: offset + size - 1 }).on('error', reject).pipe(out);
  });
  fs.rmSync(tmp, { force: true });
}

// 녹음 → 16kHz 모노 WAV: 원본 WAV는 줄이고, 압축한 녹음은 푼다
export const to16k = (src: string, dst: string): Promise<void> => (/\.wav$/i.test(src) ? downsampleTo16k(src, dst) : decodeTo16k(src, dst));

// 48kHz 16bit 모노 WAV(WavWriter 형식)를 16kHz로 줄인다. 3샘플 평균이라 말소리 대역엔 충분하다.
// 1시간 회의 기준 345MB → 115MB라 Whisper에 넘기는 시간과 메모리가 줄어든다.
export async function downsampleTo16k(src: string, dst: string): Promise<void> {
  const header = Buffer.alloc(44);
  const fd = fs.openSync(src, 'r');
  fs.readSync(fd, header, 0, 44, 0);
  fs.closeSync(fd);
  const rate = header.readUInt32LE(24);
  const factor = Math.max(1, Math.round(rate / 16000));
  const out = fs.createWriteStream(dst);
  out.write(Buffer.alloc(44)); // 헤더는 마지막에 채운다
  let carry: Buffer = Buffer.alloc(0);
  let written = 0;
  for await (const chunk of fs.createReadStream(src, { start: 44 }) as AsyncIterable<Buffer>) {
    const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const frames = Math.floor(buf.length / (2 * factor));
    const outBuf = Buffer.alloc(frames * 2);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let k = 0; k < factor; k++) sum += buf.readInt16LE((i * factor + k) * 2);
      outBuf.writeInt16LE(Math.round(sum / factor), i * 2);
    }
    carry = buf.subarray(frames * factor * 2);
    written += outBuf.length;
    if (!out.write(outBuf)) await new Promise<void>((r) => out.once('drain', r));
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + written, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate / factor, 24);
  h.writeUInt32LE((rate / factor) * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(written, 40);
  const wfd = fs.openSync(dst, 'r+');
  fs.writeSync(wfd, h, 0, 44, 0);
  fs.closeSync(wfd);
}

export interface Piece {
  file: string;
  offset: number; // 초
}

// 16kHz WAV를 약 pieceSec(기본 PIECE_SEC)마다 가장 조용한 지점(앞뒤 5초 안)에서 잘라 조각 파일로 만든다
// pieceSec는 단위 시험이 짧은 녹음으로 돌려 보려고 받는다 — 본체는 넘기지 않는다
export function splitAtPauses(wavPath: string, outDir: string, pieceSec: number = PIECE_SEC): Piece[] {
  const buf = fs.readFileSync(wavPath);
  const rate = buf.readUInt32LE(24);
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, Math.floor((buf.length - 44) / 2));
  const win = Math.round(rate * 0.1);
  const energyAt = (i: number): number => {
    let e = 0;
    for (let k = i; k < Math.min(i + win, pcm.length); k++) e += Math.abs(pcm[k]!);
    return e;
  };
  const cuts = [0];
  for (let target = pieceSec * rate; target < pcm.length - 30 * rate; target += pieceSec * rate) {
    let best = target;
    let bestE = Infinity;
    for (let i = target - 5 * rate; i <= target + 5 * rate; i += win) {
      const e = energyAt(i);
      if (e < bestE) [best, bestE] = [i, e];
    }
    cuts.push(best);
  }
  cuts.push(pcm.length);
  const pieces: Piece[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const file = path.join(outDir, `.piece-${i}.wav`);
    const [a, b] = [cuts[i]!, cuts[i + 1]!];
    writeWav(file, buf, Buffer.from(pcm.buffer, pcm.byteOffset + a * 2, (b - a) * 2));
    pieces.push({ file, offset: a / rate });
  }
  return pieces;
}

// 원본 WAV의 헤더를 본떠 PCM 일부를 새 파일로 쓴다
export function writeWav(file: string, src: Buffer, body: Buffer): void {
  const h = Buffer.from(src.subarray(0, 44));
  h.writeUInt32LE(36 + body.length, 4);
  h.writeUInt32LE(body.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, body]));
}

// 16kHz 모노 16bit PCM을 표준 44바이트 머리를 붙여 쓴다
export function wav16k(file: string, pcm: Int16Array): void {
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + body.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(body.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, body]));
}

// 녹음에서 [from, to)초를 16kHz로 잘라 낸다. 가장 큰 소리가 작으면(목소리가 멀거나 작음) 최대 8배까지 키운다
export function sliceTo16k(wavPath: string, from: number, to: number, out: string): { start: number; gain: number } {
  const fd = fs.openSync(wavPath, 'r');
  try {
    const head = Buffer.alloc(44);
    fs.readSync(fd, head, 0, 44, 0);
    const rate = head.readUInt32LE(24);
    const factor = Math.max(1, Math.round(rate / 16000));
    const total = (fs.fstatSync(fd).size - 44) / 2;
    const a = Math.max(0, Math.floor(from * rate));
    const b = Math.min(total, Math.ceil(to * rate));
    if (b <= a) throw new Error('녹음 길이를 벗어난 구간입니다');
    const raw = Buffer.alloc((b - a) * 2);
    fs.readSync(fd, raw, 0, raw.length, 44 + a * 2);
    const n = Math.floor((b - a) / factor);
    const pcm = new Int16Array(n);
    let peak = 1;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < factor; k++) sum += raw.readInt16LE((i * factor + k) * 2);
      pcm[i] = Math.round(sum / factor);
      peak = Math.max(peak, Math.abs(pcm[i]!));
    }
    const gain = Math.min(8, Math.max(1, (0.5 * 32767) / peak));
    if (gain > 1.05) for (let i = 0; i < n; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i]! * gain)));
    wav16k(out, pcm);
    return { start: a / rate, gain: Number(gain.toFixed(2)) };
  } finally {
    fs.closeSync(fd);
  }
}
