import { describe, expect, it } from 'vitest';
import type { MeetingItem } from '../../entities/meeting/index.ts';
import { ledgerRows, monthGroups } from './model.ts';

const now = new Date(2026, 10, 12, 15); // 목요일
const m = (y: number, mo: number, d: number, over: Partial<MeetingItem> = {}): MeetingItem => ({
  id: `${y}-${mo}-${d}-${Math.random()}`, startedAt: new Date(y, mo - 1, d, 10).toISOString(), durationSec: 1800,
  minutes: { status: 'done', title: '회의' }, review: { finalized: true }, summary: '요약', ...over,
});

describe('회의 장부 계산', () => {
  it('날짜는 그날 첫 줄에만, recent면 오늘·어제·월/일(지난 해는 해까지), 아니면 날짜 숫자와 요일', () => {
    const list = [m(2026, 11, 12), m(2026, 11, 12), m(2026, 11, 11), m(2026, 11, 8), m(2025, 12, 31)];
    expect(ledgerRows(list, { recent: true, now }).map((r) => [r.first, r.day, r.small])).toEqual([
      [true, '오늘', '목'], [false, '오늘', '목'], [true, '어제', '수'], [true, '11/8', '일'], [true, '2025. 12/31', '수'],
    ]);
    expect(ledgerRows(list, { now }).map((r) => [r.day, r.small])[0]).toEqual(['12', '오늘']);
    expect(ledgerRows([m(2026, 11, 8)], { now })[0]!.weekend).toBe(true);
  });
  it('실패면 이유, 아니면 요약. 회의록이 없으면 흐리게·휴지통, 실패·녹음만은 다시 만들기', () => {
    const [fail, none, done, short] = ledgerRows([
      m(2026, 11, 1, { minutes: { status: 'error', error: '앱이 종료되어 중단됨' } }),
      m(2026, 11, 1, { minutes: null, summary: undefined }),
      m(2026, 11, 1),
      m(2026, 11, 1, { minutes: { status: 'short' } }),
    ], { now });
    expect([fail!.sub, fail!.muted, fail!.redo, fail!.trash]).toEqual([{ why: true, text: '앱이 종료되어 중단됨' }, true, true, true]);
    expect([none!.sub, none!.redo, none!.trash]).toEqual([null, true, true]);
    expect([done!.sub, done!.muted, done!.redo, done!.trash]).toEqual([{ why: false, text: '요약' }, false, false, false]);
    expect([short!.redo, short!.trash]).toEqual([false, true]);
  });
  it('달별 묶음: 해마다, 달마다 건수·시간, 올해만 늘 펼침', () => {
    const ys = monthGroups([m(2026, 11, 3), m(2026, 11, 1, { durationSec: 5400 }), m(2026, 10, 9), m(2025, 12, 1)], now);
    expect(ys.map((y) => [y.year, y.current, y.count, y.months.map((mo) => [mo.id, mo.label, mo.summary])])).toEqual([
      [2026, true, 3, [['mon-2026-11', '11월', '2건 · 2시간 0분'], ['mon-2026-10', '10월', '1건 · 0시간 30분']]],
      [2025, false, 1, [['mon-2025-12', '12월', '1건 · 0시간 30분']]],
    ]);
  });
});
