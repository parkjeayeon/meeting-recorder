// 회의 녹취: 녹음 → 16kHz → 조각별 Whisper 녹취(+같은 문장 반복 구간 다시) · 화자 구분 → segments.json·transcript.txt.
// Electron을 쓰지 않는다. Whisper 서버·앱 데이터 폴더는 deps.mts로 받는다 (결정 70).
// 조각은 회의용 서버 여럿이 나눠 받는다 — 서버 수는 core/parallel.mts의 meetingServers (결정 82).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../core/write.mjs';
import { meetingVad } from '../core/vad.mjs';
import { meetingServers } from '../core/parallel.mjs';
import { recordedTracks, splitAtPauses, to16k, trackPath, writeWav, type Piece, type TrackMeta } from './audio.mjs';
import { startDedicatedServer, transcribeSegments, userData, type DedicatedServer, type MeetingSettings } from './deps.mjs';
import { diarize, diarizeAvailable, type Diarization } from './diarize.mjs';
import { buildTranscript, findLoops, type Segment } from './transcript.mjs';

export const MEETING_MODEL = 'ggml-large-v3.bin'; // 회의는 속도보다 정확도 (없으면 받아쓰기용 turbo로)

// 회의 녹취는 회의 언어로 (설정 › 회의, 받아쓰기 언어와 따로)
export const meetingAsr = (settings: MeetingSettings): MeetingSettings => ({ ...settings, language: settings.meetingLanguage || settings.language });

// ── 같은 문장 반복 구간 다시 받아쓰기 ─────────────────────────────────────
// Whisper는 앞 문장을 이어 받아 쓰는데, 작은 목소리·잡음 구간에서 한 문장에 갇히면 조각이 끝날 때까지
// 1초마다 같은 문장을 적는다 (30분 회의에서 3.5분, 2시간 회의에서 8.5분이 이렇게 빠짐).
// 매번 생기는 게 아니라 같은 녹음도 다시 돌리면 대개 제대로 나오므로, 그 구간만 앞 문장 없이 다시 받아쓴다.
// 반복 구간 찾기(findLoops)는 transcript.mts
export interface Redone {
  start: number;
  end: number;
  stillLooping: boolean;
  ms: number;
}

export async function redoLoops(pieceFile: string, segs: Segment[], settings: MeetingSettings, port: number | null): Promise<{ segs: Segment[]; redone: Redone[] }> {
  const loops = findLoops(segs);
  if (!loops.length) return { segs, redone: [] };
  const buf = fs.readFileSync(pieceFile);
  const rate = buf.readUInt32LE(24);
  const redone: Redone[] = [];
  for (const loop of loops) {
    const t = Date.now();
    const from = Math.max(0, Math.floor(loop.start * rate)) * 2;
    const to = Math.min(buf.length - 44, Math.ceil(loop.end * rate) * 2);
    const file = `${pieceFile}.redo.wav`;
    writeWav(file, buf, buf.subarray(44 + from, 44 + to));
    try {
      const again = await transcribeSegments(file, meetingAsr(settings), port, { noContext: true });
      const offset = from / 2 / rate;
      segs = [
        ...segs.filter((s) => s.start < loop.start - 0.01),
        ...again.map((s) => ({ ...s, start: s.start + offset, end: s.end + offset })),
        ...segs.filter((s) => s.start >= loop.end),
      ];
      redone.push({ start: loop.start, end: loop.end, stillLooping: findLoops(again).length > 0, ms: Date.now() - t });
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  return { segs, redone };
}

// meta.json 중 여기서 읽는 부분
export interface MeetingMeta extends TrackMeta {
  files: Record<string, { file?: string; durationSec?: number } | undefined>;
  startedAt?: string;
  notes?: string;
  speakers?: number | null;
  speakerNames?: Record<string, string>;
  [k: string]: unknown;
}

export type Report = (status: string, extra?: Record<string, unknown>) => void;
export type DiarizeInfo = { speakers?: number | null; diarizeError?: string | null };

// ── 조각 나눠 받기 ────────────────────────────────────────────────────────
// 조각마다 따로 보내는 요청이라(앞 조각의 글을 넘기지 않음, greedy·temperature 0) 서버 여럿이 나눠 받아도 글은 같다 (결정 82).
// 서버마다 일꾼 하나가 남은 조각을 하나씩 가져가, 첫 받아쓰기 → 같은 서버로 반복 구간 다시까지 마친 뒤 다음 조각을 가져간다
// → 서버 하나에 요청은 언제나 하나. 결과는 조각 번호 자리에 두고, 모으는 쪽이 조각 순서대로 읽는다 (끝난 순서와 상관없이 같은 파일).
interface PieceResult {
  segs: Segment[];
  redone: Redone[];
}

interface PieceQueue {
  start(server: DedicatedServer | null): void; // 이 서버(null = 받아쓰기용 상주 서버)로 일꾼 하나를 더 붙인다
  done: Promise<void>; // 조각이 모두 끝나면 풀리고, 한 조각이라도 실패하면 그 까닭으로 거절된다
  settled(): Promise<void>; // 붙은 일꾼이 모두 손을 놓을 때까지 (실패한 뒤 정리용)
  results: PieceResult[]; // 조각 번호 자리에
  used: Set<DedicatedServer | null>; // 조각을 하나라도 받은 서버
}

// 진행률 = (끝난 조각 + 받는 중인 조각들의 진행률(각 0.99까지)) / 조각 수 → 줄지 않고, 모두 끝나야 1.
// 받는 도중 값은 1% 단위로만, 조각이 끝날 때는 그 값 그대로 알린다. 반복 구간 다시 받아쓰기는 진행률을 움직이지 않는다
function pieceQueue(pieces: Piece[], settings: MeetingSettings, progress: (p: number) => void): PieceQueue {
  const results: PieceResult[] = new Array(pieces.length);
  const used = new Set<DedicatedServer | null>();
  const inFlight = new Map<number, number>();
  const workers: Promise<void>[] = [];
  let next = 0;
  let finished = 0;
  let failed = false;
  let last = 0;
  let resolve = (): void => {};
  let reject = (_err: unknown): void => {};
  const done = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  if (!pieces.length) resolve();

  const report = (exact: boolean) => {
    let sum = finished;
    for (const p of inFlight.values()) sum += Math.min(p, 0.99);
    const value = exact ? sum / pieces.length : Math.floor((sum / pieces.length) * 100) / 100;
    if (value > last) {
      last = value;
      progress(value);
    }
  };

  const work = async (server: DedicatedServer | null) => {
    const port = server?.port ?? null;
    while (!failed && next < pieces.length) {
      const i = next++;
      const piece = pieces[i];
      if (!piece) break;
      used.add(server);
      inFlight.set(i, 0);
      // 조각 안 진행률은 서버마다 따로 온다 (Whisper 서버가 알려 줌)
      server?.onProgress((p) => {
        if (!inFlight.has(i)) return;
        inFlight.set(i, Math.max(inFlight.get(i) ?? 0, p));
        report(false);
      });
      try {
        const first = await transcribeSegments(piece.file, meetingAsr(settings), port);
        server?.onProgress(null); // 반복 구간 다시 받아쓰기의 진행률은 조각 진행률과 섞지 않는다
        results[i] = await redoLoops(piece.file, first, settings, port);
      } catch (err) {
        server?.onProgress(null);
        inFlight.delete(i);
        failed = true;
        reject(err);
        return;
      }
      inFlight.delete(i);
      finished++;
      report(true);
      if (finished === pieces.length) resolve();
    }
  };

  return {
    start: (server) => void workers.push(work(server)),
    done,
    settled: async () => void (await Promise.all(workers)),
    results,
    used,
  };
}

// 녹음 → 16kHz → 조각별 Whisper 녹취(+반복 구간 다시) · 화자 구분 → transcript.txt
// timing은 부르는 쪽의 기록(minutes.json)에 그대로 채운다
export async function transcribeMeeting(dir: string, meta: MeetingMeta, settings: MeetingSettings, speakers: number | null | undefined, timing: Record<string, unknown>, report: Report): Promise<{ transcript: string; diarizeInfo: DiarizeInfo }> {
  const tracks = recordedTracks(dir, meta);
  // 뜬 회의용 서버는 모두 여기에 — 끝나면(실패해도) 모두 끈다. 끈 뒤에(closed) 뜬 서버는 뜨자마자 끈다
  const pool: DedicatedServer[] = [];
  let closed = false;
  const stopAll = () => {
    closed = true;
    for (const s of pool.splice(0)) s.stop();
  };
  const temp: string[] = [];
  try {
    report('transcribe', { progress: 0 });
    const t = Date.now();
    const modelFile = path.join(userData(), 'models', MEETING_MODEL);
    // VAD는 MR_MEETING_VAD를 줄 때만 켠다 (재 보기용). 반복 구간 다시 받아쓰기도 같은 서버를 쓴다
    const vad = meetingVad(process.env, fs.existsSync);
    const first = await startDedicatedServer(modelFile, { vad }).catch(() => null);
    if (first) pool.push(first);
    timing.model = first ? 'large-v3' : 'large-v3-turbo';
    // 기록에는 모델 경로를 빼고 값만 남긴다. 회의용 서버를 못 띄웠으면(turbo로 받아씀) VAD도 안 쓴 것
    const vadUsed = first && vad ? { threshold: vad.threshold, padMs: vad.padMs, minSilenceMs: vad.minSilenceMs } : null;
    if (vadUsed) timing.vad = vadUsed;

    // 조각이 둘 이상이면 서버를 더 띄운다 (meetingServers). 첫 서버는 기다리지 않고 바로 받기 시작하고,
    // 더 띄운 서버는 뜨는 대로 그때 받는 트랙의 큐에 붙는다. 못 띄우면 뜬 서버들로 계속한다
    const totalMemBytes = os.totalmem();
    let extraTried = 0;
    let joinTrack: ((s: DedicatedServer) => void) | null = null;
    const startExtra = () =>
      startDedicatedServer(modelFile, { vad }).then(
        (s) => {
          if (!s) return;
          if (closed) return s.stop();
          pool.push(s);
          joinTrack?.(s);
        },
        () => {},
      );
    const usedServers = new Set<DedicatedServer | null>();

    const lines: (Segment & { track: string })[] = [];
    const redo: (Redone & { track: string })[] = []; // 같은 문장 반복으로 다시 받아쓴 구간
    let diarization: Diarization | null = null;
    for (const track of tracks) {
      const small = path.join(dir, `.${track}-16k.wav`);
      temp.push(small);
      await to16k(trackPath(dir, meta, track)!, small);
      // 화자 구분은 대면 회의 마이크 트랙에서 녹취와 동시에 돌린다
      const wantDiarize = settings.diarize && track === 'mic' && diarizeAvailable();
      const diarizeJob: Promise<Diarization> | null = wantDiarize
        ? diarize(small, speakers).then(
            (r) => r,
            (err) => ({ error: err.message }),
          )
        : null;
      const tDiarize = Date.now();
      const pieces = splitAtPauses(small, dir);
      temp.push(...pieces.map((p) => p.file));
      const queue = pieceQueue(pieces, settings, (progress) => report('transcribe', { progress, diarizing: Boolean(diarizeJob) }));
      if (first) {
        for (const s of pool) queue.start(s);
        joinTrack = (s) => queue.start(s);
        const want = meetingServers({ totalMemBytes, pieces: pieces.length, env: process.env });
        for (; 1 + extraTried < want; extraTried++) void startExtra();
      } else {
        queue.start(null); // 회의용 서버가 없으면 받아쓰기용 서버로 차례로 (예전과 같다)
      }
      try {
        await queue.done;
      } catch (err) {
        // 한 조각이 실패하면 서버를 모두 꺼 다른 조각의 요청도 끝내고, 일꾼이 모두 손을 놓은 뒤(다시 받아쓰기 임시 파일까지 지운 뒤) 실패로 돌려준다
        stopAll();
        await queue.settled();
        throw err;
      } finally {
        joinTrack = null;
      }
      for (const s of queue.used) usedServers.add(s);
      for (const [i, piece] of pieces.entries()) {
        const r = queue.results[i];
        if (!r) continue;
        for (const x of r.redone) redo.push({ ...x, start: x.start + piece.offset, end: x.end + piece.offset, track });
        for (const seg of r.segs) lines.push({ ...seg, start: seg.start + piece.offset, end: seg.end + piece.offset, track });
      }
      if (diarizeJob) {
        diarization = await diarizeJob;
        timing.diarizeMs = Date.now() - tDiarize;
      }
    }
    stopAll();
    timing.transcribeMs = Date.now() - t;
    timing.servers = usedServers.size; // 조각을 하나라도 받은 서버 수 (회의용 서버가 없으면 받아쓰기용 서버 1)
    lines.sort((a, b) => a.start - b.start);
    // 서버 수·끝난 순서와 상관없이 같은 파일이 되도록 트랙 순서, 그 안에서 시각 순서로 (조각 순서로 모았으니 이미 그 순서다)
    redo.sort((a, b) => tracks.indexOf(a.track) - tracks.indexOf(b.track) || a.start - b.start);
    // 중간 결과를 남겨 두면 나중에 스크립트 규칙을 바꿔도 녹취·화자 구분을 다시 돌리지 않아도 된다
    if (redo.length) timing.redo = redo;
    writeJsonAtomic(path.join(dir, 'segments.json'), { model: timing.model, ...(vadUsed ? { vad: vadUsed } : {}), tracks, redo, segments: lines }, 0);
    if (diarization?.segments) writeJsonAtomic(path.join(dir, 'diarization.json'), diarization, 0);

    const { text: transcript, speakerCount } = buildTranscript(lines, diarization, tracks);
    writeFileAtomic(path.join(dir, 'transcript.txt'), transcript ? `${transcript}\n` : '');
    return { transcript, diarizeInfo: { speakers: speakerCount, diarizeError: diarization?.error ?? null } };
  } finally {
    stopAll();
    for (const f of temp) fs.rmSync(f, { force: true });
  }
}
