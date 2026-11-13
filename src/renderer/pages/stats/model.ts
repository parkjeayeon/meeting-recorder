// 통계 화면에 보일 값 (순수 계산). 입력은 상태 주인이 창구로 넘겨준 값.
import { charsOf, dictSummary, type DictItem, type DictSummary, type DictTotals } from '../../entities/dictation/index.ts';

/** 회의 기록 하나 — 여기서 쓰는 칸만 */
export interface MeetingItem {
  readonly durationSec?: number;
  readonly minutes?: { readonly status?: string; readonly timing?: { readonly transcribeMs?: number; readonly writeMs?: number } } | null;
}
export interface StatsInput {
  readonly dictations: readonly DictItem[];
  readonly totals: DictTotals | null;
  readonly meetings: readonly MeetingItem[];
}
export interface StatsDay {
  readonly d: Date;
  readonly chars: number;
  readonly count: number;
}
export interface StatsView {
  readonly summary: DictSummary;
  readonly meetSec: number;
  readonly meetCount: number;
  readonly empty: boolean;
  readonly days: readonly StatsDay[]; // 최근 14일, 오래된 날부터
  readonly apps: readonly (readonly [string, number])[];
  readonly languages: readonly { readonly language: string; readonly chars: number; readonly count: number }[];
  readonly asrMs: number | null;
  readonly cleanup: readonly { readonly provider: string; readonly avgMs: number; readonly count: number }[];
  /** 회의록을 만드는 데 녹음 1시간당 걸린 초 (1분 넘는 회의만) */
  readonly perHourSec: number | null;
}

const avg = (list: readonly number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

export function statsView({ dictations, totals, meetings }: StatsInput, now = new Date()): StatsView {
  const days = totals
    ? totals.days.map((x) => {
      const [y, m, dd] = x.date.split('-').map(Number) as [number, number, number];
      return { d: new Date(y, m - 1, dd), chars: x.chars, count: x.count };
    })
    : Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - 13 + i);
      const list = dictations.filter((r) => new Date(r.startedAt).toDateString() === d.toDateString());
      return { d, chars: list.reduce((n, r) => n + charsOf(r), 0), count: list.length };
    });
  const done = meetings.filter((m) => m.minutes?.status === 'done');
  return {
    summary: dictSummary(dictations, totals, now),
    meetSec: meetings.reduce((n, m) => n + (m.durationSec ?? 0), 0),
    meetCount: meetings.length,
    empty: !(totals?.count ?? dictations.length),
    days,
    apps: totals ? totals.apps.map((a) => [a.app, a.chars] as const) : [],
    languages: totals?.languages ?? [],
    asrMs: totals?.asrMs ?? null,
    cleanup: totals?.cleanup ?? [],
    perHourSec: avg(done.filter((m) => m.minutes?.timing?.transcribeMs && (m.durationSec ?? 0) > 60).map((m) => (m.minutes!.timing!.transcribeMs! + (m.minutes!.timing!.writeMs ?? 0)) / 1000 / ((m.durationSec ?? 0) / 3600))),
  };
}
