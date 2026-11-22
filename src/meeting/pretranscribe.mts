// 녹음 중 미리 받아쓰기: 회의를 녹음하는 동안 더는 바뀌지 않는 조각을 받아써 두고, 회의가 끝난 뒤의 녹취(transcribe.mts)가 그 결과를 다시 쓴다 (결정 83).
// 녹취는 미리 받은 것을 믿지 않는다 — 결과는 조각 바이트·설정으로 만든 열쇠로 보관하고(piece-cache.mts), 녹취가 제 조각마다 열쇠로 찾는다.
// 못 찾으면 예전처럼 받아쓴다. 그래서 글이 같은지는 이 파일이 맞게 도는지에 기대지 않는다 — 빨라지는 것만 기댄다.
//
// 한 번 돌기(poke가 시작한다):
//   트랙마다 지금 WAV 길이로 '더는 바뀌지 않는 조각'이 몇 개인지 센다(audio.mts cutTargets — splitAtPauses와 같은 규칙: 목표 시각보다 30초 넘게 더 녹음됐으면 그 자리는 그대로).
//   새로 생긴 것이 없으면 아무것도 하지 않는다. 있으면 녹음 중인 WAV의 앞부분을 그대로 떠서(APFS 복제 + 길이 자르기 + 머리 고치기) 같은 to16k·pauseCuts로 조각을 내고,
//   마지막 조각(아직 자라는 중)을 뺀 조각 중 보관함에 없는 것만 받아써(+반복 구간 다시) 보관한다.
//   회의용 서버(large-v3) 하나를 받을 것이 있을 때만 띄우고 돌기가 끝나면 끈다. 회의용 모델이 없으면 아무것도 하지 않는다(받아쓰기용 서버를 쓰지 않는다).
// 돌기 안의 오류는 정리한 뒤 삼킨다(로그만) — 녹음과 사용자에게는 아무 영향이 없어야 한다.
import fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { meetingVad } from '../core/vad.mjs';
import { cutTargets, pauseCuts, pieceBytes, PIECE_SEC, to16k, wavPcm } from './audio.mjs';
import { getSettings, startDedicatedServer, transcribeSegments, userData, type DedicatedServer } from './deps.mjs';
import { contextString, ensurePreDir, getPiece, pieceKey, preDir, putPiece } from './piece-cache.mjs';
import { MEETING_MODEL, meetingAsr, pieceContext, redoLoops } from './transcribe.mjs';

export const POKE_MS = 30_000; // 녹음 중 이만큼마다 poke (조각은 10분마다 하나씩 생긴다)
export const MAX_FAILURES = 3; // 돌기가 잇달아 이만큼 실패하면 이 회의에서는 그만둔다 (고장 난 서버로 30초마다 다시 띄우지 않게)
const HEADER = 44;

// 한 번 돈 결과 (재 보기용: scripts/dev/pretranscribe-replay.js)
export interface PreRun {
  ms: number;
  final: number; // 트랙들의 더는 바뀌지 않는 조각 수
  transcribed: number; // 이번에 받아쓴 조각
  cached: number; // 이미 보관돼 있던 조각
}

export interface Pretranscriber {
  poke(): Promise<PreRun | null>; // 돌기를 시작하고 그 끝을 돌려준다. 이미 도는 중·끝냄·그만둠이면 바로 null
  finish(): Promise<void>; // 도는 중이면 받던 조각까지 마치고(보관) 끝날 때까지. 그 뒤로는 돌지 않는다
  cancel(): Promise<void>; // 서버를 끄고 멈춘다. 임시 파일을 지우고 끝날 때까지. 그 뒤로는 돌지 않는다
}

export interface PretranscriberOptions {
  dir: string; // 녹음 중인 회의 폴더
  tracks: string[]; // 트랙 이름 — 파일은 <dir>/<track>.wav (recording.mts가 WavWriter로 쓰는 자리)
  log?: (...args: unknown[]) => void;
  pieceSec?: number; // 시험용 (본체는 넘기지 않는다 — 녹취와 같은 PIECE_SEC)
}

// 녹음 중인 WAV의 머리와, 지금까지 쓰인 PCM 바이트 (샘플 단위로 내림)
async function liveInfo(file: string): Promise<{ header: Buffer; dataBytes: number } | null> {
  let fh: FileHandle | null = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const header = Buffer.alloc(HEADER);
    const { bytesRead } = await fh.read(header, 0, HEADER, 0);
    const { size } = await fh.stat();
    if (bytesRead < HEADER || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;
    // WavWriter 형식(16bit 모노 PCM)만 — to16k가 읽는 형식
    if (header.readUInt16LE(20) !== 1 || header.readUInt16LE(22) !== 1 || header.readUInt16LE(34) !== 16) return null;
    return { header, dataBytes: Math.max(0, Math.floor((size - HEADER) / 2) * 2) };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

// 녹음 중인 WAV의 앞 dataBytes만 담은 올바른 WAV를 만든다.
// 녹음은 앞에서부터 덧붙이기만 하고(WavWriter.append) 이미 쓴 PCM은 다시 쓰지 않으므로, 잰 순간까지의 [44, 44+dataBytes)는 복제한 뒤에도 그대로다.
// 복제 도중 더 붙은 뒷부분은 잘라 낸다. 머리의 크기 칸은 녹음 중엔 몇 초 늦으므로(HEADER_REFRESH_MS) 잰 길이로 새로 쓴다.
// APFS에서는 복제(clonefile)라 거의 공짜, 아니면 보통 복사로 넘어간다
export async function snapshotWav(live: string, out: string, header: Buffer, dataBytes: number): Promise<void> {
  await fs.promises.copyFile(live, out, fs.constants.COPYFILE_FICLONE);
  const { size } = await fs.promises.stat(out);
  if (size < HEADER + dataBytes) throw new Error('녹음 파일이 잰 길이보다 짧습니다');
  await fs.promises.truncate(out, HEADER + dataBytes);
  const h = Buffer.from(header);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.writeUInt32LE(dataBytes, 40);
  const fh = await fs.promises.open(out, 'r+');
  try {
    await fh.write(h, 0, HEADER, 0);
  } finally {
    await fh.close();
  }
}

const tick = () => new Promise<void>((r) => setImmediate(r)); // 조각 사이에 녹음 처리(rec:chunk)에 차례를 넘긴다

export function createPretranscriber({ dir, tracks, log = () => {}, pieceSec = PIECE_SEC }: PretranscriberOptions): Pretranscriber {
  let state: 'open' | 'finishing' | 'cancelled' = 'open';
  let running: Promise<PreRun | null> | null = null;
  let server: DedicatedServer | null = null;
  let failures = 0;
  // 트랙마다 보관을 마친 조각 수 — 그때의 설정(열쇠 문자열)과 함께. 설정이 바뀌면 처음부터 다시 센다 (앞 조각도 새 설정으로 받아 둔다)
  const done = new Map<string, { context: string; count: number }>();
  const work = path.join(preDir(dir), 'work'); // 임시 파일 (돌기가 끝나면 지운다)
  const cancelled = () => state === 'cancelled'; // await 사이에 바뀐다 (함수로 읽어야 타입이 좁혀지지 않는다)

  const cleanWork = () => {
    try {
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmdirSync(preDir(dir)); // 보관한 것이 없으면 .pre도 남기지 않는다 (있으면 비지 않아 실패 → 그대로)
    } catch {}
  };

  async function run(): Promise<PreRun | null> {
    const t = Date.now();
    const modelFile = path.join(userData(), 'models', MEETING_MODEL);
    if (!fs.existsSync(modelFile)) return null; // 회의용 모델이 없으면 아무것도 하지 않는다
    const settings = getSettings(); // 돌 때마다 읽는다 (회의 중에 언어·사전을 바꿀 수 있다 — 열쇠에 들어간다)
    const vad = meetingVad(process.env, fs.existsSync); // 녹취와 같은 서버 설정
    const context = pieceContext(modelFile, settings, vad);
    const cs = contextString(context);
    const out: PreRun = { ms: 0, final: 0, transcribed: 0, cached: 0 };
    let touched = false;
    try {
      for (const track of tracks) {
        if (state !== 'open') break;
        const info = await liveInfo(path.join(dir, `${track}.wav`));
        if (cancelled()) break; // 버리는 중 (회의 폴더가 곧 지워진다)
        if (!info) continue;
        const rate = info.header.readUInt32LE(24);
        const factor = Math.max(1, Math.round(rate / 16000)); // downsampleTo16k와 같은 값
        const final = cutTargets(Math.floor(info.dataBytes / 2 / factor), rate / factor, pieceSec).length;
        const prev = done.get(track);
        const already = prev?.context === cs ? prev.count : 0;
        if (final <= already) continue; // 새로 굳은 조각이 없다

        touched = true;
        ensurePreDir(dir);
        try {
          fs.mkdirSync(work);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
        const snap = path.join(work, `${track}.wav`);
        const small = path.join(work, `${track}-16k.wav`);
        await snapshotWav(path.join(dir, `${track}.wav`), snap, info.header, info.dataBytes);
        await to16k(snap, small);
        await fs.promises.rm(snap, { force: true });
        const buf = await fs.promises.readFile(small);
        await fs.promises.rm(small, { force: true });
        const pcm = wavPcm(buf);
        const cuts = pauseCuts(pcm, buf.readUInt32LE(24), pieceSec);
        const count = cuts.length - 2; // 마지막 조각은 아직 자라는 중
        out.final += Math.max(0, count);
        let finished = true;
        for (let i = 0; i < count; i++) {
          if (state !== 'open') {
            finished = false;
            break;
          }
          await tick();
          const bytes = pieceBytes(buf, pcm, cuts, i);
          const key = pieceKey(bytes, context);
          if (getPiece(dir, key)) {
            out.cached++;
            continue;
          }
          if (!server) {
            const s = await startDedicatedServer(modelFile, { vad });
            if (!s) {
              failures = MAX_FAILURES; // 엔진이나 모델이 없다 → 이 회의에서는 더 띄우지 않는다
              return null;
            }
            if (cancelled()) {
              s.stop();
              return null;
            }
            server = s;
          }
          const file = path.join(work, `.piece-${i}.wav`);
          await fs.promises.writeFile(file, bytes);
          try {
            const first = await transcribeSegments(file, meetingAsr(settings), server.port);
            const r = await redoLoops(file, first, settings, server.port);
            if (cancelled()) return null; // 버린 녹음에는 쓰지 않는다
            putPiece(dir, key, r);
            out.transcribed++;
          } finally {
            await fs.promises.rm(file, { force: true });
          }
        }
        if (finished) done.set(track, { context: cs, count });
      }
      failures = 0;
      out.ms = Date.now() - t;
      return touched ? out : null;
    } finally {
      server?.stop();
      server = null;
      if (touched) cleanWork();
    }
  }

  function poke(): Promise<PreRun | null> {
    if (state !== 'open' || running || failures >= MAX_FAILURES) return Promise.resolve(null);
    const job = run().catch((err: unknown) => {
      failures++;
      // 버린 녹음은 폴더가 지워져 실패하는 것이 당연하다 → 적지 않는다
      if (!cancelled()) log('녹음 중 미리 받아쓰기 실패:', err instanceof Error ? err.message : String(err));
      return null;
    });
    running = job.finally(() => {
      running = null;
    });
    return running;
  }

  return {
    poke,
    finish: async () => {
      if (state === 'open') state = 'finishing';
      await running;
    },
    cancel: async () => {
      state = 'cancelled';
      server?.stop(); // 받는 중인 요청도 끝난다 (그 오류는 삼킨다)
      server = null;
      cleanWork();
      await running;
      cleanWork();
    },
  };
}
