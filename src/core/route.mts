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
// CLI(claude -p·codex exec)가 실패했을 때 화면에 보일 이유. Node의 기본 메시지("Command failed: <명령줄 전체>")에는
// 지시문까지 들어가고 정작 이유(CLI가 stdout·stderr에 낸 글)는 없다 → 출력에서 이유를 꺼내 종류로 나눈다
export type CliErrorKind = 'timeout' | 'limit' | 'login' | 'other';
const LOGIN_RE = /not logged in|please (?:run )?\/?login|log ?in again|invalid api key|authenticat|unauthori[sz]ed|\b401\b|oauth token|expired/i;
export function cliError(e: { killed?: boolean; signal?: string | null; code?: number | string | null; stdout?: string; stderr?: string }): { kind: CliErrorKind; message: string } {
  const text = `${e.stderr ?? ''}\n${e.stdout ?? ''}`.trim();
  if (e.killed || e.signal === 'SIGTERM') return { kind: 'timeout', message: '시간 초과' };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = (re: RegExp) => lines.find((l) => re.test(l));
  if (LIMIT_RE.test(text)) return { kind: 'limit', message: (pick(LIMIT_RE) ?? '사용 한도에 걸렸습니다').slice(0, 200) };
  if (LOGIN_RE.test(text)) return { kind: 'login', message: (pick(LOGIN_RE) ?? '로그인이 필요합니다').slice(0, 200) };
  const last = lines.at(-1);
  return { kind: 'other', message: last ? last.slice(0, 200) : `종료 코드 ${e.code ?? '알 수 없음'} (이유를 출력하지 않았습니다)` };
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
