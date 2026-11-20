// ── 기록 (녹음 폴더를 읽어 창에 보여 준다) ─────────────────────────────────
// src/main.js에서 옮김 (결정 70). 받아쓰기 기록·통계를 읽어 둔 것(dictCache·statsCache)은 이 구역만 써서 같이 옮겼다.
// 녹음 폴더·받아쓰기 기록 경로·녹음 중인 폴더·회의록을 만드는 중인 회의·인터넷을 기다리는 회의는 본체가 갖고 있어 부를 때 읽는다.
// 본체도 쓰는 목록(listFolders: 질문으로 찾기, listHistory: 메뉴바의 '마지막 받아쓰기 붙여넣기')은 돌려준다.
import path from 'node:path';
import fs from 'node:fs';
import * as core from '../core/index.mjs';
import type { DictRecord } from '../core/index.mjs';
import type { Ipc } from './ipc.mjs';

// meta.json 중 여기서 읽는 것
export interface FolderMeta {
  mode?: string;
  startedAt?: string;
  files?: Record<string, { file?: string; durationSec?: number }>;
  speakers?: number | string | null;
  speakerNames?: Record<string, string>;
}

// minutes.json (회의록 만들기 상태)
export interface MinutesState {
  status?: string;
  stage?: string;
  error?: string | null;
  offline?: boolean;
  title?: string | null;
  [k: string]: unknown;
}

// 화면이 쓰는 회의 기록 항목 (history:list)
export interface FolderItem {
  id: string;
  dir: string;
  mode: string | undefined;
  startedAt: string | undefined;
  durationSec: number;
  tracks: string[];
  speakersHint: number | string | null;
  firstFile: string | null;
  transcript: unknown;
  minutes: MinutesState | null;
  summary: string | null;
  review: ReturnType<typeof core.reviewSummary>;
  audio: unknown;
}

// 화면이 쓰는 받아쓰기 기록 항목 (회의 기록과 같은 history 항목)
export interface DictationItem {
  id: string;
  mode: 'memo';
  startedAt: string;
  durationSec: number | undefined;
  app: string | null | undefined;
  words: number | undefined;
  chars: number | undefined;
  wpm: number | undefined;
  language: string | null;
  transcript: Pick<DictRecord, 'raw' | 'text' | 'cleanupProvider' | 'cleanupError' | 'timing'>;
}

export interface HistoryContext {
  recordingsDir: () => string; // 지금 녹음 폴더 (RECORDINGS_DIR)
  dictationLog: () => string; // 받아쓰기 기록 파일 (DICTATION_LOG)
  recording: () => { dir: string } | null; // 녹음 중인 폴더는 '목록에 안 나오는 폴더'에서 뺀다
  activeMinutes: ReadonlySet<string>;
  waitingOnline: ReadonlySet<string>;
  waitForOnline: (dir: string) => void; // 인터넷이 끊겨 멈춘 회의는 연결을 기다렸다가 이어서 쓴다
  readJson: (file: string) => unknown; // 없거나 깨졌으면 null
  compress: { audioInfo(dir: string, meta: FolderMeta): unknown };
}

export interface History {
  dictationRecords: () => DictRecord[];
  listHistory: (limit?: number) => (DictationItem | FolderItem)[];
  listFolders: (limit?: number) => FolderItem[];
}

export function registerHistory(ipc: Ipc, ctx: HistoryContext): History {
  // 받아쓰기 기록 전체 (최신순). 파일이 그대로면 읽어 둔 것을 쓴다 (찾기·나눠 보기·통계가 부를 때마다 다시 읽지 않게)
  let dictCache: { key: string | null; records: DictRecord[] } = { key: null, records: [] };
  function dictationRecords(): DictRecord[] {
    let key: string | null = null;
    try {
      const st = fs.statSync(ctx.dictationLog());
      key = `${ctx.dictationLog()}:${st.size}:${st.mtimeMs}`;
    } catch {
      return [];
    }
    if (dictCache.key !== key) {
      let text = '';
      try {
        text = fs.readFileSync(ctx.dictationLog(), 'utf8');
      } catch {}
      dictCache = { key, records: core.parseDictationLog(text) }; // 말이 없었거나 지어낸 문장으로 걸러진 시도는 빼고
    }
    return dictCache.records;
  }
  // 화면이 쓰는 모양 (회의 기록과 같은 history 항목)
  const dictationItem = (d: DictRecord): DictationItem => ({
    id: d.id,
    mode: 'memo',
    startedAt: d.startedAt,
    durationSec: d.durationSec,
    app: d.app,
    words: d.words,
    chars: d.chars,
    wpm: d.wpm,
    language: d.language ?? null,
    transcript: { raw: d.raw, text: d.text, cleanupProvider: d.cleanupProvider, cleanupError: d.cleanupError, timing: d.timing },
  });

  // 회의 목록에 '초안 · 확인 N개' / '확정'을 표시하기 위한 요약
  // 받아쓰기는 최근 limit개, 회의는 모두 (전에는 둘을 합쳐 300개로 잘라 받아쓰기가 많으면 오래된 회의가 목록에서 조용히 빠졌다)
  function listHistory(limit = 300): (DictationItem | FolderItem)[] {
    const byTime = (a: { startedAt?: string | undefined }, b: { startedAt?: string | undefined }) => +new Date(b.startedAt as string) - +new Date(a.startedAt as string);
    const dicts = dictationRecords().slice(0, limit).map(dictationItem); // 홈·⌘K용 최근 것만. 받아쓰기 화면·통계는 dict:page·dict:stats로 전체를
    return [...dicts, ...listFolders()].sort(byTime);
  }

  function listFolders(limit?: number): FolderItem[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(ctx.recordingsDir()).filter((n) => /^\d{4}-\d{2}-\d{2}_/.test(n));
    } catch {}
    return names
      .sort()
      .reverse()
      .slice(0, limit)
      .map((name): FolderItem | null => {
        const dir = path.join(ctx.recordingsDir(), name);
        const meta = ctx.readJson(path.join(dir, 'meta.json')) as FolderMeta | null;
        if (!meta) return null; // 녹음 중이거나 깨진 폴더
        const transcript = ctx.readJson(path.join(dir, 'transcript.json'));
        let minutesState = ctx.readJson(path.join(dir, 'minutes.json')) as MinutesState | null;
        // 이전 실행에서 만들다 끊긴 회의록은 실패로 보여 줘서 다시 만들 수 있게 한다
        if (minutesState && ['queued', 'transcribe', 'write'].includes(minutesState.status as string) && !ctx.activeMinutes.has(dir)) {
          minutesState = { ...minutesState, status: 'error', stage: minutesState.status === 'write' ? 'write' : 'transcribe', error: '앱이 종료되어 중단됨' };
        }
        // 인터넷이 끊겨 멈춘 회의는 앱을 다시 켜도 연결을 기다렸다가 이어서 쓴다
        if (minutesState?.status === 'error' && minutesState.offline && !ctx.activeMinutes.has(dir) && !ctx.waitingOnline.has(dir)) ctx.waitForOnline(dir);
        const durationSec = core.durationOf(meta);
        const summary = core.readSummary(dir, meta.speakerNames);
        return {
          id: name,
          dir,
          mode: meta.mode,
          startedAt: meta.startedAt,
          durationSec,
          tracks: Object.keys(meta.files ?? {}),
          speakersHint: meta.speakers ?? null,
          firstFile: Object.values(meta.files ?? {})[0]?.file ?? null,
          transcript,
          minutes: minutesState,
          summary,
          review: core.reviewSummary(dir),
          audio: ctx.compress.audioInfo(dir, meta), // 녹음 크기·압축 여부 (확인을 마치면 압축 안내)
        };
      })
      .filter((x): x is FolderItem => Boolean(x));
  }

  ipc.handle('history:list', () => listHistory());
  // 녹음 폴더에 있지만 목록에 나오지 않는 폴더 (날짜를 못 읽은 이름·끊긴 녹음·깨진 meta.json). 화면에 표시해 지울 수 있게
  ipc.handle('recordings:stray', () => core.findStrayFolders(ctx.recordingsDir(), { skip: ctx.recording() ? [ctx.recording()!.dir] : [] }));
  // 녹음 폴더를 읽을 수 있는지. macOS가 문서 폴더 접근을 막으면(다시 설치해 서명이 바뀐 앱 등) 목록이 조용히 비므로 화면에 알린다
  ipc.handle('recordings:access', () => {
    try {
      fs.readdirSync(ctx.recordingsDir());
      return { ok: true, dir: ctx.recordingsDir() };
    } catch (err) {
      return { ok: false, dir: ctx.recordingsDir(), code: (err as NodeJS.ErrnoException).code ?? null };
    }
  });
  // 받아쓰기 기록: 최신순으로 나눠 받기(찾기는 전체에서), 통계는 전체 기록으로
  ipc.handle('dict:page', (_e, opts) => {
    const page = core.pageDictations(dictationRecords(), (opts as Parameters<typeof core.pageDictations>[1]) ?? {});
    return { ...page, items: page.items.map(dictationItem) };
  });
  // 통계는 기록 파일이 바뀔 때만 다시 센다 (기록을 읽을 때마다 화면이 부른다). 날이 바뀌면 오늘·연속 사용일이 달라지므로 날짜도 열쇠에
  let statsCache: { key: string | null; value: core.DictationStats | null } = { key: null, value: null };
  ipc.handle('dict:stats', () => {
    const records = dictationRecords();
    const key = `${dictCache.key}|${new Date().toDateString()}`;
    if (statsCache.key !== key) statsCache = { key, value: core.dictationStats(records) };
    return statsCache.value;
  });

  return { dictationRecords, listHistory, listFolders };
}
