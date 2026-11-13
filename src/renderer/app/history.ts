import type { DictRecord, DictTotals } from '../entities/dictation/index.ts';
import type { MeetingItem } from '../entities/meeting/index.ts';
import type { Stray } from '../pages/meetings/index.ts';
import type { RecorderApi } from '../shared/api/index.ts';

export type HistoryApi = Pick<RecorderApi, 'history' | 'recordingsAccess' | 'strayFolders' | 'dictStats' | 'onRecordingsChanged'>;
export type HistoryRow = MeetingItem & Partial<Omit<DictRecord, 'transcript'>> & {
  readonly mode?: string;
  readonly transcript?: DictRecord['transcript'] | null;
};
export interface RecordingsAccess {
  readonly ok: boolean;
  readonly dir: string;
  readonly code?: string | null;
}
export interface HistoryState {
  readonly rows: readonly HistoryRow[];
  readonly strays: readonly Stray[]; // 녹음 폴더에 있지만 목록에 안 나오는 폴더 (recordings:stray)
  readonly totals: DictTotals | null; // 본체가 전체 받아쓰기 기록으로 계산한 통계 (dict:stats)
  readonly access: RecordingsAccess | null | undefined;
}
export interface HistoryStore {
  readonly getSnapshot: () => HistoryState;
  readonly subscribe: (fn: () => void) => () => void;
  readonly reload: () => Promise<void>;
  readonly connect: () => void;
}

export function createHistoryStore(api: HistoryApi): HistoryStore {
  let state: HistoryState = { rows: [], strays: [], totals: null, access: null };
  const subs = new Set<() => void>();
  let connected = false;
  const reload = async (): Promise<void> => {
    const [rows, access, stray, totals] = await Promise.all([api.history(), api.recordingsAccess(), api.strayFolders(), api.dictStats()]);
    state = { rows, strays: stray ?? [], totals: totals ?? null, access };
    for (const fn of subs) fn();
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reload,
    connect: () => {
      if (connected) return;
      connected = true;
      api.onRecordingsChanged(() => reload());
    },
  };
}
