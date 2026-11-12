// 받아쓰기 기록 요약 (홈의 한 줄·통계 화면 위 칸). 본체가 전체 기록으로 계산한 통계(totals)가 있으면 그것을,
// 없으면 화면이 받은 최근 기록으로 센다 (화면이 받는 기록은 최근 300개뿐이라 오래된 기록이 빠진다)
import type { DictationStats } from '../../../core/dictlog.mts';

/** 화면이 받은 받아쓰기 기록 하나 (history의 mode: 'memo') — 여기서 쓰는 칸만 */
export interface DictItem {
  readonly startedAt: string;
  readonly chars?: number;
  readonly wpm?: number;
  readonly transcript: { readonly text?: string; readonly raw?: string };
}
export type DictTotals = DictationStats;
export interface DictSummary {
  readonly total: number;
  readonly today: number;
  readonly todayCount: number;
  readonly wpm: number | null;
  readonly streak: number;
}

export const charsOf = (r: DictItem): number => r.chars ?? (r.transcript.text ?? r.transcript.raw ?? '').length;
const dayKey = (d: string | Date) => new Date(d).toDateString();

export function dictSummary(items: readonly DictItem[], totals: DictTotals | null, now = new Date()): DictSummary {
  if (totals) return { total: totals.total, today: totals.today, todayCount: totals.todayCount, wpm: totals.wpm, streak: totals.streak };
  const today = items.filter((r) => dayKey(r.startedAt) === now.toDateString());
  const wpms = items.map((r) => r.wpm ?? 0).filter((w) => w > 0);
  const days = new Set(items.map((r) => dayKey(r.startedAt)));
  let streak = 0;
  const d = new Date(now);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // 오늘 아직 안 썼으면 어제부터 센다
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return {
    total: items.reduce((n, r) => n + charsOf(r), 0),
    today: today.reduce((n, r) => n + charsOf(r), 0),
    todayCount: today.length,
    wpm: wpms.length ? Math.round(wpms.reduce((a, b) => a + b, 0) / wpms.length) : null,
    streak,
  };
}
