// 회의 녹취: 녹음 → 16kHz → 조각별 Whisper 녹취(+같은 문장 반복 구간 다시) · 화자 구분 → segments.json·transcript.txt.
// Electron을 쓰지 않는다. Whisper 서버·앱 데이터 폴더는 deps.mts로 받는다 (결정 70).
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../core/write.mjs';
import { meetingVad } from '../core/vad.mjs';
import { recordedTracks, splitAtPauses, to16k, trackPath, writeWav, type TrackMeta } from './audio.mjs';
import { startDedicatedServer, transcribeSegments, userData, type MeetingSettings } from './deps.mjs';
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

// 녹음 → 16kHz → 조각별 Whisper 녹취(+반복 구간 다시) · 화자 구분 → transcript.txt
// timing은 부르는 쪽의 기록(minutes.json)에 그대로 채운다
export async function transcribeMeeting(dir: string, meta: MeetingMeta, settings: MeetingSettings, speakers: number | null | undefined, timing: Record<string, unknown>, report: Report): Promise<{ transcript: string; diarizeInfo: DiarizeInfo }> {
  const tracks = recordedTracks(dir, meta);
  let server: Awaited<ReturnType<typeof startDedicatedServer>> = null;
  const temp: string[] = [];
  try {
    report('transcribe', { progress: 0 });
    const t = Date.now();
    const modelFile = path.join(userData(), 'models', MEETING_MODEL);
    // VAD는 MR_MEETING_VAD를 줄 때만 켠다 (재 보기용). 반복 구간 다시 받아쓰기도 같은 서버를 쓴다
    const vad = meetingVad(process.env, fs.existsSync);
    server = await startDedicatedServer(modelFile, { vad }).catch(() => null);
    timing.model = server ? 'large-v3' : 'large-v3-turbo';
    // 기록에는 모델 경로를 빼고 값만 남긴다. 회의용 서버를 못 띄웠으면(turbo로 받아씀) VAD도 안 쓴 것
    const vadUsed = server && vad ? { threshold: vad.threshold, padMs: vad.padMs, minSilenceMs: vad.minSilenceMs } : null;
    if (vadUsed) timing.vad = vadUsed;

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
      for (const [i, piece] of pieces.entries()) {
        const port = server?.port ?? null;
        // 조각 안 진행률(Whisper 서버가 알려 줌)을 전체로 환산한다. 1% 단위로만 기록한다
        let shown = -1;
        server?.onProgress((p) => {
          const pct = Math.floor(((i + Math.min(p, 0.99)) / pieces.length) * 100);
          if (pct > shown) report('transcribe', { progress: pct / 100, diarizing: Boolean(diarizeJob) });
          shown = Math.max(shown, pct);
        });
        const first = await transcribeSegments(piece.file, meetingAsr(settings), port);
        server?.onProgress(null); // 반복 구간 다시 받아쓰기의 진행률은 조각 진행률과 섞지 않는다
        const { segs, redone } = await redoLoops(piece.file, first, settings, port);
        for (const r of redone) redo.push({ ...r, start: r.start + piece.offset, end: r.end + piece.offset, track });
        for (const seg of segs) lines.push({ ...seg, start: seg.start + piece.offset, end: seg.end + piece.offset, track });
        report('transcribe', { progress: (i + 1) / pieces.length, diarizing: Boolean(diarizeJob) });
      }
      if (diarizeJob) {
        diarization = await diarizeJob;
        timing.diarizeMs = Date.now() - tDiarize;
      }
    }
    server?.stop();
    server = null;
    timing.transcribeMs = Date.now() - t;
    lines.sort((a, b) => a.start - b.start);
    // 중간 결과를 남겨 두면 나중에 스크립트 규칙을 바꿔도 녹취·화자 구분을 다시 돌리지 않아도 된다
    if (redo.length) timing.redo = redo;
    writeJsonAtomic(path.join(dir, 'segments.json'), { model: timing.model, ...(vadUsed ? { vad: vadUsed } : {}), tracks, redo, segments: lines }, 0);
    if (diarization?.segments) writeJsonAtomic(path.join(dir, 'diarization.json'), diarization, 0);

    const { text: transcript, speakerCount } = buildTranscript(lines, diarization, tracks);
    writeFileAtomic(path.join(dir, 'transcript.txt'), transcript ? `${transcript}\n` : '');
    return { transcript, diarizeInfo: { speakers: speakerCount, diarizeError: diarization?.error ?? null } };
  } finally {
    server?.stop();
    for (const f of temp) fs.rmSync(f, { force: true });
  }
}
