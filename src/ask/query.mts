// 질문 하나 돌리기: 질문 → ① LLM이 조건으로 풂(기간·상태·정도·찾을 말) → 범위·조건으로 거르기 → ② 색인에서 후보 찾기(fts.mts)
// → ③ 걸린 후보만 LLM이 주로 다룸·잠깐 언급으로 나눔 → 최신순. src/ask.js에서 옮김 (결정 70). 질문 상태·저장은 index.mts.
import { parseJson } from '../llm/text.mjs';
import { search, snippets, syncIndex, type Index } from './fts.mjs';
import { day, JUDGE, PARSE, STATUS_KO, ymd } from './prompts.mjs';
import type { CompleteOptions } from '../llm/call.mjs';
import type { AskJob, AskMeeting, AskResult, Complete } from './types.mjs';

export const CAND_MAX = 40; // 추리기 한 번에 넘기는 후보 (넘치면 나눠서 동시에)

// ── LLM ── 이 기능은 다듬기 설정과 상관없이 '자동' 규칙으로 고른다: Claude Code 먼저(측정: 정확도 비슷, 입력 약 1/4·시간 약 60%),
// Claude Code를 거의 다 썼고(90% 이상) Codex에 여유가 있으면 Codex, 한도 오류가 나면 다음 계정으로 다시 (결정 51·53)
const pickProvider = async (): Promise<string> => 'auto';
const LLM_TIMEOUT = 180000; // 후보 40개 추리기는 Codex로 30초를 넘기기도 한다 (측정 평균 24초)
const TIMEOUTS = { 'claude-code': LLM_TIMEOUT, codex: LLM_TIMEOUT, api: LLM_TIMEOUT };
// complete는 src/ask.js가 불러올 때 cleanup.js에서 가져온 것 (시험이 바꿔 끼운다), API 키는 부를 때 읽는다
export type Ask = (choice: string, system: string, input: string, maxTokens: number, signal: AbortSignal) => Promise<{ text: string; provider: string }>;
export const askWith = (complete: Complete, apiKey: () => string | null): Ask => (choice, system, input, maxTokens, signal) => complete({ system, input, choice: choice as CompleteOptions['choice'], apiKey: apiKey(), effort: 'low', timeouts: TIMEOUTS, maxTokens, cache: false, signal });

// run이 index.mts에서 받는 것: 회의 목록(init이 넘긴 것을 부를 때 읽음), 소식 보내기·저장, LLM 호출, 색인 열기
export interface RunContext {
  getMeetings: () => AskMeeting[];
  changed: (j: AskJob, persist?: boolean) => void;
  ask: Ask;
  index: Index;
}

export async function run(job: AskJob, signal: AbortSignal, ctx: RunContext): Promise<void> {
  const { getMeetings, changed, ask, index } = ctx;
  const live = () => job.status === 'running'; // 멈췄으면 이어서 쓰지 않는다
  const choice = await pickProvider();
  job.provider = choice;
  const now = new Date();
  const r1 = await ask(choice, PARSE(`${ymd(now)} (Asia/Seoul)`), `<request>${job.q}</request>`, 800, signal);
  if (!live()) return;
  job.provider = r1.provider;
  const c = parseJson(r1.text) ?? {};
  const okDay = (x: unknown): string | null => (/^\d{4}-\d{2}-\d{2}$/.test((x ?? '') as string) ? (x as string) : null);
  job.conds = { from: okDay(c.from), to: okDay(c.to), status: Array.isArray(c.status) && c.status.length ? c.status : null, focus: c.focus === 'main' ? 'main' : 'any', topic: typeof c.topic === 'string' ? c.topic.slice(0, 20) : null, terms: Array.isArray(c.terms) ? c.terms.filter((t: unknown) => typeof t === 'string').slice(0, 22) : [] };
  const sc = job.scope;
  // 질문 속 기간과 기간 칩이 겹치지 않으면 찾지 않는다 (둘 다 맞아야 해서 늘 0건)
  if ((job.conds.from || job.conds.to) && (sc.from || sc.to)) {
    const qFrom = job.conds.from ?? '0000-01-01';
    const qTo = job.conds.to ?? '9999-12-31';
    if (qTo < (sc.from || '0000-01-01') || qFrom > (sc.to || '9999-12-31')) {
      Object.assign(job, { status: 'blocked', stage: 'blocked', ms: Date.now() - job.t0 });
      return changed(job, true);
    }
  }
  // 범위(최근 N개 그리고 기간)와 질문 속 조건으로 거른다
  let pool = getMeetings(); // 최신순
  if (sc.count) pool = pool.slice(0, sc.count);
  const inDay = (m: AskMeeting, from: string | null, to: string | null): boolean => { const d = ymd(new Date(m.startedAt as string)); return (!from || d >= from) && (!to || d <= to); };
  pool = pool.filter((m) => inDay(m, sc.from, sc.to) && inDay(m, job.conds!.from, job.conds!.to) && (!job.conds!.status || job.conds!.status.includes(m.status)));
  if (!job.conds.terms.length) {
    job.results = pool.map((m) => ({ id: m.id, level: null, reason: null }));
    Object.assign(job, { status: 'done', stage: 'done', ms: Date.now() - job.t0 });
    return changed(job, true);
  }
  job.stage = 'search';
  changed(job);
  syncIndex(index, getMeetings());
  const byId = new Map(pool.map((m) => [m.id, m]));
  const hits = search(index, job.conds.terms, new Set(byId.keys()));
  job.candidates = hits.length;
  job.stage = 'judge';
  changed(job);
  const batches: (typeof hits)[] = [];
  for (let i = 0; i < hits.length; i += CAND_MAX) batches.push(hits.slice(i, i + CAND_MAX));
  const found: AskResult[] = [];
  await Promise.all(batches.map(async (batch) => {
    const shown = new Map<string, string>();
    const blocks = batch.map((hh, k) => {
      const m = byId.get(hh.mid)!;
      const sn = snippets(m, hh.refs);
      shown.set(`c${k + 1}`, m.id);
      return `[c${k + 1}] ${day(m.startedAt)} | ${STATUS_KO[m.status] ?? ''} | ${m.title ?? '(제목 없음)'} | ${m.summary ?? '(회의록 없음)'}\n${sn.map((x) => `  > ${x}`).join('\n')}`;
    });
    const r = await ask(choice, JUDGE, `<request>${job.q}</request>\n<candidates>\n${blocks.join('\n')}\n</candidates>`, 4000, signal);
    for (const it of parseJson(r.text)?.results ?? []) {
      const id = shown.get(it?.id);
      if (!id) continue;
      const level: 'main' | 'mention' = it.level === 'mention' ? 'mention' : 'main';
      if (job.conds!.focus === 'main' && level !== 'main') continue;
      found.push({ id, level, reason: typeof it.reason === 'string' ? it.reason.slice(0, 200) : null, quote: typeof it.quote === 'string' ? it.quote.slice(0, 200) : null });
    }
  }));
  if (!live()) return;
  // 최신순으로
  const order = new Map(pool.map((m, i) => [m.id, i]));
  job.results = [...new Map(found.map((f) => [f.id, f])).values()].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  Object.assign(job, { status: 'done', stage: 'done', ms: Date.now() - job.t0 });
  changed(job, true);
}
