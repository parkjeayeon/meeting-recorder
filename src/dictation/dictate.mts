// 받아쓰기 전체 흐름: 무음 거르기 → 받아쓰기 → 지어낸 문장 거르기 → (선택) 다듬기 → 붙여 넣기. src/dictation.js에서 옮김 (결정 70).
// 무엇을 부를지는 index.mts가 넘긴다 (시험은 가짜를 넘긴다).
import type { CleanupResult } from '../llm/cleanup.mjs';
import type { Choice } from '../llm/call.mjs';
import type { PasteResult } from '../platform/index.mjs';
import type { DictationSettings } from './settings.mjs';
import type { AsrSettings, TranscribeResult } from './transcribe.mjs';

const MIN_VOICED_MS = 300; // 말소리가 이보다 짧으면 Whisper에 넘기지 않는다

export interface DictateTiming {
  transcribeMs?: number;
  cleanupMs?: number;
  pasteMs?: number;
}

export type DictateStage = 'transcribe' | 'cleanup' | 'paste';

export interface DictateOptions {
  helperBin: string; // 붙여넣기 도우미 (native/permissions)
  peak: number; // 녹음의 가장 큰 소리 (0~1)
  voicedMs?: number; // 말소리 길이
  onStage?: (e: { stage: DictateStage }) => void;
}

export type DictateResult =
  | { status: 'silent' } // 거의 무음이라 Whisper를 돌리지 않았다
  | { status: 'empty'; raw: string; timing: DictateTiming } // 지어낸 문장(또는 빈 글)뿐
  | {
      status: PasteResult;
      raw: string;
      text: string;
      language: string; // 실제로 받아쓴 언어 (자동이면 고른 언어)
      detected: string | null;
      cleaned: boolean;
      cleanupProvider: string | null;
      cleanupChunks: number;
      cleanupError: string | null;
      timing: DictateTiming;
    };

export interface DictateDeps {
  getSettings: () => DictationSettings;
  transcribe: (wavPath: string, settings: AsrSettings, opts: { voicedMs: number }) => Promise<TranscribeResult>;
  isHallucination: (text: string) => boolean;
  cleanup: (raw: string, opts: { provider: Choice; apiKey: string | null }) => Promise<CleanupResult>;
  apiKey: () => string | null;
  paste: (text: string, helperBin: string) => Promise<PasteResult>;
}

export function createDictate(deps: DictateDeps): (wavPath: string, opts: DictateOptions) => Promise<DictateResult> {
  return async function dictate(wavPath, { helperBin, peak, voicedMs = Infinity, onStage = () => {} }) {
    const settings = deps.getSettings();
    const timing: DictateTiming = {};
    let t = Date.now();
    // 거의 무음이면 Whisper를 돌리지 않는다 (무음에서 문장을 지어내는 문제 방지)
    if (peak < 0.01 || voicedMs < MIN_VOICED_MS) return { status: 'silent' };

    onStage({ stage: 'transcribe' });
    const heard = await deps.transcribe(wavPath, settings, { voicedMs });
    const raw = heard.text;
    timing.transcribeMs = Date.now() - t;
    if (deps.isHallucination(raw)) return { status: 'empty', raw, timing };

    let text = raw;
    let cleanup: CleanupResult | null = null;
    if (settings.cleanup) {
      onStage({ stage: 'cleanup' });
      t = Date.now();
      cleanup = await deps.cleanup(raw, { provider: settings.provider, apiKey: deps.apiKey() });
      text = cleanup.text;
      timing.cleanupMs = Date.now() - t;
    }

    onStage({ stage: 'paste' });
    t = Date.now();
    const pasted = await deps.paste(text, helperBin);
    timing.pasteMs = Date.now() - t;
    return {
      status: pasted,
      raw,
      text,
      language: heard.language, // 실제로 받아쓴 언어 (자동이면 고른 언어)
      detected: heard.detected,
      cleaned: text !== raw,
      cleanupProvider: cleanup?.provider ?? null,
      cleanupChunks: cleanup?.chunks ?? 0,
      cleanupError: cleanup?.error ?? null,
      timing,
    };
  };
}
