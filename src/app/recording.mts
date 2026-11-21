// ── 녹음 저장: 창이 보낸 소리를 WAV로 쓰고, 멈추면 meta.json을 남겨 받아쓰기·회의록으로 넘긴다 ─────────
// src/main.js에서 옮김 (결정 70). 지금 녹음(recording)과 다음 회의의 참석 인원(nextSpeakers)은 여기만 갖는다 —
// 다른 구역은 get()으로 읽는다. 일시정지·경과 시간, 받아쓰기 19/20분 제한, 녹음 버튼·취소(rec:toggle·rec:cancel·rec:failed는
// fn 상태 머신에 알린다), 취소 확인 창도 여기.
// 받아쓰기 녹음은 임시 폴더에 두고 처리 뒤 지운다(dictation-run.mts). 회의 녹음은 녹음 폴더에 남는다.
// 녹음 폴더·임시 폴더·fn 상태 머신·권한 도우미·창으로 보내기·메뉴바·받아쓰기와 회의록 시작은 본체가 넘긴다.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as core from '../core/index.mjs';
import { WavWriter } from '../meeting/wav-writer.mjs';
import { platform } from '../platform/index.mjs';
import type { Dictation } from '../dictation/index.mjs';
import type { DictationJob, FrontApp } from './dictation-run.mjs';
import type { FnMachine } from './fn.mjs';
import type { Ipc } from './ipc.mjs';

export const VOICE_RMS = 0.003; // 이 크기 이상이면 말소리로 센다 (-50dBFS, 조용한 방 잡음 -63dBFS보다 13dB 위)
export const DICTATION_MAX_MS = 20 * 60 * 1000; // 받아쓰기 한 번의 최대 길이 (Wispr Flow와 같은 20분)

export interface Recording {
  dir: string;
  mode: string; // memo(받아쓰기) | meeting
  writers: Record<string, WavWriter>; // 트랙(mic·system)마다
  sampleRate: number;
  devices: unknown; // 창이 고른 장치 (meta.json에 그대로)
  startedAt: Date;
  micPeak: number;
  voicedMs: number; // 말소리 크기가 들어온 시간
  app: FrontApp | null; // 받아쓰기: fn을 누른 순간 앞에 있던 앱 (늦게 채워진다)
  pausedMs: number;
  pausedAt: number | null;
  speakers: number | null; // 참석 인원 (null = 자동)
}

// 녹음 시간 (일시정지한 시간은 빼고) — 독·메뉴바·창의 시계
export interface ClockInfo {
  mode: string;
  paused: boolean;
  elapsedMs: number;
}

export interface RecordingContext {
  recordingsDir: () => string;
  tempDir: () => string; // app.getPath('temp')
  fn: Pick<FnMachine, 'dictationLimitReached' | 'stopReceived' | 'uiToggle' | 'uiCancel' | 'recordingFailed'>;
  dictation: Pick<Dictation, 'getSettings'>;
  runPermissionsHelper: (args: string[]) => Promise<string | null>;
  runDictation: (job: DictationJob) => unknown;
  runMinutes: (dir: string, speakers: number | null) => unknown;
  updateTray: () => void;
  send: (channel: string, payload?: unknown) => void; // 메인 창으로
  sendOverlay: (channel: string, payload?: unknown) => void; // 플로팅 독으로
  dialog: {
    showMessageBox(opts: { type: 'warning'; buttons: string[]; defaultId: number; cancelId: number; message: string; detail: string }): Promise<{ response: number }>;
  };
  selftest: boolean;
  log: (...args: unknown[]) => void; // console.log
}

export interface RecordingSession {
  get(): Recording | null;
  elapsedMs(rec?: Recording | null): number;
  clockInfo(): ClockInfo | null;
  setPaused(on: boolean): void;
  confirmCancel(): Promise<void>;
  closeOnQuit(): void; // 앱을 끝낼 때: 쓰던 파일을 닫고 녹음을 놓는다 (meta.json은 쓰지 않는다)
}

// 녹음 폴더 이름의 시각 (2026-11-21_09-05-03)
export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

interface RecStart {
  mode: string;
  sampleRate: number;
  tracks: string[];
  devices: unknown;
}

export function registerRecording(ipc: Ipc, ctx: RecordingContext): RecordingSession {
  let recording: Recording | null = null; // { dir, mode, writers: { mic, system }, startedAt, micPeak, pausedMs, pausedAt, speakers }
  let nextSpeakers: number | null = null; // 창의 시작 시트에서 고른 참석 인원 (다음 회의 녹음에 쓴다)

  // 회의 녹음 일시정지: 그동안 들어오는 소리를 파일에 쓰지 않는다 (재개하면 바로 이어서 기록)
  function elapsedMs(rec: Recording | null = recording): number {
    if (!rec) return 0;
    const now = Date.now();
    return now - +rec.startedAt - rec.pausedMs - (rec.pausedAt ? now - rec.pausedAt : 0);
  }

  function clockInfo(): ClockInfo | null {
    return recording ? { mode: recording.mode, paused: Boolean(recording.pausedAt), elapsedMs: elapsedMs() } : null;
  }

  function setPaused(on: boolean): void {
    if (!recording || recording.mode !== 'meeting' || Boolean(recording.pausedAt) === on) return;
    if (on) recording.pausedAt = Date.now();
    else {
      recording.pausedMs += Date.now() - (recording.pausedAt as number); // 여기 오면 언제나 일시정지 중이다 (위의 같음 비교)
      recording.pausedAt = null;
    }
    ctx.updateTray();
    ctx.send('rec:clock', clockInfo());
  }

  async function confirmCancel(): Promise<void> {
    if (!recording) return;
    const min = Math.round(elapsedMs() / 60000);
    const { response } = await ctx.dialog.showMessageBox({
      type: 'warning',
      buttons: ['녹음 버리기', '계속 녹음'],
      defaultId: 1,
      cancelId: 1,
      message: '회의 녹음을 취소할까요?',
      detail: `지금까지 녹음한 ${min ? `${min}분` : '내용'}이 저장되지 않고 지워집니다.`,
    });
    if (response === 0) ctx.fn.uiCancel();
  }

  ipc.handle('rec:start', (_e, opts) => {
    const { mode, sampleRate, tracks, devices } = opts as RecStart;
    // 받아쓰기 음성은 임시 폴더에만 두고, 처리 후 지운다
    const base = mode === 'memo' ? path.join(ctx.tempDir(), 'meeting-recorder-dictation') : ctx.recordingsDir();
    const dir = path.join(base, `${timestamp()}_${mode}`);
    fs.mkdirSync(dir, { recursive: true });
    const writers: Record<string, WavWriter> = {};
    for (const t of tracks) writers[t] = new WavWriter(path.join(dir, `${t}.wav`), { sampleRate });
    recording = { dir, mode, writers, sampleRate, devices, startedAt: new Date(), micPeak: 0, voicedMs: 0, app: null, pausedMs: 0, pausedAt: null, speakers: mode === 'meeting' ? nextSpeakers : null };
    if (mode === 'meeting') nextSpeakers = null;
    if (mode === 'memo') {
      // 받아쓰기가 너무 길어지면 19분에 미리 알리고 20분에서 끝내고 입력한다
      const rec = recording;
      setTimeout(() => {
        if (recording === rec) ctx.sendOverlay('overlay:stage', { stage: 'limit' });
      }, DICTATION_MAX_MS - 60 * 1000);
      setTimeout(() => {
        if (recording !== rec) return;
        ctx.fn.dictationLimitReached();
      }, DICTATION_MAX_MS);
    }
    if (mode === 'memo') {
      // 통계용: 어느 앱에 입력하려고 했는지 (fn을 누른 순간 앞에 있던 앱)
      const rec = recording;
      ctx.runPermissionsHelper(['frontapp']).then((out) => {
        try {
          rec.app = JSON.parse(String(out)); // 도우미가 실패하면(null) 예전처럼 null이 된다
        } catch {}
      });
    }
    ctx.updateTray();
    // 셀프테스트: 시스템 소리 트랙에 실제로 소리가 잡히는지 확인용 효과음 재생
    const sound = platform.shell.selftestSound;
    if (ctx.selftest && mode === 'meeting' && sound) setTimeout(() => spawn(...sound), 1000);
    return { dir };
  });

  ipc.on('rec:chunk', (_e, chunk) => {
    const { track, samples } = chunk as { track: string; samples: Float32Array };
    const rec = recording;
    const w = rec?.writers[track];
    if (!w || !rec || rec.pausedAt) return;
    const pcm = new Float32Array(samples.buffer, samples.byteOffset, samples.length);
    w.append(pcm);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      const v = pcm[i] as number;
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    if (track === 'mic') {
      rec.micPeak = Math.max(rec.micPeak, peak);
      // 말소리 크기(-50dBFS 이상)가 들어온 시간. 딸깍 소리 하나로 Whisper가 '감사합니다'를 지어내는 것을 막는다
      if (Math.sqrt(sum / Math.max(1, pcm.length)) > VOICE_RMS) rec.voicedMs += (pcm.length / rec.sampleRate) * 1000;
    }
    // 플로팅 독의 레벨 막대 (100ms마다 한 칸)
    const db = 10 * Math.log10(sum / Math.max(1, pcm.length) + 1e-12);
    ctx.sendOverlay('overlay:level', { track, db });
  });

  ipc.handle('rec:stop', (_e, opts = {}) => {
    const { discard = false } = opts as { discard?: boolean };
    ctx.fn.stopReceived({ discard }); // 받아쓰기가 아니거나 버리면 '멈추는 중'을 푼다
    if (!recording) return null;
    const { dir, mode, writers, sampleRate, devices, startedAt, micPeak, voicedMs, speakers } = recording;
    const rec = recording;
    if (discard) {
      for (const w of Object.values(writers)) w.close();
      fs.rmSync(dir, { recursive: true, force: true });
      recording = null;
      ctx.updateTray();
      if (ctx.selftest) ctx.log('SELFTEST discarded', path.basename(dir));
      return null;
    }
    const files: Record<string, { file: string; durationSec: number }> = {};
    for (const [track, w] of Object.entries(writers)) {
      w.close();
      files[track] = { file: path.basename(w.filePath), durationSec: Number(w.durationSec.toFixed(2)) };
    }
    const meta = { mode, sampleRate, bitDepth: 16, startedAt, endedAt: new Date(), devices, files, ...(speakers ? { speakers } : {}) };
    // meta.json이 있어야 회의 목록에 나온다. 반쯤 쓰이면 녹음은 남아도 앱이 회의로 알아보지 못한다
    core.writeJsonAtomic(path.join(dir, 'meta.json'), meta);
    recording = null;
    ctx.updateTray();
    if (ctx.selftest) ctx.log('SELFTEST saved', path.basename(dir), JSON.stringify(files));
    if (mode === 'memo') ctx.runDictation({ dir, peak: micPeak, voicedMs, startedAt, durationSec: files.mic?.durationSec ?? 0, rec });
    if (mode === 'meeting' && ctx.dictation.getSettings().minutes) ctx.runMinutes(dir, speakers ?? null);
    return { dir, ...meta };
  });

  // ── 녹음 버튼·참석 인원 (창에서) ─────────────────────────────────────────
  ipc.on('rec:toggle', (_e, mode) => ctx.fn.uiToggle(mode as string | undefined));
  ipc.on('rec:pause', (_e, on) => setPaused(Boolean(on)));
  ipc.on('rec:cancel', () => ctx.fn.uiCancel());
  // 참석 인원: 녹음 전에는 다음 회의에, 녹음 중이면 지금 회의에 적용한다 (null = 자동)
  ipc.on('rec:speakers', (_e, n) => {
    const v = Number(n) || null;
    if (recording?.mode === 'meeting') recording.speakers = v;
    else nextSpeakers = v;
  });
  ipc.on('rec:failed', () => ctx.fn.recordingFailed());

  return {
    get: () => recording,
    elapsedMs,
    clockInfo,
    setPaused,
    confirmCancel,
    closeOnQuit: () => {
      if (recording) {
        for (const w of Object.values(recording.writers)) w.close();
        recording = null;
      }
    },
  };
}
