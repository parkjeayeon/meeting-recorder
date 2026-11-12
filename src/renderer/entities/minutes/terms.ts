// 용어 설명의 밑줄 자리: 회의록·정리본·원본에서 용어가 나온 곳 (화면 표시만 하고 파일은 고치지 않는다).
// 낱말 속 글자에는 긋지 않는다 ('나'가 '모르거나'·'나눈'에 붙지 않게): 앞에 글자가 없고,
// 뒤가 끝·글자 아닌 것·조사(뒤에 한글이 더 이어지지 않을 때)일 때만.
const JOSA_AFTER = '은|는|이|가|을|를|의|도|에|에서|에게|께서|과|와|로|으로|만|까지|부터|처럼|보다|이나|랑|이랑|이다|입니다';

/** 용어 하나 (glossary.json) — 여기서 쓰는 칸만 */
export interface Term {
  readonly id: string;
  readonly term: string;
  readonly note?: string;
  /** confirmed(확인함) · suggested(LLM 추정) */
  readonly status?: string;
  /** general(일반 용어) · meeting(회의 내용에서) · unknown(회의에서 설명 없음) */
  readonly basis?: string;
  readonly edited?: boolean;
  /** 회의에서 나온 시각들 (mm:ss) */
  readonly at?: readonly string[];
}
export interface TermMatcher {
  readonly re: RegExp;
  readonly byTerm: ReadonlyMap<string, Term>;
}

/** 긴 용어부터 찾는 정규식 (용어가 없으면 null) */
export function termMatcher(terms: readonly Term[] | null | undefined): TermMatcher | null {
  const list = (terms ?? []).filter((t) => t.term).sort((a, b) => b.term.length - a.term.length);
  if (!list.length) return null;
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![가-힣A-Za-z0-9])(${list.map((t) => esc(t.term)).join('|')})(?=$|[^가-힣A-Za-z0-9]|(?:${JOSA_AFTER})(?![가-힣]))`, 'g');
  return { re, byTerm: new Map(list.map((t) => [t.term, t])) };
}

export type TermPiece = string | { readonly term: Term; readonly text: string };

/** 글을 조각으로: 글자 그대로와 용어(밑줄). seen: 한 문단·한 줄 안에서는 처음 나온 곳에만 긋는다 (부르는 쪽이 문단마다 새로) */
export function termPieces(text: string, matcher: TermMatcher | null, seen: Set<string> = new Set()): TermPiece[] {
  if (!matcher || !text) return [text];
  const out: TermPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(matcher.re)) {
    const t = matcher.byTerm.get(m[1]!);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ term: t, text: m[1]! });
    last = m.index + m[1]!.length;
  }
  out.push(text.slice(last));
  return out;
}
