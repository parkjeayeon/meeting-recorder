// 질문으로 찾기의 작업 하나와 그 말 (본체 src/ask.js가 보내는 상태 — 여기서 쓰는 칸만). 계산뿐, 상태는 features/ask.
import { PROVIDER_NAME } from '../../shared/lib/index.ts';

/** 찾을 범위: 개수와 기간은 따로, 넣은 것끼리 AND */
export interface AskScope {
  readonly count: number | null;
  readonly from: string;
  readonly to: string;
}
export interface AskHit {
  readonly id: string;
  /** main(주로 다룸) · mention(잠깐 언급) — 조건이 기간·상태뿐이면 없음 */
  readonly level?: 'main' | 'mention' | null;
  readonly reason?: string | null;
  readonly quote?: string | null;
}
export type AskStage = 'parse' | 'search' | 'judge' | 'done' | 'error' | 'stopped' | 'blocked';
export interface AskJob {
  readonly id: string;
  readonly q: string;
  readonly scope: AskScope;
  readonly status: 'running' | 'done' | 'error' | 'stopped' | 'blocked';
  readonly stage: AskStage | string;
  readonly t0: number;
  readonly ms: number | null;
  readonly conds?: {
    readonly topic?: string | null;
    readonly from?: string | null;
    readonly to?: string | null;
    readonly status?: unknown;
    readonly focus?: string | null;
    readonly terms?: readonly string[] | null;
  } | null;
  readonly results: readonly AskHit[];
  readonly candidates?: number;
  readonly seen?: boolean;
  readonly error?: string | null;
  readonly errorKind?: 'login' | 'limit' | 'timeout' | 'other' | null;
  readonly provider?: string | null;
}

export const ASK_COUNTS = [50, 100, 150] as const;
export const ASK_EXAMPLES = ['작년 2월에 한 회의', '성능 시험 관련 회의', '올해 장애 얘기한 회의', '확인이 안 끝난 배포 회의'] as const;
export const ASK_STAGES: readonly (readonly [string, string])[] = [['parse', '질문을 조건으로 푸는 중'], ['search', '녹취·회의록에서 찾는 중'], ['judge', '후보를 추리는 중']];

/** 탭에 보일 짧은 이름: 풀어낸 주제, 없으면 질문 앞 14자 */
export const askLabel = (t: AskJob): string => t.conds?.topic || (t.q.length > 14 ? `${t.q.slice(0, 14)}…` : t.q);
/** 걸린 시간 "12초" (찾는 중이면 지금까지) */
export const askSecs = (t: Pick<AskJob, 'ms' | 't0'>, now = Date.now()): string => `${Math.round((t.ms ?? now - t.t0) / 1000)}초`;

export const ymdOf = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** "2026-02-03" → 올해면 "2월 3일", 아니면 "2025. 2. 3." */
export function shortDay(s: string | null | undefined, now = new Date()): string {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return y === now.getFullYear() ? `${m}월 ${d}일` : `${y}. ${m}. ${d}.`;
}
export const rangeText = (from: string | null | undefined, to: string | null | undefined, now = new Date()): string => `${shortDay(from, now) || '처음'} – ${shortDay(to, now) || '오늘'}`;
export const scopeText = (sc: AskScope, now = new Date()): string =>
  [sc.count && `최근 ${sc.count}개`, (sc.from || sc.to) && rangeText(sc.from, sc.to, now)].filter(Boolean).join(' 그리고 ') || '모든 회의';

/** 기간 칩의 미리 정한 기간: [이름, 부터, 까지] */
export function askDatePresets(now = new Date()): [string, string, string][] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = (yy: number, mm: number, dd: number) => ymdOf(new Date(yy, mm, dd));
  return [['최근 7일', d(y, m, now.getDate() - 6), ymdOf(now)], ['이번 달', d(y, m, 1), d(y, m + 1, 0)], ['지난달', d(y, m - 1, 1), d(y, m, 0)], ['최근 3개월', d(y, m - 2, 1), ymdOf(now)], ['올해', d(y, 0, 1), ymdOf(now)], ['작년', d(y - 1, 0, 1), d(y - 1, 11, 31)]];
}

// 질문이 실패했을 때 보일 말: 무엇이 문제인지(제목) → 어떻게 하면 되는지 → CLI가 낸 이유(작게).
// 예전 기록에는 "Command failed: <명령줄>"이 저장돼 있어 이유로 보이지 않는다
export function askError(t: AskJob): { title: string; hint: string; detail: string | null } {
  const who = PROVIDER_NAME[t.provider ?? ''] ?? '다듬기 계정';
  const raw = /^Command failed:/.test(t.error ?? '') ? null : t.error ?? null;
  const kind = t.errorKind ?? (raw === '시간 초과' ? 'timeout' : 'other');
  const known: Record<string, [string, string]> = {
    login: [`${who} 로그인이 풀렸습니다`, t.provider === 'codex' ? '터미널에서 codex login으로 다시 로그인한 뒤 다시 찾기를 누르세요.' : '터미널에서 claude를 실행해 /login으로 다시 로그인한 뒤 다시 찾기를 누르세요.'],
    limit: [`${who} 사용 한도에 걸렸습니다`, '한도가 풀린 뒤 다시 찾기를 누르세요. 남은 사용량은 설정 › 다듬기에서 볼 수 있습니다.'],
    timeout: ['답이 너무 늦어 멈췄습니다', '다시 찾기를 눌러 보세요. 계속 늦으면 최근 몇 개·기간으로 범위를 좁혀 보세요.'],
  };
  const [title, hint] = known[kind] ?? ['찾지 못했습니다', '다시 찾기를 눌러 보세요. 같은 문제가 계속되면 아래 이유를 확인하세요.'];
  return { title, hint, detail: kind === 'timeout' ? null : raw ?? `${who}가 이유를 남기지 않고 끝났습니다` };
}
