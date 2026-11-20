// ── 흐름도 (src/meeting/flow.mts): 그리기와 자리 계산은 features/meeting-flow · entities/flow. 여기는 파일을 바꾸는 명령과 채팅 상태 ──
import type { FlowDoc } from '../../entities/flow/index.ts';
import { flowSvgFile, type FlowChatProps, type FlowData, type FlowRowProps, type FlowsProps } from '../../features/meeting-flow/index.ts';
import type { ChatsRole } from './chats.ts';
import { errText, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';

// 채팅(style.css .chat: 창 오른쪽에서 16px 띄운 400px)이 본문 칸과 겹치는 폭과, 본문을 비켜 세우는 가장 작은 창 폭 (style.css .page.with-chat과 같게)
const CHAT_SIDE = 408;
const CHAT_DOCK_MIN = 1160;

export interface FlowsRole {
  readonly flowsProps: (r: MeetingRecord, data: FlowData) => FlowsProps;
  readonly flowRowProps: (r: MeetingRecord, data: FlowData | null | undefined) => FlowRowProps;
  /** 열린 흐름도 채팅의 그릴 값 (열려 있을 때만 부른다, 그 흐름도가 없어졌으면 null) */
  readonly chatDrawer: (r: MeetingRecord, doc: MeetingDoc) => FlowChatProps | null;
  /** 창 크기가 바뀌면 (window resize) */
  readonly onResize: () => void;
}

export function createFlows(ctx: PageCtx, chats: ChatsRole): FlowsRole {
  const { api, docs, toast, jobs, deps } = ctx;

  // 그림 놓을 폭 (회의 페이지 본문 폭 − 카드 여백)
  function flowAvail() {
    const v = document.getElementById('view')!.clientWidth;
    const side = chats.anyOpen() && innerWidth >= CHAT_DOCK_MIN ? CHAT_SIDE : 0; // 채팅이 열려 본문이 비켜 선 폭
    return v ? Math.min(v - side, 1040) - 88 - 36 : null;
  }

  function flowsProps(r: MeetingRecord, data: FlowData): FlowsProps {
    const seekOr = ctx.seekOf(r);
    return {
      data,
      seek: seekOr,
      avail: flowAvail(),
      jobs,
      remakeKey: (flowId: string) => `${r.dir}|흐름도 다시|${flowId}`,
      openChat: (flowId: string) => setTimeout(() => openFlowChat(flowId)),
      saveSvg: async (f: FlowDoc) => {
        try {
          const saved = (await api.saveFlowSvg(f.title, flowSvgFile(f, seekOr))) as string | null;
          if (saved) toast('SVG로 저장했습니다', saved.split('/').pop(), { action: 'Finder에서 보기', onAction: () => api.reveal(saved) });
        } catch (err) {
          toast('저장하지 못했습니다', errText(err), { bad: true });
        }
      },
      remake: async (f: FlowDoc) => {
        const key = `${r.dir}|흐름도 다시|${f.id}`;
        if (jobs.has(key)) return;
        try {
          await jobs.run(key, '다시 그리는 중… (1분 안팎)', () => api.remakeFlow(r.dir, f.id) as Promise<unknown>);
          toast('흐름도를 다시 만들었습니다', f.title);
        } catch (err) {
          toast('다시 만들지 못했습니다', errText(err), { bad: true });
        }
        void ctx.refreshDoc(r);
      },
      remove: async (f: FlowDoc) => {
        if (!(await deps.confirm('이 흐름도를 지울까요?', `"${f.title}" · 다시 만들려면 1분쯤 걸립니다.`, '지우기'))) return;
        await api.removeFlow(r.dir, f.id);
        toast('흐름도를 지웠습니다', f.title);
        void ctx.refreshDoc(r);
      },
    };
  }

  // 흐름도가 없을 때 회의록 아래 줄: 무엇을 그릴지(선택) 적고 만들기. 만들어 봤는데 없었으면 그 이유
  function flowRowProps(r: MeetingRecord, data: FlowData | null | undefined): FlowRowProps {
    const key = `${r.dir}|흐름도`;
    return {
      data: data ?? null,
      jobs,
      jobKey: key,
      draft: ctx.drafts.get('flow-focus') ?? '',
      setDraft: (text: string) => ctx.drafts.set('flow-focus', text),
      make: async (focus: string) => {
        if (jobs.has(key)) return;
        try {
          const res = await jobs.run(key, '흐름 정리하는 중… (1분 안팎)', () => api.makeFlow(r.dir, focus) as Promise<FlowData>);
          toast(res.flows.length ? `흐름도 ${res.flows.length}장을 만들었습니다` : '그릴 흐름을 찾지 못했습니다', res.flows.length ? res.flows.map((f) => f.title).join(' · ') : res.reason ?? '', { ms: 7000 });
        } catch (err) {
          toast('흐름도를 만들지 못했습니다', errText(err), { bad: true });
        }
        void ctx.refreshDoc(r);
      },
    };
  }

  // 그림마다 채팅: 고친 그림을 제안받아 '이대로 바꾸기'로 반영 (바꾼 그림도 녹취 인용을 다시 확인)
  function openFlowChat(flowId: string) {
    chats.openFlow({ flowId, messages: [], busy: false, draft: '' });
    ctx.wantFocus({ key: 'flow-chat' });
    void ctx.draw();
  }

  function flowChatDrawer(r: MeetingRecord, doc: MeetingDoc): FlowChatProps | null {
    const fc = chats.flow()!;
    const f = doc.flow?.flows?.find((x) => x.id === fc.flowId);
    if (!f) return null;
    return {
      f,
      messages: [...fc.messages],
      busy: fc.busy,
      draft: fc.draft ?? '',
      setDraft: (text: string) => {
        fc.draft = text;
      },
      close: () => setTimeout(chats.close),
      send: (text: string) => setTimeout(async () => {
        if (fc.busy) return;
        fc.messages.push({ role: 'user', text });
        fc.draft = '';
        fc.busy = true;
        void ctx.draw();
        try {
          const res = await api.chatFlow(r.dir, f.id, fc.messages.map(({ role, text: t }) => ({ role, text: t })));
          fc.messages.push({ role: 'assistant', text: res.text + (res.dropped?.length ? `\n(녹취에서 확인되지 않은 항목 ${res.dropped.length}개는 뺐습니다)` : ''), revision: res.revision });
        } catch (err) {
          fc.messages.push({ role: 'assistant', text: `답을 받지 못했습니다: ${(err as Error).message}` });
        }
        fc.busy = false;
        if (chats.flow() !== fc) return;
        if (chats.idle()) ctx.wantFocus({ key: 'flow-chat' });
        void ctx.draw();
      }),
      apply: async (index: number) => {
        const m = fc.messages[index]!;
        fc.applying = (fc.applying ?? 0) + 1;
        try {
          await api.applyFlow(r.dir, f.id, m.revision);
          m.applied = true;
          toast('흐름도를 고쳤습니다', m.revision!.title);
        } catch (err) {
          toast('반영하지 못했습니다', errText(err), { bad: true });
        }
        fc.applying -= 1;
        void ctx.refreshDoc(r);
      },
    };
  }

  // 창 크기가 바뀌면 흐름도는 가로·세로 배치가 바뀔 수 있어 다시 그린다 (재생 막대는 스스로 다시 칠한다)
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    if (!docs.get(ctx.id)?.flow?.flows?.length) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void ctx.draw(), 250);
  };

  return { flowsProps, flowRowProps, chatDrawer: flowChatDrawer, onResize };
}
