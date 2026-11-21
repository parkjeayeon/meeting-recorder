// ── 받아쓰기 처리: 녹음을 넘겨받아 받아쓰고 입력한 뒤 기록에 한 줄 남기고 음성을 지운다 ─────────
// src/main.js에서 옮김 (결정 70). 진행 중인 받아쓰기 수(transcribing)와 마지막으로 받아쓴 글(lastTranscript)은 여기만 갖는다 —
// fn 상태 머신·플로팅 독은 transcribing()으로 읽는다. 받아쓰기 기록 지우기(dict:delete)·다시 붙여넣기(dict:repaste)·
// 클립보드(clipboard:write)·메뉴바의 '마지막 받아쓰기 붙여넣기'(pasteLast)도 여기.
// 받아쓰기(dictation.js), 녹음 폴더·기록 경로, 창·독·메뉴바, 붙여넣기 도우미 자리는 본체가 넘긴다.
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../core/index.mjs';
import { platform } from '../platform/index.mjs';
import type { Dictation, DictateStage, DictateTiming } from '../dictation/index.mjs';
import type { FnMachine } from './fn.mjs';
import type { History } from './history.mjs';
import type { Ipc } from './ipc.mjs';

// 녹음 시작 때 권한 도우미로 읽은 앞 앱 (통계용)
export interface FrontApp {
  name?: string;
  bundleId?: string;
}

// 받아쓰기 결과 (dictation.dictate가 돌려준 것 또는 던진 오류) — 모든 경우의 칸을 선택으로
export interface DictationOutcome {
  status: string; // pasted | no-permission | failed | silent | empty | error
  raw?: string;
  text?: string;
  language?: string;
  detected?: string | null;
  cleaned?: boolean;
  cleanupProvider?: string | null;
  cleanupChunks?: number;
  cleanupError?: string | null;
  error?: string;
  timing?: DictateTiming;
}

// dictations.jsonl 한 줄
export interface DictationLogEntry {
  id: string;
  startedAt: Date;
  durationSec: number;
  voicedSec: number;
  status: string;
  app: string | null;
  bundleId: string | null;
  language: string;
  languageSetting: string;
  raw: string | null;
  text: string | null;
  chars: number;
  words: number;
  rawWords: number;
  wpm: number | null;
  cleaned: boolean;
  cleanupProvider: string | null;
  cleanupChunks: number;
  cleanupError: string | null;
  error: string | null;
  timing: DictateTiming | null;
}

export interface DictationJob {
  dir: string; // 임시 폴더의 녹음 (mic.wav)
  peak: number;
  voicedMs: number;
  startedAt: Date;
  durationSec: number;
  rec: { app: FrontApp | null }; // 녹음 (앞 앱은 녹음 시작 뒤 늦게 채워진다)
}

export interface DictationRunContext {
  dictation: Pick<Dictation, 'dictate' | 'getSettings' | 'paste'>;
  fn: Pick<FnMachine, 'dictationHandedOff'>;
  recordingsDir: () => string;
  dictationLog: () => string;
  helperPath: (name: string) => string; // native/<이름> (설치본은 resources)
  listHistory: History['listHistory']; // 메뉴바의 '마지막 받아쓰기 붙여넣기'가 기록에서 찾는다
  send: (channel: string, payload?: unknown) => void; // 메인 창으로
  sendOverlay: (channel: string, payload?: unknown) => void; // 플로팅 독으로
  sendOverlayState: () => void;
  updateTray: () => void;
  hideWindow: () => void; // 메인 창 숨기기 (다시 붙여넣기 전)
  showOverlay: () => void;
  app: { hide(): void };
  clipboard: { writeText(text: string): void };
  selftest: boolean;
  log: (...args: unknown[]) => void; // console.log
}

export interface DictationRun {
  runDictation(job: DictationJob): Promise<void>;
  transcribing(): number; // 진행 중인 받아쓰기 수
  pasteLast(): void;
}

// 받아쓰기 한 건의 데이터 (나중에 통계·분석용). 음성은 남기지 않는다.
export function countWords(text: string | null | undefined): number {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

type Said = { text?: unknown; raw?: unknown } | string | null | undefined;

export function registerDictationRun(ipc: Ipc, ctx: DictationRunContext): DictationRun {
  const { dictation } = ctx;
  let transcribing = 0; // 진행 중인 받아쓰기 수
  let lastTranscript: string | null = null;

  function logDictation(entry: DictationLogEntry): void {
    fs.mkdirSync(ctx.recordingsDir(), { recursive: true });
    fs.appendFileSync(ctx.dictationLog(), `${JSON.stringify(entry)}\n`);
  }

  async function runDictation({ dir, peak, voicedMs, startedAt, durationSec, rec }: DictationJob): Promise<void> {
    transcribing++;
    ctx.fn.dictationHandedOff();
    ctx.sendOverlayState();
    const onStage = (stage: { stage: DictateStage }) => {
      ctx.sendOverlay('overlay:stage', stage);
      ctx.send('dict:stage', stage);
    };
    // 단계는 본체가 차례대로 알린다. 예전엔 화면이 녹음 저장 답을 받은 뒤 스스로 '인식'으로 바꿨는데, 말소리가 없어(silent) 결과가 저장 답보다
    // 먼저 도착하면 화면이 결과로 '끝'을 그린 뒤 다시 '인식'으로 돌아가 멈춰 있었다 (2026-11-07)
    ctx.send('dict:stage', { stage: 'transcribe' });
    let result: DictationOutcome;
    try {
      result = await dictation.dictate(path.join(dir, 'mic.wav'), { helperBin: ctx.helperPath('permissions'), peak, voicedMs, onStage });
    } catch (err) {
      result = { status: 'error', error: (err as Error).message };
    }
    transcribing--;
    ctx.sendOverlayState();
    const id = path.basename(dir);
    const settings = dictation.getSettings();
    const final = result.text ?? result.raw ?? null;
    logDictation({
      id,
      startedAt,
      durationSec,
      voicedSec: Number((voicedMs / 1000).toFixed(2)),
      status: result.status, // pasted | no-permission | failed | silent | empty | error
      app: rec.app?.name || null,
      bundleId: rec.app?.bundleId || null,
      language: result.language ?? settings.language, // 실제로 받아쓴 언어
      languageSetting: settings.language, // 고른 언어 (auto면 자동)
      raw: result.raw ?? null,
      text: result.text ?? null,
      chars: final?.length ?? 0,
      words: countWords(final),
      rawWords: countWords(result.raw),
      wpm: final && durationSec > 0 ? Math.round((countWords(final) / durationSec) * 60) : null,
      cleaned: Boolean(result.cleaned),
      cleanupProvider: result.cleanupProvider ?? null,
      cleanupChunks: result.cleanupChunks ?? 0,
      cleanupError: result.cleanupError ?? null,
      error: result.error ?? null,
      timing: result.timing ?? null,
    });
    // 검증(변환)이 끝났으니 음성은 지운다
    fs.rmSync(dir, { recursive: true, force: true });
    if (result.text) lastTranscript = result.text;
    if (ctx.selftest) ctx.log('SELFTEST dictation', JSON.stringify(result));
    ctx.sendOverlay('overlay:stage', { stage: 'done', status: result.status, text: result.text ?? null, error: result.error ?? null });
    ctx.send('dict:result', { id, ...result });
    ctx.updateTray();
  }

  // 기록 항목의 transcript는 받아쓰기면 { raw, text, … }, 회의면 transcript.json 그대로 — 모양을 보지 않고 예전처럼 읽는다
  const said = (t: unknown) => t as Exclude<Said, string>;
  function pasteLast(): void {
    const text: Said = lastTranscript ?? said(ctx.listHistory(50).find((r) => said(r.transcript)?.text || said(r.transcript)?.raw)?.transcript);
    const value = typeof text === 'string' ? text : text?.text ?? text?.raw;
    if (value) dictation.paste(value as string, ctx.helperPath('permissions'));
  }

  ipc.handle('dict:delete', (_e, id) => {
    const lines = fs.readFileSync(ctx.dictationLog(), 'utf8').split('\n').filter(Boolean);
    // 기록 전체를 다시 쓰므로 중간에 끊기면 받아쓰기 기록을 통째로 잃는다 → 원자적으로
    core.writeFileAtomic(ctx.dictationLog(), lines.filter((l) => !l.includes(`"id":${JSON.stringify(id)}`)).map((l) => `${l}\n`).join(''));
  });
  ipc.handle('clipboard:write', (_e, text) => ctx.clipboard.writeText(text as string));
  ipc.handle('dict:repaste', async (_e, text) => {
    ctx.hideWindow();
    if (platform.shell.hideAppBeforeRepaste) ctx.app.hide(); // 직전에 쓰던 앱이 다시 앞으로 온다
    await new Promise((r) => setTimeout(r, 350));
    const status = await dictation.paste(text as string, ctx.helperPath('permissions'));
    ctx.showOverlay();
    return status;
  });

  return { runDictation, transcribing: () => transcribing, pasteLast };
}
