import { describe, expect, it } from 'vitest';
import { statsView } from './model.ts';
import { dictSummary } from '../../entities/dictation/index.ts';

const now = new Date(2026, 10, 12, 15);
const memo = (daysAgo: number, chars: number, wpm = 120) => ({ startedAt: new Date(2026, 10, 12 - daysAgo, 10).toISOString(), chars, wpm, transcript: { raw: 'x', text: 'x' } });

describe('통계 계산', () => {
  it('본체 전체 통계가 없으면 받은 기록으로: 오늘·연속 사용일(오늘 안 썼으면 어제부터)', () => {
    const s = dictSummary([memo(1, 10), memo(2, 20), memo(4, 5)], null, now);
    expect(s).toEqual({ total: 35, today: 0, todayCount: 0, wpm: 120, streak: 2 });
  });
  it('본체 전체 통계가 있으면 그것을 쓴다', () => {
    const totals = { count: 3, total: 999, today: 9, todayCount: 1, wpm: 80, streak: 5, days: [{ date: '2026-11-12', chars: 9, count: 1 }], apps: [{ app: 'Slack', chars: 9 }], languages: [], asrMs: 300, cleanup: [] };
    const v = statsView({ dictations: [], totals, meetings: [] }, now);
    expect(v.summary.total).toBe(999);
    expect(v.days).toHaveLength(1);
    expect(v.apps).toEqual([['Slack', 9]]);
    expect(v.empty).toBe(false);
  });
  it('회의: 녹음 시간 합, 1분 넘는 확정 회의만 1시간당 회의록 시간', () => {
    const meetings = [
      { durationSec: 3600, minutes: { status: 'done', timing: { transcribeMs: 600_000, writeMs: 60_000 } } },
      { durationSec: 30, minutes: { status: 'done', timing: { transcribeMs: 1000 } } },
      { durationSec: 100, minutes: { status: 'error' } },
    ];
    const v = statsView({ dictations: [], totals: null, meetings }, now);
    expect(v.meetSec).toBe(3730);
    expect(v.meetCount).toBe(3);
    expect(v.perHourSec).toBe(660);
    expect(v.empty).toBe(true);
    expect(v.days).toHaveLength(14);
  });
});
