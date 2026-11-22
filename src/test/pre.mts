// 녹음 중 미리 받아쓰기 시험용 (결정 83): WavWriter용 float 바꾸기, 내용으로만 결과를 정하는 가짜 회의용 서버. 실제 whisper-server·사용자 폴더는 쓰지 않는다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { configure, type DedicatedServer } from '../meeting/deps.mjs';
import type { Segment } from '../meeting/transcript.mjs';
import { fakeDeps, sleep, type Fakes } from './meeting.mjs';

// 16bit 값 → WavWriter가 그대로 되돌려 쓰는 float (음수는 /32768, 양수는 /32767)
export const toFloat = (pcm: Int16Array): Float32Array => Float32Array.from(pcm, (v) => (v < 0 ? v / 32768 : v / 32767));
export const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

export interface Call {
  hash: string; // 받은 파일 내용의 sha256
  redo: boolean;
  language: string | undefined;
  port: number | null | undefined;
}

// 가짜 회의용 서버: 결과는 파일 내용으로만 정한다(이름과 상관없이). 내용 해시의 첫 글자가 홀수면 같은 문장 반복 → 다시 받아쓰기가 돈다.
// gate가 있으면 그 약속이 풀릴 때까지 기다린다. 서버를 끄면 받는 중인 요청은 실패한다(fetch가 끊기듯)
export function fakeServer(userData: string, opts: { start?: (k: number) => 'ok' | 'fail' | 'null'; fail?: (k: number) => boolean; gate?: () => Promise<void> } = {}) {
  const f: Fakes = fakeDeps(userData);
  const calls: Call[] = [];
  const started: number[] = [];
  const stopped: number[] = [];
  const logs: unknown[][] = [];
  const pending = new Map<number, Set<(e: Error) => void>>();
  configure({
    startDedicatedServer: async () => {
      const k = started.length;
      const port = 6000 + k;
      started.push(port);
      const mode = opts.start?.(k) ?? 'ok';
      if (mode === 'fail') throw new Error('회의용 음성 인식 모델을 불러오지 못했습니다');
      if (mode === 'null') return null;
      const server: DedicatedServer = {
        port,
        stop: () => {
          stopped.push(port);
          for (const rej of pending.get(port) ?? []) rej(new Error('fetch failed'));
        },
        onProgress: () => {},
      };
      return server;
    },
    transcribeSegments: async (file, asr, port) => {
      const hash = sha(fs.readFileSync(file));
      const redo = file.endsWith('.redo.wav');
      const k = calls.length;
      calls.push({ hash, redo, language: asr.language, port });
      if (opts.gate && !redo) {
        const key = port ?? -1;
        let rej: (e: Error) => void = () => {};
        const killed = new Promise<never>((_r, j) => (rej = j));
        if (!pending.has(key)) pending.set(key, new Set());
        pending.get(key)?.add(rej);
        try {
          await Promise.race([opts.gate(), killed]);
        } finally {
          pending.get(key)?.delete(rej);
        }
      }
      await sleep(1);
      if (opts.fail?.(k)) throw new Error('Whisper 오류 (HTTP 500)');
      return segsFor(hash, redo);
    },
  });
  return { f, calls, started, stopped, logs, log: (...a: unknown[]) => void logs.push(a) };
}

export function segsFor(hash: string, redo: boolean): Segment[] {
  if (redo) return [{ start: 0.5, end: 3.25, text: `다시 받은 말 ${hash.slice(0, 6)}` }];
  if (parseInt(hash[0] ?? '0', 16) % 2)
    return [
      { start: 0, end: 4, text: `시작 ${hash.slice(0, 6)}` },
      ...[4, 9, 14, 19].map((s) => ({ start: s, end: s + 5, text: '다음 주까지 정리해 주세요' })),
      { start: 24, end: 27.5, text: `끝 ${hash.slice(0, 6)}` },
    ];
  return [{ start: 1.125, end: 3.5, text: `조각 ${hash.slice(0, 6)}` }];
}

export const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

// 조각마다 내용이 다른 지어낸 녹음 (noise()는 1분마다 같은 무늬라 조각 바이트가 겹친다): 흩어진 큰 소리, [a, b)초는 무음
export function speech(rate: number, sec: number, quiet: [number, number][] = [], seed = 7): Int16Array {
  let x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pcm = Int16Array.from({ length: Math.round(rate * sec) }, () => Math.round((rnd() - 0.5) * 20000) || 1);
  for (const [a, b] of quiet) pcm.fill(0, Math.round(a * rate), Math.round(b * rate));
  return pcm;
}
