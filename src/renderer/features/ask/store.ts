// 질문으로 찾기의 상태 주인. 찾기는 본체(src/ask.js)에서 돌고, 여기는 받은 상태와 창(둥근 버튼·질문 창·알림)의 상태를 든다.
// 화면을 옮기거나 창을 닫아도 찾기는 이어지고, 다시 열면 askList()로 그대로 이어 보여 준다 (결정 51).
// 옛 화면 코드에서 옮겨 왔다 — 쓰기와 IPC 구독(onAsk)을 한 번에. 화면 이동·설정 같은 바깥 일은 deps로 받는다.
import type { AskJob, AskScope } from '../../entities/ask/index.ts';

export interface AskApi {
  readonly askStart: (question: string, scope: AskScope) => Promise<AskJob>;
  readonly askList: () => Promise<AskJob[]>;
  readonly askStop: (id: string) => Promise<unknown>;
  readonly askRemove: (id: string) => Promise<unknown>;
  readonly askSeen: (id: string) => unknown;
  readonly onAsk: (cb: (job: AskJob) => void) => void;
}
export interface AskDeps {
  readonly api: AskApi;
  /** 회의 화면의 그 질문 탭을 보고 있나 (보고 있으면 끝나도 알림을 띄우지 않고 본 것으로) */
  readonly viewing: (id: string) => boolean;
  /** 회의 화면의 그 질문 탭으로 */
  readonly openTab: (id: string) => void;
  readonly notifyError: (title: string, detail: string) => void;
}
export interface AskState {
  /** 오래된 것부터 */
  readonly jobs: readonly AskJob[];
  readonly open: boolean;
  /** 막 열었다 (입력칸에 포커스, 창에 opening). 옛 화면처럼 창을 다시 그릴 일이 생기면 꺼진다 —
   *  질문을 고쳐 쓰거나 범위를 바꾸는 건 창을 다시 그리지 않았으므로 그대로 둔다 */
  readonly justOpened: boolean;
  readonly draft: string;
  readonly scope: AskScope;
  /** 방금 끝난 질문 (둥근 버튼 옆 알림) */
  readonly toast: AskJob | null;
}
export type AskStore = ReturnType<typeof createAskStore>;

const sorted = (m: ReadonlyMap<string, AskJob>) => [...m.values()].sort((a, b) => a.t0 - b.t0);

export function createAskStore(deps: AskDeps) {
  const { api } = deps;
  const jobs = new Map<string, AskJob>();
  let state: AskState = { jobs: [], open: false, justOpened: false, draft: '', scope: { count: null, from: '', to: '' }, toast: null };
  const listeners = new Set<() => void>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const set = (patch: Partial<AskState>, redraw = true) => {
    state = { ...state, ...(redraw ? { justOpened: false } : {}), ...patch };
    for (const l of [...listeners]) l();
  };
  const putJobs = (patch: Partial<AskState> = {}) => set({ jobs: sorted(jobs), ...patch });
  const get = (id: string) => jobs.get(id);

  const store = {
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    get,

    /** 시작할 때 본체에 남아 있는 질문들 */
    load(list: readonly AskJob[]) {
      for (const j of list) jobs.set(j.id, j);
      putJobs();
    },
    async start(text: string, scope: AskScope = state.scope): Promise<AskJob | null> {
      const q = text.trim();
      if (!q) return null;
      try {
        const job = await api.askStart(q, { ...scope });
        jobs.set(job.id, job);
        putJobs({ draft: '' });
        return job;
      } catch (err) {
        deps.notifyError('질문을 시작하지 못했습니다', (err as Error).message);
        return null;
      }
    },
    async remove(t: AskJob) {
      jobs.delete(t.id);
      putJobs(state.toast?.id === t.id ? { toast: null } : {});
      await api.askRemove(t.id);
    },
    /** 찾는 도중 멈추기: 본체가 돌던 LLM 호출을 끊고 '멈춤'으로 남긴다 (탭과 질문은 남아 다시 찾을 수 있다) */
    async stop(t: AskJob) {
      if (get(t.id)?.status !== 'running') return;
      jobs.set(t.id, { ...t, status: 'stopped', stage: 'stopped', ms: Date.now() - t.t0 });
      putJobs();
      await api.askStop(t.id);
    },
    /** 다시 찾기: 지우고 같은 질문·범위로 새로 */
    async redo(t: AskJob, scope: AskScope = t.scope) {
      await store.remove(t);
      return store.start(t.q, scope);
    },
    markSeen(t: AskJob) {
      const cur = get(t.id);
      if (cur?.status !== 'done' || cur.seen) return;
      jobs.set(t.id, { ...cur, seen: true });
      api.askSeen(t.id);
      putJobs();
    },
    /** 회의 화면의 그 질문 탭으로 (알림은 닫는다) */
    go(t: AskJob) {
      set({ toast: null });
      deps.openTab(t.id);
    },
    toggle(open = !state.open) {
      set({ open, justOpened: open, ...(open ? { toast: null } : {}) });
    },
    setDraft(draft: string) {
      if (draft !== state.draft) set({ draft }, false);
    },
    /** 예시 단추: 입력칸을 그 글로 (창을 다시 그린다) */
    useExample(draft: string) {
      set({ draft });
    },
    setScope(scope: AskScope) {
      set({ scope }, false);
    },

    /** 본체가 보낸 소식 */
    update(job: AskJob) {
      const before = get(job.id);
      if (!before && job.status !== 'running') return; // 지운 질문의 늦은 소식
      jobs.set(job.id, job);
      const finished = before?.status === 'running' && job.status !== 'running';
      const viewing = deps.viewing(job.id);
      let patch: Partial<AskState> = {};
      if (finished && job.status === 'done' && viewing) {
        jobs.set(job.id, { ...job, seen: true });
        api.askSeen(job.id);
      }
      // 다 찾으면 둥근 버튼 옆에 잠깐 알림 (보고 있는 탭이면 띄우지 않음, 막힌 질문은 채팅 창에서 보이게 연다)
      if (finished && job.status === 'blocked') patch = { open: true, justOpened: true };
      else if (finished && !viewing && job.status !== 'stopped') {
        patch = { toast: job };
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => set({ toast: null }), 6000);
      }
      putJobs(patch);
    },
    /** 찾는 동안 본체의 상태와 맞춘다 (소식을 하나 놓쳐도 '찾는 중'에 멈춰 있지 않게) */
    async sync() {
      const running = sorted(jobs).filter((x) => x.status === 'running');
      if (!running.length) return;
      const fresh = new Map((await api.askList()).map((j) => [j.id, j]));
      let moved = false;
      for (const t of running) {
        const j = fresh.get(t.id);
        if (!j) {
          jobs.delete(t.id);
          moved = true;
        } else if (j.status !== t.status || j.stage !== t.stage) {
          jobs.set(j.id, j);
          moved = true;
        }
      }
      if (moved) putJobs();
    },
    /** 본체 소식을 받고, 찾는 동안 5초마다 맞추기를 시작한다 (앱에서 한 번) */
    connect() {
      api.onAsk((job) => store.update(job));
      let tick = 0;
      setInterval(() => {
        if (!sorted(jobs).some((x) => x.status === 'running') || ++tick % 5) return;
        void store.sync();
      }, 1000);
    },
  };
  return store;
}
