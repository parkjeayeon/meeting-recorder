// 회의 목록의 계산: 갈래 칩, 거르기·검색, 확인할 회의 카드·최근 회의·이전 회의(달별) (결정 50)
// 기간이 아니라 개수로 자른다: 회의는 몰릴 때도 뜸할 때도 있다
import { meetState, type MeetingItem } from '../../entities/meeting/index.ts';
import { NO_MINUTES } from '../../widgets/meeting-ledger/index.ts';

export const HAND_MAX = 6;
export const RECENT_MAX = 20;

export type Filter = 'all' | 'final' | 'hand' | 'rest';
export const needsHand = (r: MeetingItem): boolean => ['busy', 'fail', 'none', 'open', 'draft'].includes(meetState(r));
export const FILTERS: readonly (readonly [Filter, string, (r: MeetingItem) => boolean])[] = [
  ['all', '전체', () => true],
  ['final', '확인 완료', (r) => ['done', 'plain'].includes(meetState(r))],
  ['hand', '확인할 회의', needsHand],
  ['rest', '녹음만 · 실패', (r) => NO_MINUTES.includes(meetState(r))],
];

/** 갈래 칩: 없는 갈래는 숨긴다 (전체와 지금 고른 갈래는 늘) */
export function chips(all: readonly MeetingItem[], filter: string): { id: Filter; label: string; n: number }[] {
  return FILTERS.map(([id, label, fn]) => ({ id, label, n: all.filter(fn).length })).filter((c) => c.id === 'all' || c.id === filter || c.n > 0);
}

/** 갈래와 검색어(제목·요약, 소문자)로 거른 회의 */
export function pick(all: readonly MeetingItem[], filter: Filter, q: string): MeetingItem[] {
  const fn = FILTERS.find((f) => f[0] === filter)![2];
  return all.filter(fn).filter((r) => !q || `${r.minutes?.title ?? ''} ${r.summary ?? ''}`.toLowerCase().includes(q));
}

/** 전체 갈래(검색 없음)의 세 칸 */
export interface Mixed {
  readonly hand: readonly MeetingItem[];
  /** "확인 남음 2 · 실패 1" */
  readonly kinds: string;
  /** 확인할 회의가 없을 때 마지막 확정 회의 */
  readonly lastDone: MeetingItem | null;
  readonly recent: readonly MeetingItem[];
  readonly older: readonly MeetingItem[];
}
export function mixed(items: readonly MeetingItem[]): Mixed {
  const hand = items.filter(needsHand);
  const kinds = ([['확인 남음', 'open'], ['마치기 전', 'draft'], ['실패', 'fail'], ['녹음만', 'none'], ['만드는 중', 'busy']] as const)
    .map(([label, st]) => [label, hand.filter((r) => meetState(r) === st).length] as const).filter(([, n]) => n)
    .map(([k, n]) => `${k} ${n}`).join(' · ');
  return { hand, kinds, lastDone: items.find((r) => meetState(r) === 'done') ?? null, recent: items.slice(0, RECENT_MAX), older: items.slice(RECENT_MAX) };
}
