// 다듬기·회의록·질문으로 찾기에서 '자동'일 때 쓸 계정 고르기 (결정 53). 파일·네트워크를 쓰지 않는다. src/cleanup.js가 불러 쓴다.
//   순서: Claude Code(가장 빠름) → Codex → API 키, 로그인된 것만.
//   둘 다 로그인돼 있고 Claude Code를 거의 다 썼으면(어느 창이든 90% 이상) Codex 사용량을 보고 90% 미만이면 Codex를 앞에 둔다.
//   호출이 한도 오류로 끝나면 그 계정은 잠시 '다 씀'으로 두고 다음 계정으로 같은 요청을 다시 보낸다.

export const HIGH_PERCENT = 90;
export type ProviderId = 'claude-code' | 'codex' | 'api';
const AUTO_ORDER: ProviderId[] = ['claude-code', 'codex', 'api'];

// loggedIn: 로그인된 계정. claudeUsed·codexUsed: 가장 많이 쓴 창의 %(모르면 null)
export function orderProviders(loggedIn: readonly string[], claudeUsed: number | null, codexUsed: number | null, high = HIGH_PERCENT): ProviderId[] {
  const order = AUTO_ORDER.filter((id) => loggedIn.includes(id));
  if (order.includes('claude-code') && order.includes('codex') && claudeUsed !== null && claudeUsed >= high && codexUsed !== null && codexUsed < high) {
    return ['codex', ...order.filter((id) => id !== 'codex')];
  }
  return order;
}

// 사용 한도에 걸렸다는 오류·문구 (Claude Code는 한도에 걸리면 답 대신 이 문구를 내고 정상 종료하기도 한다)
const LIMIT_RE = /usage limit|limit reached|hit your (?:usage |weekly |session |5-hour )?limit|rate[ _-]?limit|quota|\b429\b|credit balance is too low/i;
export function isLimitText(text: string): boolean {
  return text.length < 400 && LIMIT_RE.test(text);
}
export function isLimitError(err: unknown): boolean {
  const e = err as { limit?: boolean; message?: string; stderr?: string } | null;
  return Boolean(e?.limit) || LIMIT_RE.test(`${e?.message ?? ''} ${e?.stderr ?? ''}`);
}

// 순서대로 불러 보고, 한도 오류면 onLimit(계정)을 알리고 다음 계정으로. 다른 오류나 마지막 계정의 오류는 그대로 던진다
export async function withFallback<T>(order: readonly string[], call: (id: string) => Promise<T>, onLimit: (id: string) => void = () => {}): Promise<{ value: T; provider: string }> {
  let last: unknown = new Error('쓸 계정이 없습니다');
  for (const [i, id] of order.entries()) {
    try {
      return { value: await call(id), provider: id };
    } catch (err) {
      last = err;
      if (!isLimitError(err) || i === order.length - 1) throw err;
      onLimit(id);
    }
  }
  throw last;
}
