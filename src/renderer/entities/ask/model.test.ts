import { describe, expect, it } from 'vitest';
import { askDatePresets, askError, askLabel, rangeText, scopeText, type AskJob } from './model.ts';

const now = new Date(2026, 10, 12, 15);
const job = (over: Partial<AskJob> = {}): AskJob => ({ id: 'a', q: '배포 일정 정한 회의를 찾아 줘', scope: { count: null, from: '', to: '' }, status: 'done', stage: 'done', t0: 0, ms: 1000, results: [], ...over });

describe('질문으로 찾기의 말', () => {
  it('탭 이름: 주제, 없으면 질문 앞 14자', () => {
    expect(askLabel(job({ conds: { topic: '배포' } }))).toBe('배포');
    expect(askLabel(job())).toBe('배포 일정 정한 회의를 찾…');
  });
  it('범위: 개수와 기간을 그리고로, 올해 날짜는 해 없이', () => {
    expect(scopeText({ count: null, from: '', to: '' }, now)).toBe('모든 회의');
    expect(scopeText({ count: 50, from: '2026-11-06', to: '' }, now)).toBe('최근 50개 그리고 11월 6일 – 오늘');
    expect(rangeText('2025-02-01', '2025-02-28', now)).toBe('2025. 2. 1. – 2025. 2. 28.');
  });
  it('기간 미리 정한 것: 최근 7일은 오늘 포함, 지난달은 그 달 끝까지', () => {
    const p = Object.fromEntries(askDatePresets(now).map(([k, f, t]) => [k, [f, t]]));
    expect(p['최근 7일']).toEqual(['2026-11-06', '2026-11-12']);
    expect(p['지난달']).toEqual(['2026-10-01', '2026-10-31']);
    expect(p['작년']).toEqual(['2025-01-01', '2025-12-31']);
  });
  it('실패한 이유: 로그인·한도·시간 초과는 할 일을, 옛 기록의 명령줄은 이유로 보이지 않는다', () => {
    expect(askError(job({ status: 'error', errorKind: 'login', provider: 'codex', error: 'x' })).hint).toContain('codex login');
    expect(askError(job({ status: 'error', error: '시간 초과' }))).toEqual({ title: '답이 너무 늦어 멈췄습니다', hint: expect.any(String), detail: null });
    expect(askError(job({ status: 'error', error: 'Command failed: claude -p …', provider: 'claude-code' })).detail).toBe('Claude Code가 이유를 남기지 않고 끝났습니다');
  });
});
