import { describe, expect, it } from 'vitest';
import type { MeetingItem } from '../../entities/meeting/index.ts';
import { greeting, homeView, type HomeInput } from './model.ts';

const now = new Date(2026, 10, 12, 9);
let n = 0;
const meet = (over: Partial<MeetingItem> = {}): MeetingItem => ({
  id: `m${n++}`, startedAt: new Date(2026, 10, 10, 10).toISOString(), durationSec: 600,
  minutes: { status: 'done', title: '주간 회의' }, review: { finalized: true, open: 0, total: 2 }, ...over,
});
const wav = (bytes: number, over: Partial<NonNullable<MeetingItem['audio']>> = {}) => ({ bytes, wav: true, supported: true, declined: false, estimate: bytes / 8, ...over });
const input = (over: Partial<HomeInput> = {}): HomeInput => ({
  meetings: [], dictations: [], totals: null, issues: [], strayCount: 0, freshId: null, showMarks: true, openRaw: new Set(), ...over,
});

describe('홈 계산', () => {
  it('인사는 시각으로', () => {
    expect([5, 11, 17, 23, 3].map((h) => greeting(new Date(2026, 10, 12, h)))).toEqual(['좋은 아침이에요', '좋은 오후예요', '좋은 저녁이에요', '늦게까지 수고 많아요', '늦게까지 수고 많아요']);
  });

  it('챙길 일: 확인할 회의(이름 둘 + 외 n개) → 회의록 없음 → 압축 → 목록에 없는 폴더, 없으면 빈 목록', () => {
    expect(homeView(input(), now).todo).toEqual([]);
    const hand = [1, 2, 3].map((i) => meet({ minutes: { status: 'done', title: `회의 ${i}` }, review: { open: 1, total: 1 } }));
    const v = homeView(input({
      meetings: [...hand, meet({ minutes: { status: 'error' } }), meet({ minutes: null }), meet({ audio: wav(800e6) })],
      strayCount: 2,
    }), now);
    expect(v.todo.map((t) => [t.title, t.n])).toEqual([['확인할 회의', 3], ['회의록이 없는 녹음', 2], ['압축할 수 있는 녹음', 1], ['목록에 없는 폴더', 2]]);
    expect(v.todo[0]!.sub).toBe('회의 1 · 회의 2 외 1개');
    expect(v.todo[2]).toMatchObject({ go: 'meeting', sub: '확인을 마친 회의 · 800MB → 약 100MB' });
  });

  it('최근 회의는 짧은 녹음·들린 말 없음·만드는 중을 빼고 5개, 만드는 중은 위 카드로', () => {
    const busy = meet({ minutes: { status: 'transcribe', progress: 0.5 } });
    const meets = [busy, meet({ minutes: { status: 'short' } }), meet({ minutes: { status: 'empty' } }), ...Array.from({ length: 7 }, () => meet())];
    const v = homeView(input({ meetings: meets }), now);
    expect(v.busy).toEqual([busy]);
    expect(v.recentMeets).toHaveLength(5);
    expect(v.recentMeets.every((m) => m.minutes?.status === 'done')).toBe(true);
  });

  it('시작하기: 다 했으면 숨기고, 권한 문제가 있으면 권한 칸이 안 끝남', () => {
    const done = input({ meetings: [meet()], dictations: [{ id: 'd', startedAt: now.toISOString(), durationSec: 3, transcript: { raw: '글' } }] });
    expect(homeView(done, now).steps).toBeNull();
    const perms = homeView({ ...done, issues: [['fn', { title: 'x', sec: 'perms' }]] }, now).steps;
    expect(perms?.map((s) => s.done)).toEqual([false, true, true]);
  });

  it('녹음 공간: 압축할 수 있는 것만 큰 순서로, 16kHz·그대로 두기·1MB 미만·회의록 없는 것은 개수만', () => {
    const big = meet({ audio: wav(500e6) });
    const busy = meet({ minutes: { status: 'write' }, review: null, audio: wav(300e6) });
    const s = homeView(input({ meetings: [
      meet({ audio: wav(100e6, { supported: false }) }), // 16kHz
      meet({ audio: wav(200e6, { declined: true }) }),
      meet({ audio: wav(0.5e6) }),
      meet({ minutes: { status: 'error' }, audio: wav(50e6) }),
      busy, big,
      meet({ audio: { bytes: 60e6, wav: false, estimate: 60e6 } }),
    ] }), now).storage!;
    expect(s.shown).toEqual([big, busy]);
    expect(s.keep).toBe(4);
    expect(s.wav).toEqual({ n: 6, bytes: 1150.5e6 });
    expect(s.packed).toEqual({ n: 1, bytes: 60e6 });
    expect(s.save).toBe(500e6 * 7 / 8 + 300e6 * 7 / 8);
    expect(homeView(input({ meetings: [meet()] }), now).storage).toBeNull();
  });
});
