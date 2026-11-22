// 녹음 중 미리 받아쓰기 (결정 83) — WavWriter로 키우는 지어낸 녹음과 가짜 회의용 서버만 쓴다 (실제 whisper-server·사용자 폴더는 건드리지 않는다)
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noise, sleep, tmpDir } from '../test/meeting.mjs';
import { deferred, fakeServer, sha, speech, toFloat, type Call } from '../test/pre.mjs';
import { cutTargets, splitAtPauses, to16k } from './audio.mjs';
import { configure, type DedicatedServer } from './deps.mjs';
import { getPiece, pieceKey, preDir } from './piece-cache.mjs';
import { createPretranscriber, MAX_FAILURES, snapshotWav } from './pretranscribe.mjs';
import { MEETING_MODEL, pieceContext } from './transcribe.mjs';
import { WavWriter } from './wav-writer.mjs';

const RATE = 1000; // 1kHz라 16kHz로 줄이지 않는다 (factor 1) — 48kHz는 아래 '앞부분 성질'에서
const PIECE = 60; // 시험용 조각 길이 (본체는 600초). 끝 30초 규칙은 그대로
const SEC = 330;
const QUIET: [number, number][] = [[59, 61], [119, 121], [179, 181], [239, 241], [299, 301]];

let root = '';
let userData = '';
let dir = '';
beforeEach(() => {
  root = tmpDir('mr-pretranscribe-');
  userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(userData, 'models'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'models', MEETING_MODEL), 'fake model');
  dir = path.join(root, '2026-11-22_10-00-00_meeting');
  fs.mkdirSync(dir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// 녹음기처럼 mic.wav를 키운다
function recorder(sec = SEC, quiet = QUIET) {
  const pcm = speech(RATE, sec, quiet);
  const w = new WavWriter(path.join(dir, 'mic.wav'), { sampleRate: RATE });
  let at = 0;
  return {
    pcm,
    w,
    growTo(s: number) {
      const to = Math.min(pcm.length, Math.round(s * RATE));
      if (to > at) w.append(toFloat(pcm.subarray(at, to)));
      at = Math.max(at, to);
    },
  };
}

const first = (calls: Call[]) => calls.filter((c) => !c.redo);
const preFiles = () => (fs.existsSync(preDir(dir)) ? fs.readdirSync(preDir(dir)).sort() : []);
const settledNow = async (p: Promise<unknown>) => {
  let done = false;
  void p.then(() => (done = true));
  await sleep(5);
  return done;
};

// 다 녹음한 뒤 녹취가 만들 조각들의 바이트 (비교 기준)
async function fullPieces(): Promise<Buffer[]> {
  const out = path.join(root, 'full');
  fs.mkdirSync(out, { recursive: true });
  await to16k(path.join(dir, 'mic.wav'), path.join(out, 'small.wav'));
  return splitAtPauses(path.join(out, 'small.wav'), out, PIECE).map((p) => fs.readFileSync(p.file));
}

describe('createPretranscriber', () => {
  it('굳은 조각이 없으면(목표 시각 + 30초 전) 아무것도 하지 않는다 — 서버도 띄우지 않고 .pre도 만들지 않는다', async () => {
    const s = fakeServer(userData);
    const rec = recorder();
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE, log: s.log });
    for (const sec of [0, 10, 45, 89.9]) {
      rec.growTo(sec);
      expect(await pre.poke()).toBe(null);
    }
    expect(s.started).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(fs.existsSync(preDir(dir))).toBe(false);
    rec.growTo(90.5); // 60초 목표 + 30초를 넘었다 → 첫 조각이 굳었다
    expect(await pre.poke()).toMatchObject({ final: 1, transcribed: 1, cached: 0 });
    expect(s.started).toHaveLength(1);
    expect(s.stopped).toEqual(s.started); // 돌기가 끝나면 끈다
    expect(first(s.calls)).toHaveLength(1);
    expect(fs.readdirSync(dir).sort()).toEqual(['.pre', 'mic.wav']);
    expect(preFiles()).toHaveLength(1); // 열쇠.json 하나 (임시 폴더 work는 지웠다)
    expect(preFiles()[0]).toMatch(/^[0-9a-f]{64}\.json$/);
    expect(s.logs).toEqual([]);
  });

  it('여러 번 찔러도 굳은 조각마다 한 번씩만 받아쓰고, 보관한 열쇠는 다 녹음한 뒤 녹취가 만들 조각과 같다 (마지막 조각은 빼고)', async () => {
    const s = fakeServer(userData);
    const rec = recorder();
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE, log: s.log });
    const runs = [];
    for (let sec = 0; sec <= SEC; sec += 7) {
      rec.growTo(sec);
      runs.push(await pre.poke());
    }
    rec.growTo(SEC);
    runs.push(await pre.poke());
    const firsts = first(s.calls).map((c) => c.hash);
    expect(new Set(firsts).size).toBe(firsts.length); // 같은 조각을 두 번 받지 않는다
    expect(firsts).toHaveLength(cutTargets(SEC * RATE, RATE, PIECE).length); // 60·120·180·240초 → 4
    expect(runs.filter(Boolean).length).toBe(4); // 새로 굳었을 때만 돈다
    expect(s.started.length).toBe(4);
    expect(s.stopped).toEqual(s.started);

    rec.w.close();
    const full = await fullPieces();
    expect(full).toHaveLength(5);
    const ctx = pieceContext(path.join(userData, 'models', MEETING_MODEL), s.f.settings, null);
    for (const [i, bytes] of full.entries()) {
      const hit = getPiece(dir, pieceKey(bytes, ctx));
      if (i < 4) expect(hit, `${i}번 조각`).not.toBe(null);
      else expect(hit, '마지막 조각').toBe(null);
    }
    expect(firsts.sort()).toEqual(full.slice(0, 4).map(sha).sort()); // 받아쓴 파일 = 녹취가 만들 조각 파일 (바이트까지)
    // 반복 구간 다시 받아쓰기도 같은 서버로 하고 보관값에 들어간다
    for (const c of s.calls.filter((c) => c.redo)) expect(s.calls.find((x) => !x.redo && x.port === c.port)).toBeTruthy();
    expect(s.calls.every((c) => c.language === 'en')).toBe(true); // 회의 언어 (fakeDeps의 meetingLanguage)
  });

  it('도는 중에 또 찌르면 바로 null — 둘이 같이 돌지 않는다', async () => {
    const gate = deferred();
    const s = fakeServer(userData, { gate: () => gate.promise });
    const rec = recorder();
    rec.growTo(160);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE });
    const a = pre.poke();
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    expect(await pre.poke()).toBe(null);
    expect(await pre.poke()).toBe(null);
    gate.resolve();
    expect(await a).toMatchObject({ transcribed: 2 });
    expect(s.started).toHaveLength(1);
    expect(first(s.calls)).toHaveLength(2);
  });

  it('finish(): 받던 조각은 마치고 보관한 뒤 끝난다, 그 뒤로는 돌지 않는다', async () => {
    const gate = deferred();
    const s = fakeServer(userData, { gate: () => gate.promise });
    const rec = recorder();
    rec.growTo(160); // 굳은 조각 둘
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE });
    const run = pre.poke();
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    const finished = pre.finish();
    expect(await settledNow(finished)).toBe(false); // 받는 중인 조각을 기다린다
    gate.resolve();
    await finished;
    expect(await run).toMatchObject({ transcribed: 1 }); // 둘째 조각은 시작하지 않았다
    expect(first(s.calls)).toHaveLength(1);
    expect(preFiles()).toHaveLength(1);
    rec.growTo(SEC);
    expect(await pre.poke()).toBe(null);
    expect(first(s.calls)).toHaveLength(1);
    expect(s.stopped).toEqual(s.started);
    await pre.finish(); // 두 번 불러도 된다
  });

  it('cancel(): 서버를 끄고(받던 요청도 끊긴다) 아무것도 보관하지 않고 임시 파일을 남기지 않는다', async () => {
    const gate = deferred();
    const s = fakeServer(userData, { gate: () => gate.promise });
    const rec = recorder();
    rec.growTo(160);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE, log: s.log });
    const run = pre.poke();
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    await pre.cancel();
    expect(s.stopped).toEqual(s.started);
    expect(await run).toBe(null);
    expect(fs.readdirSync(dir)).toEqual(['mic.wav']); // .pre·work·조각 파일 없음
    expect(s.calls).toHaveLength(1);
    rec.growTo(SEC);
    expect(await pre.poke()).toBe(null);
    expect(s.calls).toHaveLength(1);
    gate.resolve();
    await pre.cancel(); // 두 번 불러도 된다
  });

  it('버리기처럼 cancel() 직후 회의 폴더를 지워도 다시 만들지 않고 로그도 남기지 않는다', async () => {
    const gate = deferred();
    const s = fakeServer(userData, { gate: () => gate.promise });
    const rec = recorder();
    rec.growTo(160);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE, log: s.log });
    const run = pre.poke();
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    const stopped = pre.cancel();
    rec.w.close();
    fs.rmSync(dir, { recursive: true, force: true });
    gate.resolve();
    await stopped;
    expect(await run).toBe(null);
    expect(fs.existsSync(dir)).toBe(false);
    expect(s.logs).toEqual([]);
  });

  it('cancel(): 서버가 뜨는 중이었으면 뜨자마자 끈다', async () => {
    const s = fakeServer(userData);
    const slow = deferred();
    let made: DedicatedServer | null = null;
    let asked = false;
    configure({
      startDedicatedServer: async () => {
        asked = true;
        await slow.promise;
        made = { port: 7000, stop: () => void s.stopped.push(7000), onProgress: () => {} };
        return made;
      },
    });
    const rec = recorder();
    rec.growTo(100);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE });
    const run = pre.poke();
    await vi.waitFor(() => expect(asked).toBe(true));
    const cancelled = pre.cancel();
    slow.resolve();
    await cancelled;
    expect(await run).toBe(null);
    expect(made).not.toBe(null);
    expect(s.stopped).toEqual([7000]);
    expect(s.calls).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(['mic.wav']);
  });

  it('서버를 못 띄우거나 받아쓰기가 실패하면 삼키고(로그만) 정리한다 — 녹음은 그대로, 다음 찌르기는 된다', async () => {
    const s = fakeServer(userData, { start: (k) => (k === 0 ? 'fail' : 'ok'), fail: (k) => k === 0 });
    const rec = recorder();
    rec.growTo(100);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE, log: s.log });
    expect(await pre.poke()).toBe(null); // 서버를 못 띄움
    expect(s.logs).toHaveLength(1);
    expect(String(s.logs[0]?.[1])).toContain('회의용 음성 인식 모델을 불러오지 못했습니다');
    expect(fs.readdirSync(dir)).toEqual(['mic.wav']);
    rec.growTo(110); // 녹음은 계속된다
    expect(await pre.poke()).toBe(null); // 받아쓰기 실패 (첫 요청)
    expect(s.logs).toHaveLength(2);
    expect(s.stopped).toEqual([6001]);
    expect(fs.readdirSync(dir)).toEqual(['mic.wav']);
    expect(await pre.poke()).toMatchObject({ transcribed: 1 }); // 다시 하면 된다
    expect(preFiles()).toHaveLength(1);
    // 녹음 파일은 녹음기가 쓴 그대로
    rec.growTo(130);
    rec.w.close();
    const wav = fs.readFileSync(path.join(dir, 'mic.wav'));
    expect(wav.length).toBe(44 + 130 * RATE * 2);
    expect(Buffer.from(wav.subarray(44)).equals(Buffer.from(rec.pcm.buffer, 0, 130 * RATE * 2))).toBe(true);
  });

  it(`잇달아 ${MAX_FAILURES}번 실패하면 이 회의에서는 그만둔다, 엔진이 없으면(서버 null) 바로 그만둔다`, async () => {
    const s = fakeServer(userData, { start: () => 'fail' });
    const rec = recorder();
    rec.growTo(100);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE, log: s.log });
    for (let i = 0; i < MAX_FAILURES + 2; i++) expect(await pre.poke()).toBe(null);
    expect(s.started).toHaveLength(MAX_FAILURES);

    const n = fakeServer(userData, { start: () => 'null' });
    const pre2 = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE });
    expect(await pre2.poke()).toBe(null);
    rec.growTo(200);
    expect(await pre2.poke()).toBe(null);
    expect(n.started).toHaveLength(1);
    expect(fs.readdirSync(dir)).toEqual(['mic.wav']);
  });

  it('회의용 모델이 없으면 아무것도 하지 않는다 (서버를 띄우지 않는다 — 받아쓰기용 서버도 쓰지 않는다)', async () => {
    fs.rmSync(path.join(userData, 'models', MEETING_MODEL));
    const s = fakeServer(userData);
    const rec = recorder();
    rec.growTo(SEC);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE });
    expect(await pre.poke()).toBe(null);
    expect(s.started).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual(['mic.wav']);
  });

  it('회의 중에 녹취 언어를 바꾸면 다음 돌기에서 굳은 조각을 새 언어로 다시 받아 둔다 (열쇠가 다르다)', async () => {
    const s = fakeServer(userData);
    const rec = recorder();
    rec.growTo(100);
    const pre = createPretranscriber({ dir, tracks: ['mic'], pieceSec: PIECE });
    expect(await pre.poke()).toMatchObject({ transcribed: 1 });
    expect(await pre.poke()).toBe(null); // 그대로면 할 일이 없다
    s.f.settings.meetingLanguage = 'ja';
    expect(await pre.poke()).toMatchObject({ transcribed: 1, cached: 0 });
    expect(first(s.calls).map((c) => c.language)).toEqual(['en', 'ja']);
    expect(first(s.calls)[0]?.hash).toBe(first(s.calls)[1]?.hash);
    expect(preFiles()).toHaveLength(2);
    s.f.settings.meetingLanguage = 'en'; // 되돌리면 이미 있다
    expect(await pre.poke()).toMatchObject({ transcribed: 0, cached: 1 });
  });

  it('트랙이 둘이면(화상 회의) 트랙마다 받아 둔다', async () => {
    const s = fakeServer(userData);
    const rec = recorder();
    const sys = new WavWriter(path.join(dir, 'system.wav'), { sampleRate: RATE });
    sys.append(toFloat(speech(RATE, 100, [[59, 61]], 99)));
    rec.growTo(100);
    const pre = createPretranscriber({ dir, tracks: ['mic', 'system'], pieceSec: PIECE });
    expect(await pre.poke()).toMatchObject({ final: 2, transcribed: 2 });
    expect(s.started).toHaveLength(1); // 서버는 하나
    sys.close();
  });
});

describe('snapshotWav — 녹음 중인 WAV의 앞부분', () => {
  it('뜨는 동안 녹음기가 계속 덧붙여도 잰 길이만큼의 올바른 WAV (머리 크기 칸도 맞게)', async () => {
    const rate = 48000;
    const pcm = noise(rate, 12);
    const live = path.join(dir, 'mic.wav');
    const w = new WavWriter(live, { sampleRate: rate });
    w.append(toFloat(pcm.subarray(0, rate * 4 + 7)));
    const dataBytes = w.dataBytes;
    const header = Buffer.alloc(44);
    const fd = fs.openSync(live, 'r');
    fs.readSync(fd, header, 0, 44, 0);
    fs.closeSync(fd);
    expect(header.readUInt32LE(40)).toBe(0); // 녹음 중 머리의 크기 칸은 늦다 (5초마다 고친다)
    const out = path.join(dir, 'snap.wav');
    const snap = snapshotWav(live, out, header, dataBytes);
    let at = rate * 4 + 7;
    let done = false;
    void snap.then(() => (done = true));
    while (!done && at < pcm.length) {
      const next = Math.min(pcm.length, at + 4801);
      w.append(toFloat(pcm.subarray(at, next)));
      at = next;
      await new Promise((r) => setImmediate(r));
    }
    await snap;
    w.append(toFloat(pcm.subarray(at)));
    w.close();
    const buf = fs.readFileSync(out);
    expect(buf.length).toBe(44 + dataBytes);
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buf.readUInt32LE(4)).toBe(36 + dataBytes);
    expect(buf.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(buf.readUInt32LE(24)).toBe(rate);
    expect(buf.toString('ascii', 36, 40)).toBe('data');
    expect(buf.readUInt32LE(40)).toBe(dataBytes);
    expect(Buffer.from(buf.subarray(44)).equals(Buffer.from(pcm.buffer, 0, dataBytes))).toBe(true);
    await to16k(out, path.join(dir, 'snap-16k.wav')); // 녹취가 읽는 형식
    expect(fs.statSync(path.join(dir, 'snap-16k.wav')).size).toBe(44 + Math.floor(dataBytes / 2 / 3) * 2);
  });

  it('앞부분 성질 (48kHz → 16kHz): 자라는 녹음의 앞부분을 떠서 나눈 조각은 마지막 것만 빼고 다 녹음한 뒤의 조각과 바이트까지 같다', async () => {
    const rate = 48000;
    const sec = 75;
    const piece = 10; // 목표 10·20·30·40초 (45초 전까지)
    // 조용한 곳이 고르게 있지 않은 소리 (자를 자리가 목표 시각에서 앞뒤로 흩어지게)
    const pcm = speech(rate, sec);
    for (let i = 0; i < pcm.length; i++) if (i % 37000 < 3000) pcm[i] = Math.round((pcm[i] ?? 0) / 100);
    const live = path.join(dir, 'mic.wav');
    const w = new WavWriter(live, { sampleRate: rate });
    w.append(toFloat(pcm));
    w.close();
    const ref = path.join(root, 'ref');
    fs.mkdirSync(ref);
    await to16k(live, path.join(ref, 'small.wav'));
    const full = splitAtPauses(path.join(ref, 'small.wav'), ref, piece).map((p) => ({ offset: p.offset, bytes: fs.readFileSync(p.file) }));
    expect(full).toHaveLength(5);
    const header = fs.readFileSync(live).subarray(0, 44);
    const at = path.join(root, 'prefix');
    fs.mkdirSync(at);
    let compared = 0;
    for (const s of [11, 21.3, 39.99, 40.01, 45.5, 51, 63.7, 70.0001]) {
      const samples = Math.round(s * rate) + (Math.round(s * 10) % 3); // 3의 배수가 아닌 길이도
      await snapshotWav(live, path.join(at, 'snap.wav'), header, samples * 2);
      await to16k(path.join(at, 'snap.wav'), path.join(at, 'small.wav'));
      const pieces = splitAtPauses(path.join(at, 'small.wav'), at, piece);
      const final = cutTargets(Math.floor(samples / 3), 16000, piece).length;
      expect(pieces.length, `${s}초`).toBe(final + 1);
      for (const [i, p] of pieces.slice(0, -1).entries()) {
        expect(p.offset).toBe(full[i]?.offset);
        expect(fs.readFileSync(p.file).equals(full[i]?.bytes ?? Buffer.alloc(0)), `${s}초의 ${i}번 조각`).toBe(true);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10);
  });
});
