import { describe, expect, it } from 'vitest';
import type { MeetingItem } from '../../entities/meeting/index.ts';
import { chips, mixed, pick } from './model.ts';

let n = 0;
const m = (over: Partial<MeetingItem> = {}): MeetingItem => ({ id: `m${n++}`, startedAt: new Date(2026, 10, 1).toISOString(), durationSec: 60, minutes: { status: 'done', title: '주간 회의' }, review: { finalized: true }, ...over });
const open = () => m({ review: { open: 2, total: 2 } });
const fail = () => m({ minutes: { status: 'error' } });

describe('회의 목록 계산', () => {
  it('갈래 칩: 개수가 없는 갈래는 숨기되 전체와 지금 갈래는 남긴다', () => {
    const all = [m(), m(), open()];
    expect(chips(all, 'all').map((c) => `${c.label} ${c.n}`)).toEqual(['전체 3', '확인 완료 2', '확인할 회의 1']);
    expect(chips(all, 'rest').map((c) => c.id)).toEqual(['all', 'final', 'hand', 'rest']);
  });
  it('검색은 제목·요약에서 (소문자로 받은 검색어)', () => {
    const all = [m({ minutes: { status: 'done', title: 'QA 회의' } }), m({ summary: '배포 qa 일정' }), m()];
    expect(pick(all, 'all', 'qa')).toHaveLength(2);
    expect(pick(all, 'hand', '')).toHaveLength(0);
  });
  it('전체: 확인할 회의(종류별 개수), 최근 20개, 나머지는 이전 회의', () => {
    const items = [open(), fail(), ...Array.from({ length: 25 }, () => m())];
    const v = mixed(items);
    expect(v.hand).toHaveLength(2);
    expect(v.kinds).toBe('확인 남음 1 · 실패 1');
    expect([v.recent.length, v.older.length]).toEqual([20, 7]);
    expect(v.lastDone?.id).toBe(items[2]!.id);
  });
});
