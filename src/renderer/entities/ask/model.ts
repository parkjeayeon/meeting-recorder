// 질문으로 찾기 작업 하나 (본체 src/ask.js가 보내는 상태) — 여기서 쓰는 칸만
export interface AskJob {
  readonly id: string;
  readonly q: string;
  readonly status: 'running' | 'done' | 'error' | 'stopped' | 'blocked';
  readonly t0: number;
  readonly ms: number | null;
  readonly conds?: { readonly topic?: string | null } | null;
  readonly results: readonly unknown[];
}

/** 탭에 보일 짧은 이름: 풀어낸 주제, 없으면 질문 앞 14자 */
export const askLabel = (t: AskJob): string => t.conds?.topic || (t.q.length > 14 ? `${t.q.slice(0, 14)}…` : t.q);
/** 걸린 시간 "12초" (찾는 중이면 지금까지) */
export const askSecs = (t: AskJob, now = Date.now()): string => `${Math.round((t.ms ?? now - t.t0) / 1000)}초`;
