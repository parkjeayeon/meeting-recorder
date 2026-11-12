// 회의 장부(줄 목록)의 계산: 줄마다 날짜 칸·흐림·부제, 달별 묶음과 바로가기의 해·달 (회의 목록과 질문 탭이 같이 쓴다)
import { meetState, type MeetingItem, type MeetState } from '../../entities/meeting/index.ts';
import { dayKey, WEEKDAY } from '../../shared/lib/index.ts';

export const NO_MINUTES: readonly MeetState[] = ['fail', 'none', 'short', 'empty'];

export interface LedgerRow {
  readonly r: MeetingItem;
  readonly st: MeetState;
  /** 그날 첫 줄 (날짜는 여기만) */
  readonly first: boolean;
  readonly weekend: boolean;
  /** 날짜 칸: 큰 글자와 작은 글자 ("11/4" + "화", "오늘" + "수") */
  readonly day: string;
  readonly small: string;
  readonly muted: boolean;
  /** 제목 아래: 실패면 이유(why), 아니면 요약 */
  readonly sub: { readonly why: boolean; readonly text: string } | null;
  readonly redo: boolean;
  readonly trash: boolean;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 장부 줄들. recent면 '오늘·어제·11/4' (달 제목이 없는 칸), 아니면 날짜 숫자만 (달 제목 아래) */
export function ledgerRows(list: readonly MeetingItem[], { recent = false, now = new Date() } = {}): LedgerRow[] {
  const t0 = startOfDay(now);
  return list.map((r, i) => {
    const at = new Date(r.startedAt);
    const prev = list[i - 1];
    const first = !prev || dayKey(prev.startedAt) !== dayKey(r.startedAt);
    const wk = at.getDay();
    const diff = Math.round((t0.getTime() - startOfDay(at).getTime()) / 864e5);
    const [day, small] = recent && diff <= 1 ? [diff ? '어제' : '오늘', WEEKDAY[wk]!]
      : [recent ? `${at.getFullYear() !== now.getFullYear() ? `${at.getFullYear()}. ` : ''}${at.getMonth() + 1}/${at.getDate()}` : String(at.getDate()), diff === 0 ? '오늘' : diff === 1 ? '어제' : WEEKDAY[wk]!];
    const st = meetState(r);
    return {
      r, st, first, day, small,
      weekend: wk === 0 || wk === 6,
      muted: !['done', 'open', 'draft', 'plain'].includes(st),
      sub: st === 'fail' ? { why: true, text: r.minutes?.error ?? '' } : r.summary ? { why: false, text: r.summary } : null,
      redo: st === 'fail' || st === 'none',
      trash: NO_MINUTES.includes(st),
    };
  });
}

export interface LedgerMonth {
  readonly id: string;
  readonly title: string;
  readonly label: string;
  /** "3건 · 1시간 20분" */
  readonly summary: string;
  readonly list: readonly MeetingItem[];
}
export interface LedgerYear {
  readonly year: number;
  /** 올해: 늘 펼침, 접는 화살표·개수 없음 */
  readonly current: boolean;
  readonly count: number;
  readonly months: readonly LedgerMonth[];
}

/** 달별 장부와 바로가기의 해 묶음 (목록 순서 그대로, 해·달이 바뀌면 새 묶음) */
export function monthGroups(list: readonly MeetingItem[], now = new Date()): LedgerYear[] {
  const years: { year: number; current: boolean; count: number; months: { id: string; title: string; label: string; list: MeetingItem[] }[] }[] = [];
  for (const r of list) {
    const at = new Date(r.startedAt);
    const y = at.getFullYear();
    const m = at.getMonth();
    let year = years.at(-1);
    if (year?.year !== y) {
      year = { year: y, current: y === now.getFullYear(), count: list.filter((x) => new Date(x.startedAt).getFullYear() === y).length, months: [] };
      years.push(year);
    }
    const id = `mon-${y}-${m + 1}`;
    if (year.months.at(-1)?.id !== id) year.months.push({ id, title: `${y}년 ${m + 1}월`, label: `${m + 1}월`, list: [] });
    year.months.at(-1)!.list.push(r);
  }
  return years.map((y) => ({
    ...y,
    months: y.months.map((mo) => {
      const total = mo.list.reduce((n, r) => n + r.durationSec, 0);
      return { ...mo, summary: `${mo.list.length}건 · ${Math.floor(total / 3600)}시간 ${Math.floor((total % 3600) / 60)}분` };
    }),
  }));
}
