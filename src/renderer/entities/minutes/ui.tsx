// 용어에 밑줄을 그은 글 (회의록·정리본·원본). 누르거나 Enter면 설명 카드를 연다 (옛 withTerms와 같은 마크업)
import { termPieces, type Term, type TermMatcher } from './terms.ts';

export function TermText({ text, matcher, seen, open }: { readonly text: string; readonly matcher: TermMatcher | null; readonly seen?: Set<string>; readonly open: (anchor: HTMLElement, t: Term) => void }) {
  return termPieces(text, matcher, seen).map((p, i) => (typeof p === 'string' ? p : (
    <span key={i} className={`term${p.term.status === 'confirmed' ? '' : ' guess'}`} role="button" tabIndex={0} title={p.term.note} onClick={(e) => open(e.currentTarget, p.term)} onKeyDown={(e) => {
      if (e.key === 'Enter') open(e.currentTarget, p.term);
    }}>{p.text}</span>
  )));
}
