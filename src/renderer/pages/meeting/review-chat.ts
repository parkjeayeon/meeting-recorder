// 확인 필요 채팅: 고를 항목으로 열기, 보내기, 제안 적용, 구간 다시 받아쓰기와 녹취에 반영. 채팅 자리(열고 닫기·연 버튼)는 chats.ts
import { clock } from '../../shared/lib/index.ts';
import type { Fix, ReviewChatProps, ReviewItem } from '../../features/meeting-review/index.ts';
import type { ChatsRole } from './chats.ts';
import type { ReviewRole } from './review.ts';
import { errText, later, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';

export interface ReviewChatRole {
  readonly open: (ids: readonly string[]) => void;
  readonly runRedo: (r: MeetingRecord, itemId: string, range: { start: number; end: number }) => Promise<void>;
  /** 열린 확인 필요 채팅의 그릴 값 (열려 있을 때만 부른다) */
  readonly drawer: (r: MeetingRecord, doc: MeetingDoc) => ReviewChatProps;
}

export function createReviewChat(ctx: PageCtx, chats: ChatsRole, review: Pick<ReviewRole, 'applyFixes'>): ReviewChatRole {
  const { api, toast } = ctx;
  const { applyFixes } = review;

  async function runRedo(r: MeetingRecord, itemId: string, range: { start: number; end: number }) {
    const c0 = chats.review();
    if (!c0 || c0.redoing) return;
    c0.redoing = itemId;
    void ctx.draw();
    try {
      const res = await api.redoRange(r.dir, itemId, range.start, range.end);
      const span = `${clock(res.start)}~${clock(res.end)}`;
      chats.review()?.messages.push({
        role: 'assistant',
        text: res.empty
          ? `${span} 구간을 다시 받아써도 알아들을 수 있는 말이 없었습니다. 녹음을 직접 들어 보세요.`
          : `${span} 구간을 다시 받아썼습니다${res.gain > 1.05 ? ` (작은 소리를 ${res.gain}배 키움)` : ''}. 녹취에 반영하면 이 구간 줄만 바뀌고 다른 줄은 그대로입니다.`,
        redo: { id: itemId, ...res },
      });
    } catch (err) {
      chats.review()?.messages.push({ role: 'assistant', text: `다시 받아쓰지 못했습니다: ${errText(err)}` });
    }
    const c1 = chats.review();
    if (c1) c1.redoing = null;
    void ctx.draw();
  }

  async function applyRedo(r: MeetingRecord, itemId: string) {
    try {
      const rv = await api.applyRedo(r.dir, itemId);
      const it = (rv.items as ReviewItem[]).find((x) => x.id === itemId);
      toast('녹취에 반영했습니다', `이 구간 ${it?.count ?? ''}줄만 바꿨습니다 · 확인을 마치면 회의록에도 반영합니다`);
      await ctx.refreshDoc(r);
    } catch (err) {
      toast('반영하지 못했습니다', errText(err), { bad: true });
    }
  }

  function openChat(ids: readonly string[]) {
    if (!ids.length) return;
    chats.openReview({ ids: [...ids], messages: [], busy: false, applying: new Set() });
    ctx.drafts.dropPrefix('unmatched:'); // 앞 채팅의 제안 칸
    ctx.wantFocus({ key: 'chat' });
    void ctx.draw();
  }

  function chatDrawer(r: MeetingRecord, doc: MeetingDoc): ReviewChatProps {
    const c = chats.review()!;
    const items = (doc.review?.items ?? []).filter((it) => c.ids.includes(it.id));
    const apply = async (list: readonly Fix[]) => {
      list.forEach((f) => c.applying.add(f.id));
      void ctx.draw();
      await applyFixes(r, list);
      list.forEach((f) => c.applying.delete(f.id));
      void ctx.draw();
    };
    return {
      items,
      messages: [...c.messages],
      busy: c.busy,
      redoing: c.redoing ?? null,
      applying: new Set(c.applying),
      draft: c.draft ?? '',
      setDraft: (text: string) => {
        c.draft = text; // 화면을 다시 그려도 쓰던 글이 남게
      },
      fieldDrafts: ctx.drafts.copy(),
      setFieldDraft: (key: string, text: string) => ctx.drafts.set(key, text),
      close: later(chats.close),
      apply: later(apply),
      applyUnmatched: async (fix: Fix) => {
        await applyFixes(r, [fix]);
        void ctx.draw();
      },
      redo: later((rid: string, range: { start: number; end: number }) => runRedo(r, rid, range)),
      applyRedo: (rid: string) => void applyRedo(r, rid),
      send: later(async (text: string) => {
        if (c.busy) return;
        c.messages.push({ role: 'user', text });
        c.draft = '';
        c.busy = true;
        void ctx.draw();
        try {
          const res = await api.chatReview(r.dir, c.ids, c.messages.map(({ role, text: t, redo }) => ({ role, text: redo?.text ? `${t}\n${redo.text}` : t })));
          c.messages.push({ role: 'assistant', text: res.text, proposals: res.proposals, unmatched: res.unmatched });
        } catch (err) {
          c.messages.push({ role: 'assistant', text: `답을 받지 못했습니다: ${(err as Error).message}` });
        }
        c.busy = false;
        if (chats.review() !== c) return;
        if (chats.idle()) ctx.wantFocus({ key: 'chat' });
        void ctx.draw();
      }),
    };
  }

  return { open: openChat, runRedo, drawer: chatDrawer };
}
