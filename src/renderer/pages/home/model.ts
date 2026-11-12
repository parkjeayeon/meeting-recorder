// 홈에 보일 것을 계산한다 (그리기와 따로라 시험하기 쉽다). 값은 상태 주인(옛 화면 코드)이 준 그대로 읽기만 한다.
import { dictSummary, type DictRecord, type DictSummary, type DictTotals } from '../../entities/dictation/index.ts';
import { BUSY, canCompressNow, meetState, meetTitle, type MeetingItem } from '../../entities/meeting/index.ts';
import type { Issue } from '../../entities/issue/index.ts';
import { dayKey, sizeLabel } from '../../shared/lib/index.ts';

export interface HomeInput {
  readonly meetings: readonly MeetingItem[];
  readonly dictations: readonly DictRecord[];
  readonly totals: DictTotals | null;
  readonly issues: readonly (readonly [string, Issue])[];
  /** 녹음 폴더에 있지만 목록에 안 나오는 폴더 개수 */
  readonly strayCount: number;
  readonly freshId: string | null;
  readonly showMarks: boolean;
  readonly openRaw: ReadonlySet<string>;
}

export type MeetFilter = 'hand' | 'rest' | 'all';
export type TodoRow = { readonly mark: 'open' | 'fail' | 'ok' | 'plain'; readonly n: number; readonly title: string; readonly sub: string } & (
  | { readonly go: 'meetings'; readonly filter: MeetFilter }
  | { readonly go: 'meeting'; readonly id: string }
);
export interface Step {
  readonly key: 'perms' | 'dictate' | 'meeting';
  readonly done: boolean;
  readonly title: string;
  readonly text: string;
  readonly action: string;
}
export interface Storage {
  readonly total: number;
  readonly wav: { readonly n: number; readonly bytes: number };
  readonly packed: { readonly n: number; readonly bytes: number };
  /** 압축하면 줄어드는 크기 */
  readonly save: number;
  /** 압축할 수 있는 녹음 (큰 것부터) 중 보여 줄 것 */
  readonly shown: readonly MeetingItem[];
  readonly todoCount: number;
  /** 압축하지 않는 원본 (16kHz·그대로 두기·짧은 녹음) */
  readonly keep: number;
}
export interface HomeView {
  readonly greeting: string;
  readonly summary: DictSummary;
  readonly todayMeets: number;
  readonly busy: readonly MeetingItem[];
  readonly todo: readonly TodoRow[];
  readonly recentMeets: readonly MeetingItem[];
  readonly recentDicts: readonly DictRecord[];
  /** 다 했으면 null (시작하기 칸을 숨긴다) */
  readonly steps: readonly Step[] | null;
  readonly storage: Storage | null;
}

export function greeting(now = new Date()): string {
  const hr = now.getHours();
  if (hr >= 5 && hr < 11) return '좋은 아침이에요';
  if (hr >= 11 && hr < 17) return '좋은 오후예요';
  if (hr >= 17 && hr < 23) return '좋은 저녁이에요';
  return '늦게까지 수고 많아요';
}

const isBusy = (r: MeetingItem) => r.minutes?.status !== undefined && BUSY.includes(r.minutes.status);

function todoRows(meets: readonly MeetingItem[], strayCount: number): TodoRow[] {
  const rows: TodoRow[] = [];
  const hand = meets.filter((r) => ['open', 'draft'].includes(meetState(r)));
  if (hand.length) {
    const names = hand.slice(0, 2).map(meetTitle).join(' · ') + (hand.length > 2 ? ` 외 ${hand.length - 2}개` : '');
    rows.push({ mark: 'open', n: hand.length, title: '확인할 회의', sub: names, go: 'meetings', filter: 'hand' });
  }
  const rest = meets.filter((r) => ['fail', 'none'].includes(meetState(r)));
  if (rest.length) rows.push({ mark: 'fail', n: rest.length, title: '회의록이 없는 녹음', sub: '실패했거나 녹음만 저장된 회의 — 다시 만들 수 있습니다', go: 'meetings', filter: 'rest' });
  const ready = meets.filter(canCompressNow);
  if (ready.length) {
    const sum = (k: 'bytes' | 'estimate') => ready.reduce((n, r) => n + (r.audio?.[k] ?? 0), 0);
    rows.push({ mark: 'ok', n: ready.length, title: '압축할 수 있는 녹음', sub: `확인을 마친 회의 · ${sizeLabel(sum('bytes'))} → 약 ${sizeLabel(sum('estimate'))}`, go: 'meeting', id: ready[0]!.id });
  }
  if (strayCount) rows.push({ mark: 'plain', n: strayCount, title: '목록에 없는 폴더', sub: '녹음 폴더에 회의로 열리지 않는 폴더가 있습니다 — 지울지 골라 주세요', go: 'meetings', filter: 'all' });
  return rows;
}

// 녹음 공간: 전체 크기, 원본(WAV)·압축 개수와 크기, 그리고 압축할 수 있는 녹음만 (16kHz·그대로 두기·1MB 미만 짧은 녹음은 목록에 올리지 않는다)
function storage(meets: readonly MeetingItem[]): Storage | null {
  const rec = meets.filter((r) => (r.audio?.bytes ?? 0) > 0);
  if (!rec.length) return null;
  const wav = rec.filter((r) => r.audio!.wav);
  const packed = rec.filter((r) => !r.audio!.wav);
  const sum = (list: readonly MeetingItem[]) => list.reduce((n, r) => n + (r.audio!.bytes ?? 0), 0);
  // 압축 안내는 회의록이 있는 회의에만 뜬다 → 회의록을 만드는 중이거나 만든 회의만 (짧은 녹음·실패·녹음만은 빼고)
  const todo = wav
    .filter((r) => r.audio!.supported && !r.audio!.declined && r.audio!.bytes >= 1e6 && (r.minutes?.status === 'done' || isBusy(r)))
    .sort((a, b) => b.audio!.bytes - a.audio!.bytes);
  return {
    total: sum(rec),
    wav: { n: wav.length, bytes: sum(wav) },
    packed: { n: packed.length, bytes: sum(packed) },
    save: todo.reduce((n, r) => n + Math.max(0, r.audio!.bytes - (r.audio!.estimate ?? 0)), 0),
    shown: todo.slice(0, 6),
    todoCount: todo.length,
    keep: wav.length - todo.length,
  };
}

// 홈: 왼쪽은 할 일(만드는 중 → 챙길 일 → 최근 회의 → 최근 받아쓰기), 오른쪽은 살펴볼 것(시작하기 → 녹음 공간).
export function homeView(input: HomeInput, now = new Date()): HomeView {
  const meets = input.meetings;
  const steps: Step[] = [
    { key: 'perms', done: !input.issues.some(([, i]) => i.sec === 'perms'), title: '권한 허용', text: '마이크·입력 모니터링·손쉬운 사용', action: '권한 보기' },
    { key: 'dictate', done: input.dictations.length > 0, title: 'fn으로 받아쓰기', text: '입력칸에서 fn을 꾹 누른 채 말하고 떼기', action: '설정 보기' },
    { key: 'meeting', done: meets.some((m) => m.minutes?.status === 'done'), title: '회의 녹음', text: '위쪽 회의 녹음 → 끝나면 회의록', action: '녹음 시작' },
  ];
  return {
    greeting: greeting(now),
    summary: dictSummary(input.dictations, input.totals, now),
    todayMeets: meets.filter((m) => dayKey(m.startedAt) === now.toDateString()).length,
    busy: meets.filter(isBusy),
    todo: todoRows(meets, input.strayCount),
    recentMeets: meets.filter((m) => !['short', 'empty', 'busy'].includes(meetState(m))).slice(0, 5), // 몇 초짜리 시험 녹음은 홈에 올리지 않는다
    recentDicts: input.dictations.slice(0, 4),
    steps: steps.every((s) => s.done) ? null : steps,
    storage: storage(meets),
  };
}
