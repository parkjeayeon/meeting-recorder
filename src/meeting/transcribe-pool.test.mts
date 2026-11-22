// 조각을 회의용 서버 여럿이 나눠 받기 (결정 82) — 가짜 서버만 쓴다 (실제 whisper-server·사용자 폴더는 건드리지 않는다)
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeDeps, meetingDir, readJson, sleep, tmpDir } from '../test/meeting.mjs';
import { configure, type DedicatedServer } from './deps.mjs';
import { transcribeMeeting, type MeetingMeta } from './transcribe.mjs';
import type { Segment } from './transcript.mjs';

// 조각 1·3은 4~24초가 같은 문장 반복 → 그 조각을 받은 서버로 반복 구간만 다시 받아쓴다
const LOOPING = (n: number): Segment[] => [
  { start: 0, end: 4, text: `${n}번 조각 시작` },
  ...[4, 9, 14, 19].map((s) => ({ start: s, end: s + 5, text: '다음 주까지 정리해 주세요' })),
  { start: 24, end: 27, text: `${n}번 조각 끝` },
];
const plain = (n: number): Segment[] => [
  { start: 1, end: 3, text: `${n}번 조각 첫 줄` },
  { start: 5, end: 8, text: `${n}번 조각 둘째 줄` },
];
const pieceNo = (file: string) => Number(/\.piece-(\d+)\.wav/.exec(file)?.[1]);

interface Call {
  port: number | null;
  piece: number;
  redo: boolean;
}

// 가짜 회의용 서버들: 포트 5000부터. 서버마다 진행률 콜백·동시 요청 수·끈 횟수를 따로 센다
function fakePool(userData: string, opts: { delay?: (piece: number, port: number | null, redo: boolean) => number; start?: (k: number) => 'ok' | 'fail' | 'null'; fail?: number } = {}) {
  const f = fakeDeps(userData);
  const calls: Call[] = [];
  const started: number[] = [];
  const stopped = new Map<number, number>();
  const progressCb = new Map<number, ((p: number) => void) | null>();
  const inFlight = new Map<number | null, number>();
  let mostPerServer = 0;
  let mostOverall = 0;
  let overall = 0;
  configure({
    startDedicatedServer: async () => {
      const k = started.length;
      const port = 5000 + k;
      started.push(port);
      const mode = opts.start?.(k) ?? 'ok';
      if (mode === 'fail') throw new Error('회의용 음성 인식 모델을 불러오지 못했습니다');
      if (mode === 'null') return null;
      const server: DedicatedServer = {
        port,
        stop: () => void stopped.set(port, (stopped.get(port) ?? 0) + 1),
        onProgress: (cb) => void progressCb.set(port, cb),
      };
      return server;
    },
    transcribeSegments: async (file, _asr, port) => {
      const piece = pieceNo(file);
      const redo = file.endsWith('.redo.wav');
      const key = port ?? null;
      calls.push({ port: key, piece, redo });
      const now = (inFlight.get(key) ?? 0) + 1;
      inFlight.set(key, now);
      mostPerServer = Math.max(mostPerServer, now);
      mostOverall = Math.max(mostOverall, ++overall);
      try {
        const cb = key === null ? null : progressCb.get(key);
        if (!redo) cb?.(0.3);
        await sleep(opts.delay?.(piece, key, redo) ?? 1);
        if (!redo) cb?.(0.6);
        if (!redo && piece === opts.fail) throw new Error(`${piece}번 조각 받아쓰기 실패`);
        if (redo) return [{ start: 0.5, end: 4, text: `${piece}번 조각 다시 받은 말` }];
        return piece % 2 ? LOOPING(piece) : plain(piece);
      } finally {
        inFlight.set(key, (inFlight.get(key) ?? 1) - 1);
        overall--;
      }
    },
  });
  return { f, calls, started, stopped, get mostPerServer() { return mostPerServer; }, get mostOverall() { return mostOverall; } };
}

let root = '';
let userData = '';
const savedServers = process.env.MR_MEETING_SERVERS;
beforeEach(() => {
  root = tmpDir('mr-transcribe-pool-');
  userData = path.join(root, 'userData');
  fs.mkdirSync(userData);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (savedServers === undefined) delete process.env.MR_MEETING_SERVERS;
  else process.env.MR_MEETING_SERVERS = savedServers;
});

// 1kHz로 45분, 10분마다 조용한 구간 → 조각 5개
const longMeeting = (name: string) => meetingDir(root, name, { sec: 2700, rate: 1000, quiet: [[598, 602], [1198, 1202], [1798, 1802], [2398, 2402]] });
const run = async (dir: string, servers: number) => {
  process.env.MR_MEETING_SERVERS = String(servers);
  const progress: number[] = [];
  const timing: Record<string, unknown> = {};
  const meta: MeetingMeta = readJson(dir, 'meta.json');
  const settings = { provider: 'auto' as const, language: 'ko', meetingLanguage: 'ko', diarize: false };
  const r = await transcribeMeeting(dir, meta, settings, null, timing, (_s, extra = {}) => progress.push(extra.progress as number));
  return { ...r, progress, timing };
};
// 다시 받아쓰기에 걸린 시간(ms)만 빼면 파일이 바이트까지 같아야 한다
const files = (dir: string) => ({
  segments: fs.readFileSync(path.join(dir, 'segments.json'), 'utf8').replace(/"ms":\d+/g, '"ms":0'),
  transcript: fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8'),
});
const leftovers = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('.'));
const nondecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= (xs[i - 1] ?? x));

describe('transcribeMeeting — 조각을 서버 여럿이 나눠 받기', () => {
  it('조각 5개를 서버 둘이 나눠 받는다: 서버마다 요청은 하나씩, 반복 구간 다시는 그 조각을 받은 서버로, 결과는 서버 하나일 때와 같다', async () => {
    const one = longMeeting('one');
    const p1 = fakePool(userData);
    const r1 = await run(one, 1);
    expect(p1.started).toEqual([5000]);
    expect(r1.timing.servers).toBe(1);
    expect(p1.mostOverall).toBe(1);
    const base = files(one);
    expect(readJson(one, 'segments.json').redo.map((x: { start: number }) => Math.round(x.start))).toEqual([602, 1802]); // 조각 1·3

    // 끝나는 순서를 바꿔 가며: 앞 조각이 느릴 때, 뒤 조각이 느릴 때, 둘째 서버가 느릴 때
    const delays: [string, (piece: number, port: number | null, redo: boolean) => number][] = [
      ['앞 조각이 느림', (piece) => (5 - piece) * 6],
      ['뒤 조각이 느림', (piece) => piece * 6],
      ['둘째 서버가 느림', (_piece, port, redo) => (port === 5001 ? 25 : 2) + (redo ? 5 : 0)],
    ];
    for (const [name, delay] of delays) {
      const dir = longMeeting(`two-${name}`);
      const p = fakePool(userData, { delay });
      const r = await run(dir, 2);
      expect(p.started, name).toEqual([5000, 5001]);
      expect(new Set(p.calls.map((c) => c.port)), name).toEqual(new Set([5000, 5001])); // 둘 다 받았다
      expect(r.timing.servers, name).toBe(2);
      expect(p.mostPerServer, name).toBe(1); // 서버 하나에 요청은 언제나 하나
      expect(p.mostOverall, name).toBe(2);
      expect(p.calls.filter((c) => !c.redo).map((c) => c.piece).sort(), name).toEqual([0, 1, 2, 3, 4]); // 조각마다 한 번씩
      for (const redo of p.calls.filter((c) => c.redo)) {
        const firstPass = p.calls.find((c) => !c.redo && c.piece === redo.piece);
        expect(redo.port, `${name}: ${redo.piece}번 조각 다시 받기`).toBe(firstPass?.port);
      }
      expect(files(dir), name).toEqual(base);
      expect(r.transcript, name).toBe(r1.transcript);
      expect(r.progress[0], name).toBe(0);
      expect(r.progress.at(-1), name).toBe(1);
      expect(r.progress.filter((x) => x === 1).length, name).toBe(1); // 1은 모두 끝났을 때 한 번만
      expect(nondecreasing(r.progress), name).toBe(true);
      expect(p.stopped, name).toEqual(new Map([[5000, 1], [5001, 1]]));
      expect(leftovers(dir), name).toEqual([]);
    }
  });

  it('진행률: 받는 중인 조각들의 진행률을 더해 환산하고, 다시 받아쓰기는 진행률을 움직이지 않는다', async () => {
    const dir = longMeeting('progress');
    fakePool(userData, { delay: (piece, _port, redo) => (redo ? 3 : 4 + piece) });
    const r = await run(dir, 2);
    expect(nondecreasing(r.progress)).toBe(true);
    expect(r.progress.slice(0, -1).every((x) => x < 1)).toBe(true);
    // 두 조각이 함께 30%씩이면 (0.3 + 0.3) / 5 = 0.12
    expect(r.progress).toContain(0.12);
  });

  it('둘째 서버를 못 띄우면 뜬 서버 하나로 끝까지 받는다', async () => {
    for (const mode of ['fail', 'null'] as const) {
      const dir = longMeeting(`second-${mode}`);
      const p = fakePool(userData, { start: (k) => (k === 1 ? mode : 'ok') });
      const r = await run(dir, 2);
      expect(p.started).toEqual([5000, 5001]);
      expect(new Set(p.calls.map((c) => c.port))).toEqual(new Set([5000]));
      expect(r.timing.servers).toBe(1);
      expect(r.timing.model).toBe('large-v3');
      expect(r.progress.at(-1)).toBe(1);
      expect(readJson(dir, 'segments.json').segments).toHaveLength(3 * 2 + 2 * 3); // 보통 조각은 두 줄, 반복 조각은 앞·다시 받은 말·끝 세 줄
      expect(leftovers(dir)).toEqual([]);
    }
  });

  it('한 조각이 실패하면 실패로 돌려주고, 띄운 서버는 모두 끄고 임시 파일도 지운다', async () => {
    const dir = longMeeting('fail');
    const p = fakePool(userData, { fail: 2, delay: (piece) => (piece === 2 ? 3 : 10) });
    await expect(run(dir, 2)).rejects.toThrow('2번 조각 받아쓰기 실패');
    expect(p.started).toEqual([5000, 5001]);
    expect([...p.stopped.keys()].sort()).toEqual([5000, 5001]);
    expect(p.calls.some((c) => c.piece === 4)).toBe(false); // 실패한 뒤로는 새 조각을 가져가지 않는다
    expect(leftovers(dir)).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'segments.json'))).toBe(false);
  });

  it('조각이 하나면 서버를 하나만 띄운다 (스위치로 넷을 줘도)', async () => {
    const dir = meetingDir(root, 'short');
    const p = fakePool(userData);
    const r = await run(dir, 4);
    expect(p.started).toEqual([5000]);
    expect(r.timing.servers).toBe(1);
    expect(p.stopped).toEqual(new Map([[5000, 1]]));
  });

  it('회의용 서버를 하나도 못 띄우면 예전처럼 받아쓰기용 서버로 차례로 받는다', async () => {
    const dir = longMeeting('fallback');
    const p = fakePool(userData, { start: () => 'null', delay: (piece) => (5 - piece) * 3 });
    const r = await run(dir, 2);
    expect(p.started).toEqual([5000]); // 더 띄우려 하지 않는다
    expect(p.calls.map((c) => [c.piece, c.redo, c.port])).toEqual([
      [0, false, null],
      [1, false, null],
      [1, true, null],
      [2, false, null],
      [3, false, null],
      [3, true, null],
      [4, false, null],
    ]);
    expect(p.mostOverall).toBe(1);
    expect(r.timing.model).toBe('large-v3-turbo');
    expect(r.timing.servers).toBe(1);
    expect(r.progress).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]); // 서버가 없으면 조각 안 진행률도 없다
    expect(leftovers(dir)).toEqual([]);
  });
});
