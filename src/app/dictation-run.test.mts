// 받아쓰기 처리 (dictation-run.mts) — 가짜 받아쓰기로 기록 한 줄·임시 음성 지우기·단계 알림·다시 붙여넣기를 본다
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import type { DictateResult, DictationSettings } from '../dictation/index.mjs';
import { countWords, registerDictationRun, type DictationJob, type DictationLogEntry, type DictationRun, type DictationRunContext } from './dictation-run.mjs';
import type { DictationItem, FolderItem } from './history.mjs';

let root: string;
let temp: string;
let ipc: FakeIpc;
let calls: unknown[][];
let sent: [string, unknown][];
let overlay: [string, unknown][];
let dictate: (wav: string, opts: { onStage?: (e: { stage: 'transcribe' | 'cleanup' | 'paste' }) => void }) => Promise<DictateResult>;
let history: (DictationItem | FolderItem)[];
let run: DictationRun;

const LOG = () => path.join(root, 'dictations.jsonl');
const logLines = (): DictationLogEntry[] => fs.readFileSync(LOG(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

beforeEach(() => {
  root = path.join(tmpDir('mr-dictrun-'), 'rec'); // 아직 없는 녹음 폴더 (기록할 때 만든다)
  temp = tmpDir('mr-dictrun-temp-');
  calls = [];
  sent = [];
  overlay = [];
  history = [];
  ipc = fakeIpc();
  const ctx: DictationRunContext = {
    dictation: {
      dictate: (wav, opts) => (calls.push(['dictate', wav, opts.helperBin, opts.peak, opts.voicedMs]), dictate(wav, opts)),
      getSettings: () => ({ language: 'auto' }) as DictationSettings,
      paste: async (text, bin) => (calls.push(['paste', text, bin]), 'pasted'),
    },
    fn: { dictationHandedOff: () => void calls.push(['handedOff']) },
    recordingsDir: () => root,
    dictationLog: LOG,
    helperPath: (name) => `/native/${name}`,
    listHistory: (limit) => (calls.push(['listHistory', limit]), history),
    send: (channel, payload) => void sent.push([channel, payload]),
    sendOverlay: (channel, payload) => void overlay.push([channel, payload]),
    sendOverlayState: () => void calls.push(['overlayState', run.transcribing()]),
    updateTray: () => void calls.push(['updateTray']),
    hideWindow: () => void calls.push(['hideWindow']),
    showOverlay: () => void calls.push(['showOverlay']),
    app: { hide: () => void calls.push(['app.hide']) },
    clipboard: { writeText: (t) => void calls.push(['clipboard', t]) },
    selftest: false,
    log: () => {},
  };
  run = registerDictationRun(ipc, ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

// 받아쓰기 녹음 하나 (임시 폴더의 mic.wav)
const job = (over: Partial<DictationJob> = {}): DictationJob => {
  const dir = path.join(temp, '2026-01-01_09-00-00_memo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mic.wav'), 'RIFF');
  return { dir, peak: 0.5, voicedMs: 1234.567, startedAt: new Date('2026-01-01T00:00:00Z'), durationSec: 6, rec: { app: { name: '메모장', bundleId: 'x.notes' } }, ...over };
};

const PASTED: DictateResult = {
  status: 'pasted', raw: '음 안녕하세요 여러분', text: '안녕하세요, 여러분.', language: 'ko', detected: 'ko',
  cleaned: true, cleanupProvider: 'codex', cleanupChunks: 1, cleanupError: null, timing: { transcribeMs: 10, cleanupMs: 20, pasteMs: 3 },
};

describe('받아쓰기 처리', () => {
  it('받아쓰고 기록에 한 줄 남긴 뒤 임시 음성을 지운다', async () => {
    dictate = async (_wav, opts) => {
      opts.onStage?.({ stage: 'cleanup' });
      return PASTED;
    };
    const j = job();
    await run.runDictation(j);
    expect(calls[0]).toEqual(['handedOff']);
    expect(calls).toContainEqual(['dictate', path.join(j.dir, 'mic.wav'), '/native/permissions', 0.5, 1234.567]);
    expect(fs.existsSync(j.dir)).toBe(false);
    expect(logLines()).toEqual([{
      id: '2026-01-01_09-00-00_memo',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationSec: 6,
      voicedSec: 1.23,
      status: 'pasted',
      app: '메모장',
      bundleId: 'x.notes',
      language: 'ko',
      languageSetting: 'auto',
      raw: '음 안녕하세요 여러분',
      text: '안녕하세요, 여러분.',
      chars: 11,
      words: 2,
      rawWords: 3,
      wpm: 20,
      cleaned: true,
      cleanupProvider: 'codex',
      cleanupChunks: 1,
      cleanupError: null,
      error: null,
      timing: { transcribeMs: 10, cleanupMs: 20, pasteMs: 3 },
    }]);
    // 단계: 화면에 먼저 '인식', 받아쓰기가 알린 단계는 독과 화면 둘 다, 끝은 독에 결과·화면에 dict:result
    expect(sent).toEqual([
      ['dict:stage', { stage: 'transcribe' }],
      ['dict:stage', { stage: 'cleanup' }],
      ['dict:result', { id: '2026-01-01_09-00-00_memo', ...PASTED }],
    ]);
    expect(overlay).toEqual([
      ['overlay:stage', { stage: 'cleanup' }],
      ['overlay:stage', { stage: 'done', status: 'pasted', text: '안녕하세요, 여러분.', error: null }],
    ]);
    // 받아쓰는 동안 수가 하나, 끝나면 0 (독 상태를 그때마다 보낸다)
    expect(calls.filter((c) => c[0] === 'overlayState')).toEqual([['overlayState', 1], ['overlayState', 0]]);
    expect(calls.at(-1)).toEqual(['updateTray']);
  });

  it('말소리가 없으면(silent) 칸은 비고, 앞 앱이 없으면 null', async () => {
    dictate = async () => ({ status: 'silent' });
    await run.runDictation(job({ rec: { app: null }, durationSec: 0 }));
    expect(logLines()[0]).toMatchObject({ status: 'silent', app: null, bundleId: null, language: 'auto', raw: null, text: null, chars: 0, words: 0, rawWords: 0, wpm: null, cleaned: false, cleanupProvider: null, cleanupChunks: 0, timing: null });
    expect(overlay.at(-1)).toEqual(['overlay:stage', { stage: 'done', status: 'silent', text: null, error: null }]);
  });

  it('지어낸 문장뿐(empty)이면 raw로 센다', async () => {
    dictate = async () => ({ status: 'empty', raw: '감사합니다', timing: { transcribeMs: 5 } });
    await run.runDictation(job());
    expect(logLines()[0]).toMatchObject({ status: 'empty', raw: '감사합니다', text: null, chars: 5, words: 1, wpm: 10 });
  });

  it('받아쓰기가 던지면 error로 기록하고 음성은 그래도 지운다', async () => {
    dictate = async () => {
      throw new Error('서버가 없음');
    };
    const j = job();
    await run.runDictation(j);
    expect(logLines()[0]).toMatchObject({ status: 'error', error: '서버가 없음', text: null });
    expect(fs.existsSync(j.dir)).toBe(false);
    expect(run.transcribing()).toBe(0);
    expect(overlay.at(-1)).toEqual(['overlay:stage', { stage: 'done', status: 'error', text: null, error: '서버가 없음' }]);
  });

  it('메뉴바의 마지막 받아쓰기 붙여넣기: 이번 실행에서 받아쓴 글, 없으면 기록에서 찾는다', async () => {
    history = [
      { id: 'm', mode: 'meeting', transcript: null } as FolderItem,
      { id: 'd1', mode: 'memo', transcript: { raw: '날것만' } } as DictationItem,
      { id: 'd2', mode: 'memo', transcript: { raw: 'x', text: '더 오래된' } } as DictationItem,
    ];
    run.pasteLast();
    expect(calls).toEqual([['listHistory', 50], ['paste', '날것만', '/native/permissions']]);
    calls = [];
    history = [];
    run.pasteLast(); // 아무것도 없으면 붙이지 않는다
    expect(calls).toEqual([['listHistory', 50]]);
    calls = [];
    dictate = async () => PASTED;
    await run.runDictation(job());
    calls = [];
    run.pasteLast();
    expect(calls).toEqual([['paste', '안녕하세요, 여러분.', '/native/permissions']]); // 기록은 읽지 않는다
  });

  it('dict:delete: 그 id의 줄만 빼고 다시 쓴다', async () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(LOG(), ['{"id":"a","text":"1"}', '{"id":"b","text":"2"}', '{"id":"c","text":"\\"id\\":\\"b\\""}', ''].join('\n'));
    await ipc.invoke('dict:delete', 'b');
    expect(fs.readFileSync(LOG(), 'utf8')).toBe('{"id":"a","text":"1"}\n{"id":"c","text":"\\"id\\":\\"b\\""}\n');
  });

  it('dict:repaste: 창을 숨기고 0.35초 뒤 붙인 다음 독을 다시 보인다', async () => {
    vi.useFakeTimers();
    const p = ipc.invoke('dict:repaste', '다시');
    expect(calls[0]).toEqual(['hideWindow']);
    await vi.advanceTimersByTimeAsync(349);
    expect(calls.some((c) => c[0] === 'paste')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe('pasted');
    expect(calls.filter((c) => c[0] !== 'app.hide')).toEqual([['hideWindow'], ['paste', '다시', '/native/permissions'], ['showOverlay']]);
  });

  it('clipboard:write', async () => {
    await ipc.invoke('clipboard:write', '복사');
    expect(calls).toEqual([['clipboard', '복사']]);
  });

  it('낱말 세기', () => {
    expect(countWords(' 가 나  다\n라 ')).toBe(4);
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
  });
});
