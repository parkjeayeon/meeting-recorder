import { describe, expect, it } from 'vitest';
import { codexUsage, parseClaudeUsage, parseResets, verifyWindows } from './usage.mjs';

const zone = 'Asia/Seoul';
const now = new Date(2026, 10, 6, 18, 0); // 이 Mac 시각 2026-11-06 18:00
// `claude -p /usage` 출력 (2026-11-06 실제 형식, 숫자만 바꿈)
const text = `You are currently using your subscription to power your Claude Code usage

Current session: 15% used · resets Nov 6 at 9:29pm (Asia/Seoul)
Current week (all models): 80% used · resets Nov 8 at 10:59pm (Asia/Seoul)
Current week (Fable): 3% used · resets Nov 8 at 10:59pm (Asia/Seoul)

What's contributing to your limits usage?
Last 24h · 398 requests · 4 sessions
  92%  Start fresh when you switch tasks · run /clear
`;

describe('parseResets', () => {
  const at = (t: string) => parseResets(t, now, zone)?.toString().slice(4, 21) ?? null;
  it('날짜·시각 형식들', () => {
    expect(at('Nov 6 at 9:29pm (Asia/Seoul)')).toBe('Nov 06 2026 21:29');
    expect(at('Nov 8, 2026 at 10:59am')).toBe('Nov 08 2026 10:59');
    expect(at('Dec 1 at 12am')).toBe('Dec 01 2026 00:00');
    expect(at('9pm')).toBe('Nov 06 2026 21:00');
    expect(at('5:30pm')).toBe('Nov 07 2026 17:30'); // 오늘 이미 지남 → 내일
  });
  it('다른 시간대·못 읽는 글·없는 날짜는 null', () => {
    expect(parseResets('Nov 6 at 9:29pm (America/New_York)', now, zone)).toBeNull();
    expect(parseResets('soon', now, zone)).toBeNull();
    expect(parseResets('Feb 30 at 1pm', now, zone)).toBeNull();
    expect(parseResets('13:00pm', now, zone)).toBeNull();
    expect(parseResets(null, now, zone)).toBeNull();
  });
  it('연도 없이 한참 지난 날은 내년', () => {
    expect(parseResets('Jan 2 at 1am', new Date(2026, 11, 30), zone)?.getFullYear()).toBe(2027);
  });
});

describe('parseClaudeUsage', () => {
  it('세션·주간·모델별 주간, 아래 기여도 줄의 %는 무시', () => {
    const w = parseClaudeUsage(text, now, zone)!;
    expect(w.map(({ kind, model, usedPercent, resetsText }) => ({ kind, model, usedPercent, resetsText }))).toEqual([
      { kind: 'session', model: null, usedPercent: 15, resetsText: 'Nov 6 at 9:29pm (Asia/Seoul)' },
      { kind: 'week', model: null, usedPercent: 80, resetsText: 'Nov 8 at 10:59pm (Asia/Seoul)' },
      { kind: 'model-week', model: 'Fable', usedPercent: 3, resetsText: 'Nov 8 at 10:59pm (Asia/Seoul)' },
    ]);
    expect(new Date(w[0]!.resetsAt!).getHours()).toBe(21);
  });
  it('초기화 시각이 없거나 % 소수점', () => {
    expect(parseClaudeUsage('Current session: 0.5% used', now, zone)).toEqual([{ kind: 'session', model: null, usedPercent: 0.5, resetsAt: null, resetsText: null }]);
  });
  it('문구가 바뀌면 null (→ LLM)', () => {
    expect(parseClaudeUsage('세션: 15% 사용 · 21:29 초기화', now, zone)).toBeNull();
    expect(parseClaudeUsage('', now, zone)).toBeNull();
    expect(parseClaudeUsage('Current session: 150% used', now, zone)).toBeNull();
  });
});

describe('verifyWindows (LLM이 옮긴 결과)', () => {
  const llm = [
    { kind: 'session', model: null, usedPercent: 15, resetsText: 'Nov 6 at 9:29pm (Asia/Seoul)' },
    { kind: 'week', model: null, usedPercent: 80, resetsText: 'Nov 8 at 10:59pm (Asia/Seoul)' },
  ];
  it('숫자가 원래 글에 있으면 쓰고 시각은 다시 계산', () => {
    const w = verifyWindows(llm, text, now, zone)!;
    expect(w).toHaveLength(2);
    expect(new Date(w[1]!.resetsAt!).getDate()).toBe(8);
  });
  it('지어낸 숫자·글·모델, 모양이 틀리면 버린다', () => {
    expect(verifyWindows([{ ...llm[0], usedPercent: 20 }], text, now, zone)).toBeNull(); // 20%는 없음
    expect(verifyWindows([{ ...llm[0], resetsText: 'Nov 7 at 9pm' }], text, now, zone)).toBeNull();
    expect(verifyWindows([{ kind: 'model-week', model: 'Opus', usedPercent: 3, resetsText: null }], text, now, zone)).toBeNull();
    expect(verifyWindows([{ kind: 'month', usedPercent: 15 }], text, now, zone)).toBeNull();
    expect(verifyWindows([{ kind: 'session', usedPercent: '15' }], text, now, zone)).toBeNull();
    expect(verifyWindows([], text, now, zone)).toBeNull();
    expect(verifyWindows({ windows: llm }, text, now, zone)).toBeNull();
  });
  it('빠진 model·resetsText는 null로 채운다', () => {
    expect(verifyWindows([{ kind: 'session', usedPercent: 15 }], text, now, zone)).toEqual([{ kind: 'session', model: null, usedPercent: 15, resetsAt: null, resetsText: null }]);
  });
});

describe('codexUsage', () => {
  it('app-server 결과 (주간 창 하나 + 크레딧)', () => {
    const r = codexUsage({ rateLimits: { primary: { usedPercent: 16, windowDurationMins: 10080, resetsAt: 1794379197 }, secondary: null, credits: { hasCredits: true, unlimited: false, balance: '120.5' } } })!;
    expect(r.windows).toEqual([{ kind: 'week', model: null, usedPercent: 16, resetsAt: new Date(1794379197000).toISOString(), resetsText: null }]);
    expect(r.credits).toBe('120.5');
  });
  it('5시간 창 + 주간 창, 크레딧 없음', () => {
    const r = codexUsage({ rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: null }, secondary: { usedPercent: 10, windowDurationMins: 10080 }, credits: null } })!;
    expect(r.windows.map((w) => [w.kind, w.usedPercent, w.resetsAt])).toEqual([['session', 40, null], ['week', 10, null]]);
    expect(r.credits).toBeNull();
  });
  it('모양이 다르면 null', () => {
    expect(codexUsage(null)).toBeNull();
    expect(codexUsage({})).toBeNull();
    expect(codexUsage({ rateLimits: { primary: { usedPercent: 'x' } } })).toBeNull();
  });
});
