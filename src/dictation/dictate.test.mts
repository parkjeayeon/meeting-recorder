// 받아쓰기 전체 흐름 (src/dictation/dictate.mts) — 가짜 받아쓰기·다듬기·붙여 넣기로 돌려주는 모양과 단계 알림을 본다
import { describe, expect, it } from 'vitest';
import type { CleanupResult } from '../llm/cleanup.mjs';
import { createDictate, type DictateDeps } from './dictate.mjs';
import { DEFAULT_SETTINGS, type DictationSettings } from './settings.mjs';
import { isHallucination } from './transcribe.mjs';

const settings = (over: Partial<DictationSettings> = {}): DictationSettings => ({ ...DEFAULT_SETTINGS, meetingLanguage: 'ko', hasApiKey: false, hasHfToken: false, ...over });

function make(over: { settings?: Partial<DictationSettings>; heard?: string; cleaned?: CleanupResult } = {}) {
  const calls: unknown[][] = [];
  const deps: DictateDeps = {
    getSettings: () => settings(over.settings),
    transcribe: async (wav, s, opts) => {
      calls.push(['transcribe', wav, s.language, opts]);
      return { text: over.heard ?? '안녕하세요', language: 'ko', detected: 'ko' };
    },
    isHallucination,
    cleanup: async (raw, opts) => {
      calls.push(['cleanup', raw, opts]);
      return over.cleaned ?? { text: '안녕하세요.', provider: 'codex', chunks: 1, error: null };
    },
    apiKey: () => 'sk-x',
    paste: async (text, bin) => {
      calls.push(['paste', text, bin]);
      return 'pasted';
    },
  };
  const stages: string[] = [];
  const run = (opts: { peak?: number; voicedMs?: number } = {}) => createDictate(deps)('/m.wav', { helperBin: '/h', peak: opts.peak ?? 0.5, voicedMs: opts.voicedMs, onStage: (e) => stages.push(e.stage) });
  return { run, calls, stages };
}

const timingShape = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, expect.any(Number)]));

describe('dictate', () => {
  it('거의 무음(peak < 0.01)이거나 말소리가 0.3초보다 짧으면 Whisper를 돌리지 않는다', async () => {
    for (const opts of [{ peak: 0.009 }, { voicedMs: 299 }]) {
      const m = make();
      expect(await m.run(opts)).toEqual({ status: 'silent' });
      expect(m.calls).toEqual([]);
      expect(m.stages).toEqual([]);
    }
    const m = make({ settings: { cleanup: false } });
    expect((await m.run({ peak: 0.01, voicedMs: 300 })).status).toBe('pasted');
  });

  it('지어낸 문장(또는 빈 글)뿐이면 empty, 다듬기·붙여 넣기 없음', async () => {
    for (const heard of ['감사합니다.', '']) {
      const m = make({ heard });
      expect(await m.run()).toEqual({ status: 'empty', raw: heard, timing: timingShape(['transcribeMs']) });
      expect(m.calls.map((c) => c[0])).toEqual(['transcribe']);
      expect(m.stages).toEqual(['transcribe']);
    }
  });

  it('다듬기 켬: 지금 설정의 계정·API 키로 다듬어 붙인다', async () => {
    const m = make({ settings: { provider: 'claude-code' } });
    expect(await m.run({ voicedMs: 2000 })).toEqual({
      status: 'pasted',
      raw: '안녕하세요',
      text: '안녕하세요.',
      language: 'ko',
      detected: 'ko',
      cleaned: true,
      cleanupProvider: 'codex',
      cleanupChunks: 1,
      cleanupError: null,
      timing: timingShape(['transcribeMs', 'cleanupMs', 'pasteMs']),
    });
    expect(m.calls).toEqual([
      ['transcribe', '/m.wav', 'ko', { voicedMs: 2000 }],
      ['cleanup', '안녕하세요', { provider: 'claude-code', apiKey: 'sk-x' }],
      ['paste', '안녕하세요.', '/h'],
    ]);
    expect(m.stages).toEqual(['transcribe', 'cleanup', 'paste']);
  });

  it('다듬기 실패(계정 없음)는 받아쓴 글 그대로 붙이고 오류를 돌려준다, chunks가 없으면 0', async () => {
    const m = make({ cleaned: { text: '안녕하세요', provider: null, error: '계정 없음' } });
    expect(await m.run()).toMatchObject({ status: 'pasted', text: '안녕하세요', cleaned: false, cleanupProvider: null, cleanupChunks: 0, cleanupError: '계정 없음' });
  });

  it('다듬기 끔: 받아쓴 글 그대로, 다듬기 칸은 비고 cleanupMs 없음', async () => {
    const m = make({ settings: { cleanup: false } });
    expect(await m.run()).toEqual({
      status: 'pasted',
      raw: '안녕하세요',
      text: '안녕하세요',
      language: 'ko',
      detected: 'ko',
      cleaned: false,
      cleanupProvider: null,
      cleanupChunks: 0,
      cleanupError: null,
      timing: timingShape(['transcribeMs', 'pasteMs']),
    });
    expect(m.calls.map((c) => c[0])).toEqual(['transcribe', 'paste']);
    expect(m.calls[0]?.[3]).toEqual({ voicedMs: Infinity }); // 말소리 길이를 안 주면 끝없음
    expect(m.stages).toEqual(['transcribe', 'paste']);
  });
});
