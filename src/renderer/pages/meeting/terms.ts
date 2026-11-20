// 용어: 용어 설명 카드(body에 붙는 div.term-card), 회의록 아래 용어 칸의 값, 본문·스크립트에서 드래그한 말의 '설명 추가' 버튼(div.term-add).
// 카드·버튼의 뿌리는 여기서 만들어 body에 붙이고 안은 React(features/meeting-terms)가 그린다 — 놓을 자리·고치기도 거기서
import type { Term } from '../../entities/minutes/index.ts';
import { ExplainAddBody, TermCardBody, type ChangeTerm, type GlossaryProps } from '../../features/meeting-terms/index.ts';
import { el } from '../../shared/ui/index.tsx';
import type { ReviewRole } from './review.ts';
import { errText, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';

export interface TermsRole {
  /** 이 말의 설명 카드를 연다 (anchor 아래, 넘치면 위) */
  readonly openCard: (anchor: Element, t: Term) => void;
  readonly closeCard: () => void;
  /** 카드가 열려 있나 (Escape 차례: 카드가 먼저) */
  readonly cardOpen: () => boolean;
  readonly removeAddBtn: () => void;
  readonly glossaryProps: (r: MeetingRecord, g: MeetingDoc['glossary']) => GlossaryProps;
  /** 그린 페이지에서 말을 드래그하면 '설명 추가'를 띄운다 */
  readonly listen: (page: HTMLElement) => void;
}

export function createTerms(ctx: PageCtx, review: Pick<ReviewRole, 'startAdd'>): TermsRole {
  const { api, docs, toast, islands } = ctx;

  // ── 용어 설명 카드: 뿌리(div.term-card)를 body에 붙이고 안은 React(TermCardBody) — 놓을 자리·고치기도 거기서 ──
  let cardEl: HTMLElement | null = null;
  const outsideCard = (e: Event) => {
    const t = e.target as Element;
    if (cardEl && !cardEl.contains(t) && !t.closest?.('.term, .gl-item')) closeTermCard();
  };
  const escCard = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); // Escape 한 번에 하나만 닫는다 (찾기 막대·채팅은 이 키를 건너뛴다)
    closeTermCard();
  };
  function closeTermCard() {
    islands.unmount(cardEl);
    cardEl?.remove();
    cardEl = null;
    document.removeEventListener('mousedown', outsideCard, true);
    document.removeEventListener('keydown', escCard, true);
  }

  async function changeTerm(r: MeetingRecord, termId: string, patch: Parameters<ChangeTerm>[1], done?: string) {
    try {
      await api.updateTerm(r.dir, termId, patch);
      if (done) toast(done);
    } catch (err) {
      toast('바꾸지 못했습니다', (err as Error).message, { bad: true });
    }
    closeTermCard();
    void ctx.refreshDoc(r);
  }

  function termCard(anchor: Element, t: Term, editing = false) {
    closeTermCard();
    const r = ctx.rec();
    if (!r) return;
    const card = el('div', { class: 'term-card', role: 'dialog', 'aria-label': `${t.term} 설명` });
    cardEl = card;
    document.body.append(card);
    islands.mount(card, TermCardBody, { t, host: card, anchor, editing, reopen: (next: boolean) => setTimeout(() => termCard(anchor, t, next)), seek: ctx.seekOf(r), change: (termId, patch, done) => void changeTerm(r, termId, patch, done) });
    // 붙잡기(capture) 단계라 문서에 붙은 찾기 막대·채팅의 Escape(keys.ts, 거품 단계)보다 먼저 받는다
    setTimeout(() => {
      document.addEventListener('mousedown', outsideCard, true);
      document.addEventListener('keydown', escCard, true);
    });
  }

  // 회의록 아래 용어 칸 (그리기는 features/meeting-terms, 회의록 본문이 같이 그린다)
  function glossaryProps(r: MeetingRecord, g: MeetingDoc['glossary']): GlossaryProps {
    return {
      terms: g?.terms ?? [],
      exists: Boolean(g),
      openCard: (anchor: HTMLElement, t: Term) => termCard(anchor, t),
      change: (termId, patch, done) => void changeTerm(r, termId, patch, done),
      make: async () => {
        try {
          await api.makeGlossary(r.dir);
        } catch (err) {
          toast('용어 설명을 만들지 못했습니다', (err as Error).message, { bad: true });
        }
        void ctx.refreshDoc(r);
      },
    };
  }

  // 본문·스크립트에서 단어를 드래그하면 '설명 추가' 버튼을 띄운다
  let addBtn: HTMLElement | null = null;
  const removeAddBtn = () => {
    islands.unmount(addBtn);
    addBtn?.remove();
    addBtn = null;
  };
  function offerExplain() {
    removeAddBtn();
    const sel = window.getSelection();
    const text = sel?.toString().trim().replace(/\s+/g, ' ');
    if (!sel || !text || text.length > 40 || !sel.rangeCount || !ctx.page().querySelector('.doc, .script')?.contains(sel.anchorNode)) return;
    const r = ctx.recNow();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const explain = async () => {
      try {
        const t = await api.explainTerm(r.dir, text);
        toast(`'${t.term}' 설명을 더했습니다`, t.note);
      } catch (err) {
        toast('설명을 더하지 못했습니다', errText(err), { bad: true });
      }
      removeAddBtn();
      window.getSelection()?.removeAllRanges();
      void ctx.refreshDoc(r);
    };
    // 잘못 들린 말이면 확인 필요로: 입력칸에 고른 말을 넣어 두고 고칠 말·설명을 이어 쓰게 한다
    const cached = docs.get(ctx.id);
    const toReview = cached?.minutes && cached?.transcript ? () => {
      review.startAdd(text);
      ctx.setTab('review');
      removeAddBtn();
      window.getSelection()?.removeAllRanges();
      ctx.wantFocus({ key: 'review-add', caret: 'end' });
      void ctx.draw();
    } : null;
    const host = el('div', { class: 'term-add', style: `top:${Math.max(8, rect.top - 38)}px;left:${Math.min(rect.left, innerWidth - 300)}px` });
    addBtn = host;
    document.body.append(host);
    islands.mount(host, ExplainAddBody, { text, explain, toReview });
  }

  return {
    openCard: (anchor, t) => termCard(anchor, t),
    closeCard: closeTermCard,
    cardOpen: () => Boolean(cardEl),
    removeAddBtn,
    glossaryProps,
    listen: (page) => {
      page.addEventListener('mouseup', () => setTimeout(offerExplain));
      page.addEventListener('mousedown', (e) => {
        if (!addBtn?.contains(e.target as Node)) removeAddBtn();
      });
    },
  };
}
