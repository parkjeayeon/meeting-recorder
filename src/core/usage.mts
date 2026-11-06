// 다듬기 계정(Claude Code·Codex)의 사용 한도: 받은 글·JSON을 같은 모양(UsageWindows)으로. 파일·네트워크를 쓰지 않는다.
// Claude Code는 `claude -p /usage`가 사람이 읽는 글로 준다 → 규칙으로 먼저 읽고, 문구가 바뀌어 못 읽으면 LLM이 같은 모양으로 옮긴 것을
// 받되 숫자가 원래 글에 그대로 있을 때만 쓴다 (verifyWindows). Codex는 app-server가 JSON으로 준다.
import Type from 'typebox';
import Value from 'typebox/value';

export const UsageWindow = Type.Object({
  kind: Type.Union([Type.Literal('session'), Type.Literal('week'), Type.Literal('model-week')], { description: 'session: 짧은 창(5시간 등), week: 주간 전체, model-week: 특정 모델 주간' }),
  model: Type.Union([Type.String(), Type.Null()]),
  usedPercent: Type.Number({ minimum: 0, maximum: 100 }),
  resetsAt: Type.Union([Type.String(), Type.Null()], { description: 'ISO 시각 (읽지 못하면 null)' }),
  resetsText: Type.Union([Type.String(), Type.Null()], { description: '받은 글 그대로 ("Nov 6 at 9:29pm (Asia/Seoul)")' }),
});
export type UsageWindow = Type.Static<typeof UsageWindow>;
export const UsageWindows = Type.Array(UsageWindow, { minItems: 1 });

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "Nov 6 at 9:29pm (Asia/Seoul)", "Nov 8, 2026 at 10:59pm", "9:29pm" → 이 Mac 시간대의 시각.
// 다른 시간대로 적혀 있으면 계산하지 않는다 (글은 그대로 보여 준다)
export function parseResets(text: string | null | undefined, now = new Date(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone): Date | null {
  if (!text) return null;
  const tz = /\(([^)]+)\)\s*$/.exec(text)?.[1];
  if (tz && tz !== zone) return null;
  const m = /^(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[6]!.toLowerCase() === 'pm') hour += 12;
  const minute = Number(m[5] ?? 0);
  if (Number(m[4]) > 12 || minute > 59) return null;
  if (!m[1]) {
    // 날짜 없이 시각만: 오늘 그 시각, 이미 지났으면 내일
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    if (d.getTime() < now.getTime() - 60_000) d.setDate(d.getDate() + 1);
    return d;
  }
  const month = MONTHS.indexOf(m[1].toLowerCase());
  const day = Number(m[2]);
  if (month < 0) return null;
  let year = m[3] ? Number(m[3]) : now.getFullYear();
  let d = new Date(year, month, day, hour, minute);
  // 연도가 없고 한참 지난 날이면 내년 (12월에 "Jan 2"를 받은 경우)
  if (!m[3] && d.getTime() < now.getTime() - 7 * 86400e3) d = new Date(++year, month, day, hour, minute);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}

// `claude -p /usage` 글을 규칙으로 읽는다. 하나도 못 읽으면 null (→ LLM으로)
export function parseClaudeUsage(text: string, now = new Date(), zone?: string): UsageWindow[] | null {
  const out: UsageWindow[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*Current (session|week)(?:\s*\(([^)]+)\))?\s*:\s*(\d{1,3}(?:\.\d+)?)%\s*used(?:\s*[·•-]\s*resets\s+(.+?))?\s*$/i.exec(line);
    if (!m) continue;
    const used = Number(m[3]);
    if (used > 100) continue;
    const scope = m[2]?.trim() ?? null;
    const kind = m[1]!.toLowerCase() === 'session' ? 'session' : !scope || /^all models?$/i.test(scope) ? 'week' : 'model-week';
    const resetsText = m[4]?.trim() ?? null;
    out.push({ kind, model: kind === 'model-week' ? scope : null, usedPercent: used, resetsAt: parseResets(resetsText, now, zone)?.toISOString() ?? null, resetsText });
  }
  return out.length ? out : null;
}

// LLM이 옮긴 결과 확인: 모양이 맞고, 쓴 숫자(%)가 원래 글에 그대로 있어야 한다. 지어낸 숫자는 하나라도 있으면 버린다
export function verifyWindows(windows: unknown, text: string, now = new Date(), zone?: string): UsageWindow[] | null {
  if (!Array.isArray(windows)) return null;
  const filled = windows.map((w) => (w && typeof w === 'object' ? { model: null, resetsText: null, ...w, resetsAt: null } : w)) as Record<string, unknown>[];
  if (!Value.Check(UsageWindows, filled)) return null;
  const list = filled as UsageWindow[];
  const percents = new Set([...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1])));
  if (!list.every((w) => percents.has(w.usedPercent))) return null;
  if (!list.every((w) => !w.resetsText || text.includes(w.resetsText))) return null;
  if (!list.every((w) => w.kind !== 'model-week' || (w.model && text.includes(w.model)))) return null;
  return list.map((w) => ({ ...w, resetsAt: parseResets(w.resetsText, now, zone)?.toISOString() ?? null }));
}

// Codex app-server `account/rateLimits/read` 결과 → 같은 모양. 창 길이로 나눈다 (하루 이하 = session, 그 밖 = week)
export function codexUsage(result: unknown): { windows: UsageWindow[]; credits: string | null } | null {
  const rl = (result as { rateLimits?: Record<string, unknown> } | null)?.rateLimits;
  if (!rl || typeof rl !== 'object') return null;
  const windows: UsageWindow[] = [];
  for (const key of ['primary', 'secondary'] as const) {
    const w = rl[key] as { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null | undefined;
    if (!w || typeof w.usedPercent !== 'number' || w.usedPercent < 0 || w.usedPercent > 100) continue;
    const mins = typeof w.windowDurationMins === 'number' ? w.windowDurationMins : null;
    const at = typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000) : null;
    windows.push({ kind: mins !== null && mins <= 1440 ? 'session' : 'week', model: null, usedPercent: w.usedPercent, resetsAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null, resetsText: null });
  }
  const credits = rl.credits as { hasCredits?: boolean; unlimited?: boolean; balance?: unknown } | null | undefined;
  const balance = credits?.unlimited ? '무제한' : credits?.hasCredits && credits.balance != null ? String(credits.balance) : null;
  return windows.length ? { windows, credits: balance } : null;
}
