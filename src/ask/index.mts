// 질문으로 회의 찾기 (결정 51, 측정 docs/measurements.md·docs/eval/)
// 질문 → ① LLM이 조건으로 풂(기간·상태·정도·찾을 말) → ② 이 Mac에서 녹취·회의록 전문 검색(SQLite FTS5) → ③ 걸린 후보만 LLM이 주로 다룸·잠깐 언급으로 나눔.
// 메인 프로세스에서 돌아 화면·탭을 옮기거나 창을 닫아도 이어지고, 여러 질문을 동시에 돌린다. 끝난 질문은 앱 데이터 폴더(asks.json)에 남긴다.
// 회의 파일은 읽기만 한다. 색인(search-index.sqlite)은 지우고 다시 만들 수 있는 사본이다(원본은 회의 폴더).
// 구현은 TypeScript로 옮겼다 (결정 70): 색인(fts.mts), 질문 하나 돌리기(query.mts), 프롬프트(prompts.mts), 질문 상태·저장(여기).
// Electron에서 받던 것(앱 데이터 폴더)·LLM 호출·API 키는 createAsk에 넘긴다. 본체는 src/ask.js가 불러올 때 한 번 만들어 예전 이름 그대로 내보낸다
// — 시험(scripts/dev/ask-engine-check.js)이 src/ask.js를 require.cache에서 지우고 다시 불러오면 예전처럼 상태(질문·색인 연결)가 새로 생긴다.
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { isLimitError } from '../core/route.mjs';
import { writeJsonAtomic } from '../core/write.mjs';
import { openIndex } from './fts.mjs';
import { askWith, run, type RunContext } from './query.mjs';
import type { AskJob, AskMeeting, Complete } from './types.mjs';

export type { AskJob, AskMeeting, AskConds, AskResult } from './types.mjs';
export { search, syncIndex, snippets, openIndex, type Hit, type Ref } from './fts.mjs';
export { PARSE, JUDGE, STATUS_KO } from './prompts.mjs';

const KEEP = 30; // 남겨 둘 질문 수

export interface AskDeps {
  userData: () => string; // app.getPath('userData'), 부를 때 읽는다
  complete: Complete; // cleanup.js의 complete (불러올 때의 것)
  apiKey: () => string | null; // dictation.apiKey()
}

export interface AskEngine {
  init(opts: { getMeetings: () => AskMeeting[]; onChange: (j: AskJob) => void }): void;
  start(question: unknown, scope?: { count?: unknown; from?: unknown; to?: unknown }): AskJob;
  list(): AskJob[];
  stop(id: string): void;
  remove(id: string): void;
  seen(id: string): void;
}

export function createAsk(deps: AskDeps): AskEngine {
  let getMeetings: (() => AskMeeting[]) | null = null; // init 전에는 null — 시작하지 않고 막는다 (예전에 init을 엉뚱한 곳에서 불러 빈 목록으로 찾고 화면에 소식도 못 보냈다)
  let onChange: (j: AskJob) => void = () => {};
  const jobs = new Map<string, AskJob>();
  const aborts = new Map<string, AbortController>(); // 돌고 있는 질문 id → AbortController (멈추기)
  const store = (): string => path.join(deps.userData(), 'asks.json');

  function init(opts: Parameters<AskEngine['init']>[0]): void {
    getMeetings = opts.getMeetings;
    onChange = opts.onChange;
    try {
      for (const j of JSON.parse(fs.readFileSync(store(), 'utf8')) as AskJob[]) {
        // 앱이 꺼질 때 돌던 질문은 끝나지 못했다
        if (j.status === 'running') Object.assign(j, { status: 'error', error: '앱이 종료되어 중단됐습니다', stage: 'error' });
        jobs.set(j.id, j);
      }
    } catch {}
  }
  const save = () => writeJsonAtomic(store(), [...jobs.values()].slice(-KEEP));
  const publicJob = (j: AskJob): AskJob => ({ ...j });
  const changed = (j: AskJob, persist = false): void => {
    if (persist) save();
    onChange(publicJob(j));
  };

  // ── 색인 ──
  let db: DatabaseSync | null = null;
  function index(): DatabaseSync {
    if (db) return db;
    db = openIndex(path.join(deps.userData(), 'search-index.sqlite'));
    return db;
  }

  // ── LLM ── 질문 하나 돌리기(query.mts)에 넘기는 것. 회의 목록은 init이 넘긴 것을 부를 때 읽는다
  const ctx: RunContext = { getMeetings: () => getMeetings!(), changed, ask: askWith(deps.complete, deps.apiKey), index };

  // ── 질문 하나 ──
  let seq = Date.now();
  function start(question: unknown, scope: { count?: unknown; from?: unknown; to?: unknown } = {}): AskJob {
    if (!getMeetings) throw new Error('질문으로 찾기가 아직 준비되지 않았습니다');
    const q = String(question ?? '').trim().slice(0, 500);
    if (!q) throw new Error('찾을 내용을 적어 주세요');
    const job: AskJob = { id: `a${(seq++).toString(36)}`, q, scope: { count: Number(scope.count) || null, from: (scope.from || '') as string, to: (scope.to || '') as string }, status: 'running', stage: 'parse', t0: Date.now(), ms: null, conds: null, results: [], candidates: 0, provider: null, seen: false, error: null };
    jobs.set(job.id, job);
    const ac = new AbortController();
    aborts.set(job.id, ac);
    changed(job);
    run(job, ac.signal, ctx)
      .catch((err: Error & { killed?: boolean; kind?: string }) => {
        if (job.status !== 'running') return; // 멈춘 질문: 끊긴 호출의 오류는 버린다
        Object.assign(job, { status: 'error', stage: 'error', error: err.killed ? '시간 초과' : err.message.split('\n')[0], errorKind: err.killed ? 'timeout' : err.kind ?? (isLimitError(err) ? 'limit' : 'other'), ms: Date.now() - job.t0 });
        changed(job, true);
      })
      .finally(() => aborts.delete(job.id));
    return publicJob(job);
  }

  function list(): AskJob[] {
    return [...jobs.values()].map(publicJob);
  }
  // 멈추기: 돌던 LLM 호출(Claude Code·Codex 자식 프로세스, API 요청)을 끊고 '멈춤'으로 남긴다
  function stop(id: string): void {
    const j = jobs.get(id);
    if (!j || j.status !== 'running') return;
    Object.assign(j, { status: 'stopped', stage: 'stopped', ms: Date.now() - j.t0 });
    aborts.get(id)?.abort();
    changed(j, true);
  }
  function remove(id: string): void {
    stop(id); // 돌던 질문의 탭을 닫으면 호출도 끊는다
    jobs.delete(id);
    save();
  }
  function seen(id: string): void {
    const j = jobs.get(id);
    if (j && !j.seen) {
      j.seen = true;
      save();
    }
  }

  return { init, start, list, stop, remove, seen };
}
