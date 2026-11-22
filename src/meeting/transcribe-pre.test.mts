// 회의가 끝난 뒤의 녹취가 녹음 중에 미리 받아 둔 조각을 다시 쓴다 (결정 83) — 녹음기(WavWriter)처럼 키운 녹음, 가짜 회의용 서버만
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { echoComplete, readJson, sleep, tmpDir } from '../test/meeting.mjs';
import { deferred, fakeServer, speech, toFloat, type Call } from '../test/pre.mjs';
import { configure } from './deps.mjs';
import { makeMinutes } from './pipeline.mjs';
import { preDir } from './piece-cache.mjs';
import { createPretranscriber } from './pretranscribe.mjs';
import { MEETING_MODEL, transcribeMeeting, type MeetingMeta } from './transcribe.mjs';
import { WavWriter } from './wav-writer.mjs';

const RATE = 1000; // 1kHz (16kHz로 줄이지 않는다). 조각 길이는 본체 그대로 600초
const SEC = 2700; // 45분 → 조각 5개, 녹음 중에 굳는 것은 4개
const QUIET: [number, number][] = [[598, 602], [1198, 1202], [1798, 1802], [2398, 2402]];

let root = '';
let userData = '';
const savedServers = process.env.MR_MEETING_SERVERS;
beforeEach(() => {
  root = tmpDir('mr-transcribe-pre-');
  userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'models', MEETING_MODEL), 'fake model');
  process.env.MR_MEETING_SERVERS = '2'; // 남은 조각이 하나면 서버 하나만 띄우는지 보려고
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  if (savedServers === undefined) delete process.env.MR_MEETING_SERVERS;
  else process.env.MR_MEETING_SERVERS = savedServers;
});

const META = (sec: number) => ({ mode: 'meeting', startedAt: '2026-11-22T01:00:00.000Z', files: { mic: { file: 'mic.wav', durationSec: sec } } });

// 녹음기처럼 60초씩 키우며 찌르고, 멈추면(finish) meta.json을 쓴다. 미리 받아쓴 첫 받아쓰기 요청을 돌려준다
async function recordWithPre(dir: string, server: ReturnType<typeof fakeServer>): Promise<Call[]> {
  fs.mkdirSync(dir, { recursive: true });
  const pcm = speech(RATE, SEC, QUIET);
  const w = new WavWriter(path.join(dir, 'mic.wav'), { sampleRate: RATE });
  const pre = createPretranscriber({ dir, tracks: ['mic'], log: server.log });
  for (let at = 0; at < pcm.length; at += 60 * RATE) {
    w.append(toFloat(pcm.subarray(at, Math.min(pcm.length, at + 60 * RATE))));
    await pre.poke();
  }
  w.close();
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(META(SEC)));
  await pre.finish();
  expect(server.logs).toEqual([]);
  return server.calls.splice(0);
}

// 미리 받아쓰지 않은 같은 녹음 (비교 기준)
function recordPlain(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const w = new WavWriter(path.join(dir, 'mic.wav'), { sampleRate: RATE });
  w.append(toFloat(speech(RATE, SEC, QUIET)));
  w.close();
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(META(SEC)));
}

async function run(dir: string, settings: ReturnType<typeof fakeServer>['f']['settings']) {
  const progress: number[] = [];
  const timing: Record<string, unknown> = {};
  const meta: MeetingMeta = readJson(dir, 'meta.json');
  const r = await transcribeMeeting(dir, meta, settings, null, timing, (_s, extra = {}) => progress.push(extra.progress as number));
  return { ...r, progress, timing };
}

// 다시 받아쓰기에 걸린 시간(ms)만 빼면 같아야 한다
const files = (dir: string) => ({
  segments: fs.readFileSync(path.join(dir, 'segments.json'), 'utf8').replace(/"ms":\d+/g, '"ms":0'),
  transcript: fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8'),
  diarization: fs.existsSync(path.join(dir, 'diarization.json')),
});
const hidden = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('.'));
const first = (calls: Call[]) => calls.filter((c) => !c.redo);

describe('transcribeMeeting — 녹음 중에 미리 받아 둔 조각 다시 쓰기', () => {
  it('미리 받은 조각은 서버에 보내지 않고, 남은 조각(마지막)만 받는다 — 만든 파일은 미리 받지 않은 것과 같다', async () => {
    const cold = path.join(root, 'cold');
    recordPlain(cold);
    const c = fakeServer(userData);
    const base = await run(cold, c.f.settings);
    expect(first(c.calls)).toHaveLength(5);
    expect(base.timing.pre).toEqual({ reused: 0, total: 5 });
    const coldFirst = first(c.calls).map((x) => x.hash);
    expect(c.calls.some((x) => x.redo)).toBe(true); // 반복 구간 다시 받아쓰기도 들어 있는 녹음이다

    const warm = path.join(root, 'warm');
    const w = fakeServer(userData);
    const live = await recordWithPre(warm, w);
    expect(first(live).map((x) => x.hash)).toEqual(coldFirst.slice(0, 4)); // 녹음 중에 앞 조각 넷 (같은 바이트)
    expect(fs.readdirSync(preDir(warm))).toHaveLength(4);
    w.started.length = 0;
    const r = await run(warm, w.f.settings);
    expect(first(w.calls).map((x) => x.hash)).toEqual(coldFirst.slice(4)); // 마지막 조각만
    expect(w.started).toHaveLength(1); // 남은 조각이 하나라 서버도 하나 (스위치로 둘을 줘도)
    expect(r.timing.pre).toEqual({ reused: 4, total: 5 });
    expect(r.timing.servers).toBe(1);
    expect(files(warm)).toEqual(files(cold));
    expect(r.transcript).toBe(base.transcript);
    expect(r.diarizeInfo).toEqual(base.diarizeInfo);
    expect(r.progress[0]).toBe(0);
    expect(r.progress[1]).toBe(0.8); // 미리 받은 넷은 처음부터 끝난 것으로
    expect(r.progress.at(-1)).toBe(1);
    expect(hidden(warm)).toEqual([]); // .pre는 녹취가 끝나면 지운다, 조각·16kHz 임시 파일도 없다
  });

  it('녹음이 끝난 뒤에 언어를 바꾸면 열쇠가 달라 모두 못 찾고 예전처럼 다 받는다', async () => {
    const dir = path.join(root, 'lang');
    const s = fakeServer(userData);
    await recordWithPre(dir, s);
    const r = await run(dir, { ...s.f.settings, meetingLanguage: 'ja' });
    expect(r.timing.pre).toEqual({ reused: 0, total: 5 });
    expect(first(s.calls)).toHaveLength(5);
    expect(s.calls.every((c) => c.language === 'ja')).toBe(true);
    expect(hidden(dir)).toEqual([]);
  });

  it('보관 파일이 깨졌으면 그 조각만 다시 받고, 결과는 같다', async () => {
    const cold = path.join(root, 'cold');
    recordPlain(cold);
    await run(cold, fakeServer(userData).f.settings);
    const dir = path.join(root, 'corrupt');
    const s = fakeServer(userData);
    await recordWithPre(dir, s);
    const [a = '', b = ''] = fs.readdirSync(preDir(dir)).sort();
    fs.writeFileSync(path.join(preDir(dir), a), '{"segs": [');
    fs.writeFileSync(path.join(preDir(dir), b), JSON.stringify({ segs: [{ start: 0, end: 1 }], redone: [] }));
    const r = await run(dir, s.f.settings);
    expect(r.timing.pre).toEqual({ reused: 2, total: 5 });
    expect(first(s.calls)).toHaveLength(3);
    expect(files(dir)).toEqual(files(cold));
  });

  it('녹취가 실패하면 .pre를 남겨 다시 만들 때 쓴다', async () => {
    const dir = path.join(root, 'fail');
    const pre = fakeServer(userData); // 녹음 중에는 잘 된다
    await recordWithPre(dir, pre);
    const failing = fakeServer(userData, { fail: () => true });
    await expect(run(dir, failing.f.settings)).rejects.toThrow('Whisper 오류');
    expect(fs.readdirSync(preDir(dir))).toHaveLength(4);
    expect(hidden(dir)).toEqual(['.pre']); // 조각·16kHz 임시 파일은 지웠다
    const again = fakeServer(userData);
    const r = await run(dir, again.f.settings);
    expect(r.timing.pre).toEqual({ reused: 4, total: 5 });
    expect(first(again.calls)).toHaveLength(1);
    expect(hidden(dir)).toEqual([]);
  });

  it('회의용 서버를 못 띄우면(받아쓰기용 turbo로 받음) 미리 받은 것을 찾지 않는다', async () => {
    const dir = path.join(root, 'turbo');
    const s = fakeServer(userData);
    await recordWithPre(dir, s);
    const t = fakeServer(userData, { start: () => 'null' });
    const r = await run(dir, t.f.settings);
    expect(r.timing.model).toBe('large-v3-turbo');
    expect(r.timing.pre).toEqual({ reused: 0, total: 5 });
    expect(first(t.calls)).toHaveLength(5);
    expect(first(t.calls).every((c) => c.port === null)).toBe(true);
  });
});

describe('makeMinutes — after', () => {
  it('상태는 바로 queued, 녹취는 after가 끝난 뒤에 시작한다 (after가 실패해도)', async () => {
    for (const fail of [false, true]) {
      const dir = path.join(root, `after-${fail}`);
      recordPlain(dir);
      const s = fakeServer(userData);
      configure({ complete: echoComplete });
      const gate = deferred();
      const after = fail ? gate.promise.then(() => Promise.reject(new Error('x'))) : gate.promise;
      const seen: string[] = [];
      const job = makeMinutes(dir, { after, onStage: (st) => void seen.push(st.status) });
      expect(readJson(dir, 'minutes.json').status).toBe('queued');
      expect(seen).toEqual(['queued']);
      await sleep(20);
      expect(s.calls).toEqual([]);
      expect(seen).toEqual(['queued']);
      gate.resolve();
      await job;
      expect(first(s.calls)).toHaveLength(5);
      expect(readJson(dir, 'minutes.json').status).toBe('done');
    }
  });
});
