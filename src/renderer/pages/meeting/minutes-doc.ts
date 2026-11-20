// 회의록 본문: 그리기는 widgets/meeting-minutes (흐름도·액션·용어 부품을 같이). 여기는 파일을 바꾸는 명령과 부품마다의 값
import type { TermMatcher } from '../../entities/minutes/index.ts';
import type { MinutesProps } from '../../widgets/meeting-minutes/index.ts';
import type { ActionsRole } from './actions.ts';
import type { FlowsRole } from './flows.ts';
import type { MeetingRecord, PageCtx } from './state.ts';
import type { TermsRole } from './terms.ts';

export interface MinutesDocRole {
  readonly props: (r: MeetingRecord, md: string, reviewOpen: number, openReview: () => void, matcher: TermMatcher | null) => MinutesProps;
}

export function createMinutesDoc(ctx: PageCtx, parts: { readonly flows: FlowsRole; readonly actions: ActionsRole; readonly terms: TermsRole }): MinutesDocRole {
  const { api, docs } = ctx;
  const { flows, actions, terms } = parts;

  function minutesDoc(r: MeetingRecord, md: string, reviewOpen: number, openReview: () => void, matcher: TermMatcher | null): MinutesProps {
    const cached = docs.get(r.id);
    const flowData = cached?.flow;
    const actData = cached?.actions;
    return {
      md,
      seek: ctx.seekOf(r),
      matcher,
      openTerm: terms.openCard,
      flows: flowData?.flows?.length ? flows.flowsProps(r, flowData) : null,
      flowRow: flows.flowRowProps(r, flowData),
      actionsRow: !actData?.actions?.length && !actData?.advice?.length ? actions.rowProps(r, actData) : null,
      glossary: terms.glossaryProps(r, cached?.glossary),
      review: /^## 확인 필요/m.test(md) ? { finalized: Boolean(cached?.review?.finalizedAt), open: reviewOpen, go: () => queueMicrotask(openReview) } : null,
      toggleTodo: async (index: number, done: boolean) => {
        const updated = await api.toggleTodo(r.dir, index, done);
        docs.set(r.id, { ...docs.get(r.id), minutes: updated });
      },
    };
  }

  return { props: minutesDoc };
}
