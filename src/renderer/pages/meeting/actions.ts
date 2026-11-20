// ── 액션 (src/actions.js): 할 일(약속·맡은 일·다짐)과 받은 조언·알아 둘 것. 회의록과 따로 actions.json에 ──
import type { ActionsData, ActionsProps, ActionsRowProps } from '../../features/meeting-actions/index.ts';
import { errText, type MeetingRecord, type PageCtx } from './state.ts';

export interface ActionsRole {
  /** 액션 탭 */
  readonly view: (r: MeetingRecord, data: ActionsData) => ActionsProps;
  /** 회의록 아래 '액션 찾기' 줄 */
  readonly rowProps: (r: MeetingRecord, data: ActionsData | null | undefined) => ActionsRowProps;
}

export function createActions(ctx: PageCtx): ActionsRole {
  const { api, docs, toast, jobs } = ctx;

  function actionsView(r: MeetingRecord, data: ActionsData): ActionsProps {
    return {
      data,
      seek: ctx.seekOf(r),
      jobs,
      jobKey: `${r.dir}|액션`,
      find: () => void findActions(r),
      toggle: async (actionId: string, done: boolean) => {
        const a = data.actions.find((x) => x.id === actionId) as { done: boolean } | undefined;
        if (a) a.done = done; // 저장이 끝나기 전에 다시 그려도 체크가 남게
        await api.toggleAction(r.dir, actionId, done);
        docs.delete(r.id);
        void ctx.loadHistory();
      },
    };
  }

  async function findActions(r: MeetingRecord) {
    const key = `${r.dir}|액션`;
    if (jobs.has(key)) return;
    const run = jobs.run(key, '찾는 중… (1분 안팎)', () => api.makeActions(r.dir) as Promise<ActionsData>);
    try {
      const res = await run;
      toast(res.actions.length || res.advice.length ? '액션을 정리했습니다' : '챙길 할 일이나 조언을 찾지 못했습니다',
        res.actions.length || res.advice.length ? `할 일 ${res.actions.length}개 · ${res.adviceTitle ?? '조언'} ${res.advice.length}개` : '이 대화에는 약속한 일이나 남길 조언이 없었습니다', { ms: 7000 });
      if (res.actions.length || res.advice.length) ctx.setTab('actions');
    } catch (err) {
      toast('액션을 정리하지 못했습니다', errText(err), { bad: true });
    }
    void ctx.refreshDoc(r);
  }

  // 회의록 아래 '액션 찾기' (요청할 때만 만든다). 찾아봤는데 없었으면 그렇다고 보여 주고 다시 찾을 수 있게
  function actionsRowProps(r: MeetingRecord, data: ActionsData | null | undefined): ActionsRowProps {
    return { found: Boolean(data), jobs, jobKey: `${r.dir}|액션`, find: () => void findActions(r) };
  }

  return { view: actionsView, rowProps: actionsRowProps };
}
