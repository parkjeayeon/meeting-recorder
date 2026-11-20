// 확인 필요: 그리기는 features/meeting-review. 여기는 파일을 바꾸는 명령(적용·되돌리기·그대로 두기·다시 적용·마치기·다시 열기)과
// 탭의 상태(고른 항목·고쳐 쓴 말·직접 고르는 구간·보기·직접 추가 입력칸)를 든다. 채팅·구간 다시 받아쓰기는 review-chat.ts
import type { Fix, ReviewItem, ReviewProps } from '../../features/meeting-review/index.ts';
import { errText, later, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';

/** 이 역할이 부르는 채팅 쪽 명령 (review-chat.ts) */
export interface ReviewChatLink {
  readonly open: (ids: readonly string[]) => void;
  readonly runRedo: (r: MeetingRecord, itemId: string, range: { start: number; end: number }) => Promise<void>;
}

export interface ReviewRole {
  readonly view: (r: MeetingRecord, doc: MeetingDoc) => ReviewProps;
  readonly applyFixes: (r: MeetingRecord, fixes: readonly Fix[], opts?: { focusNext?: boolean }) => Promise<void>;
  /** 직접 추가 입력칸에 이 글을 넣어 두고 남은 항목 보기로 ('설명 추가'의 확인 필요로) — 그리기는 부른 쪽이 */
  readonly startAdd: (text: string) => void;
}

export function createReview(ctx: PageCtx, chat: ReviewChatLink): ReviewRole {
  const { api, docs, toast, jobs, deps } = ctx;
  const reviewSel = new Set<string>(); // 확인 필요에서 고른 항목
  let addDraft = ''; // 확인 필요 › 직접 추가 입력칸 (다시 그려도 남게)
  const guessDraft = new Map<string, string>(); // 항목별로 고쳐 쓴 '고칠 말'
  const redoPick = new Set<string>(); // 구간을 몰라 직접 고르는 중인 항목 (유실·의미 불명)
  let reviewFilter: 'open' | 'done' = 'open';

  // 처리할 항목들 다음에 남는 항목: 목록에서 그 뒤의 첫 남은 항목, 없으면 그 앞의 마지막 남은 항목
  function nextOpen(ids: readonly string[]): string | null {
    const open = (docs.get(ctx.id)?.review?.items ?? []).filter((it) => it.status === 'open');
    const last = Math.max(...ids.map((i) => open.findIndex((it) => it.id === i)));
    const rest = open.filter((it) => !ids.includes(it.id));
    return (open.slice(last + 1).find((it) => !ids.includes(it.id)) ?? rest.at(-1))?.id ?? null;
  }

  async function applyFixes(r: MeetingRecord, fixes: readonly Fix[], { focusNext = false } = {}): Promise<void> {
    if (!fixes.length) return;
    const next = focusNext ? nextOpen(fixes.map((f) => f.id)) : null;
    try {
      const review = await api.applyReview(r.dir, fixes);
      if (next) ctx.wantFocus({ key: `card:${next}`, reveal: true }); // 다음 항목에서 이어서 하게 (다시 읽어 그릴 때)
      const applied = (review.items as ReviewItem[]).filter((it) => fixes.some((f) => f.id === it.id) && it.status === 'applied');
      const kept = fixes.filter((f) => f.keep).length;
      const resolved = (review.items as ReviewItem[]).filter((it) => fixes.some((f) => f.id === it.id && f.resolve) && it.status === 'resolved');
      for (const f of fixes) reviewSel.delete(f.id);
      if (resolved.length && !applied.length) {
        toast(`${resolved.length}개를 확인됨으로 처리했습니다`, '녹취는 그대로 두고, 확인을 마칠 때 회의록 문장에 반영합니다');
        return await ctx.refreshDoc(r);
      }
      const words: string[] = review.addedWords ?? [];
      const skip: { reason: string; heard: string }[] = review.skipped ?? [];
      if (!applied.length && !kept) {
        // 아무것도 바꾸지 못함: 왜 그런지 알린다 (예전엔 "0개를 그대로 두었습니다"로 나와 헷갈렸다)
        const s = skip[0];
        toast('바꿀 곳이 없습니다', s?.reason === 'same' ? `고칠 말이 들린 말('${s.heard}')과 같습니다. 이 표기가 맞다면 '그대로 두기'를 누르세요` : s?.reason === 'notfound' ? `녹취에서 '${s.heard}'를 찾지 못했습니다` : '고칠 말을 넣어 주세요', { bad: true, ms: 7000 });
      } else toast(applied.length ? `${applied.length}개를 고쳤습니다` : `${kept}개를 그대로 두었습니다`,
        applied.length ? `녹취·정리본·회의록에서 ${applied.reduce((n, it) => n + (it.count ?? 0), 0)}곳을 바꿨습니다${words.length ? ` · 사전에 추가: ${words.join(', ')}` : ''}` : '',
        words.length ? { action: '사전 보기', onAction: () => (location.hash = '#dictionary'), ms: 7000 } : {});
      if (words.length) await deps.refreshSettings(); // 사전 개수·목록도 바로
      await ctx.refreshDoc(r);
    } catch (err) {
      toast('적용하지 못했습니다', (err as Error).message, { bad: true });
    }
  }

  // 고친 항목 되돌리기: 그 항목이 바꾼 줄만 원래대로, 사전에 자동으로 넣은 단어면 사전에서도 뺀다
  async function revertItem(r: MeetingRecord, it: ReviewItem) {
    try {
      const res = await api.revertReview(r.dir, it.id);
      // 같은 줄을 나중에 고친 항목은 먼저 되돌렸다가 다시 적용한다 (그 항목의 고칠 말이 이제 녹취에 없으면 확인 전으로 연다)
      const again = res.reapplied?.length ? `같은 줄을 나중에 고친 ${res.reapplied.length}개는 다시 적용했습니다` : '';
      const reopened = res.reopened?.length ? `${res.reopened.length}개는 고칠 곳이 없어져 다시 확인 전으로 열었습니다` : '';
      toast('되돌렸습니다', [res.removedWord && `사전에서 '${res.removedWord}'를 뺐습니다`, again, reopened].filter(Boolean).join(' · ') || '항목을 다시 확인 전으로 열었습니다');
      if (res.removedWord) await deps.refreshSettings();
    } catch (err) {
      toast('되돌리지 못했습니다', errText(err), { bad: true });
    }
    void ctx.refreshDoc(r);
  }

  // 고친 말을 다른 말로: 되돌린 뒤 새 말로 다시 적용
  async function reapply(r: MeetingRecord, it: ReviewItem, guess: string) {
    try {
      await api.revertReview(r.dir, it.id);
      await applyFixes(r, [{ id: it.id, heard: it.heard, guess }]);
    } catch (err) {
      toast('고치지 못했습니다', errText(err), { bad: true });
      void ctx.refreshDoc(r);
    }
  }

  async function keepItems(r: MeetingRecord, ids: readonly string[]) {
    const next = nextOpen(ids);
    await api.setReviewStatus(r.dir, ids, 'kept');
    if (next) ctx.wantFocus({ key: `card:${next}`, reveal: true });
    ids.forEach((i) => reviewSel.delete(i));
    toast(`${ids.length}개를 그대로 두었습니다`, '나중에 다시 열 수 있습니다');
    void ctx.refreshDoc(r);
  }

  // 다시 그리는 명령은 한 박자 뒤에(later) — 누른 부품을 그 처리 중에 다시 만들지 않게
  function reviewView(r: MeetingRecord, doc: MeetingDoc): ReviewProps {
    const items = doc.review?.items ?? [];
    for (const rid of [...reviewSel]) if (!items.some((it) => it.id === rid && it.status === 'open')) reviewSel.delete(rid);
    const addKey = `${r.dir}|확인추가`;
    return {
      review: doc.review ?? null,
      minutes: doc.minutes ?? '',
      transcript: doc.transcript ?? '',
      filter: reviewFilter,
      selected: new Set(reviewSel),
      guessDraft: new Map(guessDraft),
      redoPick: new Set(redoPick),
      addDraft,
      drafts: ctx.drafts.copy(),
      seek: ctx.seekOf(r),
      now: () => ctx.audio.currentTime,
      jobs,
      addKey,
      actions: {
        setFilter: later((f: 'open' | 'done') => {
          reviewFilter = f;
          void ctx.draw();
        }),
        select: later((rid: string, on: boolean) => {
          if (on) reviewSel.add(rid);
          else reviewSel.delete(rid);
          void ctx.draw();
        }),
        selectAll: later((on: boolean) => {
          if (on) items.filter((it) => it.status === 'open').forEach((it) => reviewSel.add(it.id));
          else reviewSel.clear();
          void ctx.draw();
        }),
        setGuess: (rid: string, v: string) => void guessDraft.set(rid, v),
        setDraft: (key: string, v: string) => ctx.drafts.set(key, v),
        apply: (fixes: readonly Fix[]) => void applyFixes(r, fixes, { focusNext: true }),
        keep: (ids: readonly string[]) => void keepItems(r, ids),
        openChat: later((ids: readonly string[]) => chat.open(ids)),
        redo: later((rid: string, range: { start: number; end: number }) => {
          redoPick.delete(rid);
          chat.open([rid]);
          void chat.runRedo(r, rid, range);
        }),
        toggleRedoPick: later((rid: string) => {
          if (redoPick.has(rid)) redoPick.delete(rid);
          else {
            redoPick.add(rid);
            ctx.wantFocus({ key: `redo-start:${rid}` }); // 연 줄의 시작 칸에서 바로 쓰게
          }
          void ctx.draw();
        }),
        reopen: async (rid: string) => {
          await api.setReviewStatus(r.dir, [rid], 'open');
          void ctx.refreshDoc(r);
        },
        revert: (it: ReviewItem) => void revertItem(r, it),
        reapply: (it: ReviewItem, guess: string) => reapply(r, it, guess),
        cancelEdit: later(() => ctx.refreshDoc(r)),
        makeReview: async () => {
          try {
            await api.makeReview(r.dir);
            void ctx.refreshDoc(r);
            return true;
          } catch (err) {
            toast('정리하지 못했습니다', (err as Error).message, { bad: true });
            return false;
          }
        },
        setAddDraft: (text: string) => {
          addDraft = text;
        },
        add: async (text: string) => {
          if (jobs.has(addKey)) return;
          try {
            const res = await jobs.run(addKey, '녹취에서 찾는 중…', () => api.addReview(r.dir, text) as Promise<{ added: unknown[]; reply?: string }>);
            if (res.added.length) {
              addDraft = '';
              reviewFilter = 'open';
              toast(`확인 필요에 ${res.added.length}개를 더했습니다`, res.reply);
            } else toast('더할 항목을 찾지 못했습니다', res.reply || '녹취에서 그 말을 찾지 못했습니다. 들린 그대로 적어 보세요', { ms: 9000 });
          } catch (err) {
            toast('더하지 못했습니다', errText(err), { bad: true });
          }
          await ctx.refreshDoc(r);
          void ctx.loadHistory();
        },
        finalize: async () => {
          // 남은 항목이 있는데 마치면 그 항목들은 그대로 둔 것이 된다 → 한 번 묻는다 (다 처리했으면 묻지 않는다)
          const left = items.filter((it) => it.status === 'open').length;
          if (left && !(await deps.confirm(`남은 ${left}개는 그대로 두고 확인을 마칠까요?`, '마치면 회의록이 확정됩니다. 나중에 다시 열어 손볼 수 있습니다.', '확인 마치기'))) return null;
          try {
            const res = await api.finalizeReview(r.dir);
            toast('회의록을 확정했습니다', res.finalize?.rewritten ? '확인 결과에 맞춰 회의록의 해당 부분을 고쳤습니다' : '고친 단어는 이미 반영되어 있어 회의록 문장은 그대로입니다');
            await ctx.refreshDoc(r);
            void ctx.loadHistory();
            return true;
          } catch (err) {
            toast('확인을 마치지 못했습니다', (err as Error).message, { bad: true });
            return false;
          }
        },
        reopenAll: async () => {
          try {
            const before = doc.review?.finalize?.rewritten;
            await api.reopenReview(r.dir);
            toast('확인을 다시 열었습니다', before ? '회의록을 마치기 전 것으로 돌렸습니다. 다시 마치면 확인한 내용을 다시 반영합니다' : '항목을 다시 손볼 수 있습니다');
            reviewFilter = 'open';
            await ctx.refreshDoc(r);
            return true;
          } catch (err) {
            toast('다시 열지 못했습니다', errText(err), { bad: true });
            return false;
          }
        },
        warn: (title: string) => toast(title, '', { bad: true }),
      },
    };
  }

  return {
    view: reviewView,
    applyFixes,
    startAdd: (text) => {
      addDraft = `"${text}" `;
      reviewFilter = 'open';
    },
  };
}
