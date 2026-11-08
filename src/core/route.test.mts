import { describe, expect, it } from 'vitest';
import { cliError, isLimitError, isLimitText, orderProviders, withFallback } from './route.mjs';

describe('orderProviders', () => {
  const both = ['claude-code', 'codex'];
  it('기본은 Claude Code → Codex → API, 로그인된 것만', () => {
    expect(orderProviders(['codex', 'api', 'claude-code'], 10, 10)).toEqual(['claude-code', 'codex', 'api']);
    expect(orderProviders(['codex'], null, null)).toEqual(['codex']);
    expect(orderProviders([], null, null)).toEqual([]);
  });
  it('Claude Code 90% 이상이고 Codex 90% 미만이면 Codex 먼저', () => {
    expect(orderProviders(both, 90, 40)).toEqual(['codex', 'claude-code']);
    expect(orderProviders([...both, 'api'], 100, 89)).toEqual(['codex', 'claude-code', 'api']);
  });
  it('Codex도 거의 다 썼거나 모르면, 또는 Claude Code가 89%면 그대로', () => {
    expect(orderProviders(both, 95, 92)).toEqual(['claude-code', 'codex']);
    expect(orderProviders(both, 95, null)).toEqual(['claude-code', 'codex']);
    expect(orderProviders(both, 89, 0)).toEqual(['claude-code', 'codex']);
    expect(orderProviders(both, null, 0)).toEqual(['claude-code', 'codex']);
  });
  it('Codex가 로그인 안 돼 있으면 Claude Code를 다 써도 그대로', () => {
    expect(orderProviders(['claude-code', 'api'], 100, 0)).toEqual(['claude-code', 'api']);
  });
});

describe('한도 오류', () => {
  it('한도 문구를 알아본다 (짧은 글만 — 다듬은 글에 "quota"가 들어 있다고 오류로 보지 않게)', () => {
    expect(isLimitText("Claude AI usage limit reached|1762510800")).toBe(true);
    expect(isLimitText("You've hit your weekly limit · resets Nov 8")).toBe(true);
    expect(isLimitText('오늘 회의에서 quota 얘기를 했습니다. '.repeat(30))).toBe(false);
    expect(isLimitText('배포는 화요일에 합니다')).toBe(false);
    expect(isLimitError(Object.assign(new Error('Command failed'), { stderr: 'Error: 429 rate_limit_error' }))).toBe(true);
    expect(isLimitError(new Error('시간 초과'))).toBe(false);
  });
});

describe('withFallback', () => {
  it('한도 오류면 다음 계정으로, 알림은 한 번', async () => {
    const limited: string[] = [];
    const r = await withFallback(['claude-code', 'codex'], async (id) => {
      if (id === 'claude-code') throw Object.assign(new Error('usage limit reached'), { limit: true });
      return `ok:${id}`;
    }, (id) => limited.push(id));
    expect(r).toEqual({ value: 'ok:codex', provider: 'codex' });
    expect(limited).toEqual(['claude-code']);
  });
  it('다른 오류나 마지막 계정의 오류는 그대로', async () => {
    await expect(withFallback(['claude-code', 'codex'], async () => { throw new Error('시간 초과'); })).rejects.toThrow('시간 초과');
    await expect(withFallback(['codex'], async () => { throw new Error('usage limit'); })).rejects.toThrow('usage limit');
  });
});

describe('cliError', () => {
  it('명령줄 대신 CLI가 낸 이유를 종류로 나눔', () => {
    expect(cliError({ code: 1, stdout: 'Invalid API key · Please run /login\n', stderr: '' })).toEqual({ kind: 'login', message: 'Invalid API key · Please run /login' });
    expect(cliError({ code: 1, stdout: '', stderr: "You've hit your session limit · resets 5:50pm" }).kind).toBe('limit');
    expect(cliError({ killed: true, signal: 'SIGTERM', stdout: '', stderr: '' })).toEqual({ kind: 'timeout', message: '시간 초과' });
    expect(cliError({ code: 2, stdout: '', stderr: 'warn: x\nError: something broke\n' })).toEqual({ kind: 'other', message: 'Error: something broke' });
    expect(cliError({ code: 1, stdout: '', stderr: '' }).message).toContain('종료 코드 1');
  });
});
