// 받아쓰기 기록 화면의 계산: 날짜별 묶음과 위·아래 안내 글 (그리기와 따로라 시험하기 쉽다)
import type { DictRecord } from '../../entities/dictation/index.ts';
import { dayKey, dayLabel, fmt } from '../../shared/lib/index.ts';

/** 한 번에 받는 개수 (스크롤 끝 200px 전에 다음 묶음) */
export const DICT_PAGE = 30;

/** 본체 dictPage의 답 */
export interface DictPage {
  readonly items: readonly DictRecord[];
  readonly next: string | null;
  readonly total: number;
  readonly matched: number;
}

export interface DayGroup {
  readonly key: string;
  readonly label: string;
  /** "3건", 아직 다 받지 않은 마지막 날은 "3건+" */
  readonly count: string;
  readonly items: readonly DictRecord[];
}

export function dayGroups(items: readonly DictRecord[], more: boolean, now = new Date()): DayGroup[] {
  const groups: { key: string; label: string; items: DictRecord[] }[] = [];
  for (const r of items) {
    const k = dayKey(r.startedAt);
    if (groups.at(-1)?.key !== k) groups.push({ key: k, label: dayLabel(r.startedAt, now), items: [] });
    groups.at(-1)!.items.push(r);
  }
  // 같은 날이 떨어져 있으면(정렬이 어긋난 기록) 그 날의 전체 개수를 센다 — 옛 화면과 같게
  const perDay = new Map<string, number>();
  for (const r of items) perDay.set(dayKey(r.startedAt), (perDay.get(dayKey(r.startedAt)) ?? 0) + 1);
  const lastDay = items.length ? dayKey(items.at(-1)!.startedAt) : null;
  return groups.map((g) => ({ ...g, count: `${perDay.get(g.key)}건${more && g.key === lastDay ? '+' : ''}` }));
}

/** 목록 위 한 줄 */
export const countLine = (q: string, matched: number, total: number): string => (q ? `"${q}" ${fmt.format(matched)}개 · 전체 ${fmt.format(total)}개에서` : `전체 ${fmt.format(total)}개`);

/** 목록 아래 (이어 받는 중 / 다 봄) */
export function footText(q: string, shown: number, page: Pick<DictPage, 'next' | 'matched'>): string {
  if (page.next) return `${fmt.format(shown)} / ${fmt.format(page.matched)}개 · 더 불러오는 중…`;
  return shown > DICT_PAGE ? `${q ? '찾은' : '모든'} 받아쓰기 ${fmt.format(page.matched)}개를 다 보았습니다` : '';
}
