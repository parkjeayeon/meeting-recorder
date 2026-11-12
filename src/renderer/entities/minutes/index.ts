export { termMatcher, termPieces, type Term, type TermMatcher, type TermPiece } from './terms.ts';
export { inlinePieces, minutesBlocks, type Block, type Inline, type ListItem } from './markdown.ts';

/** 화자 색 순서: 원본 스크립트에 처음 나온 순서로 고정한다 (이름을 바꿔도 색은 그대로) */
export function speakerOrder(lines: readonly { readonly who: string | null }[]): string[] {
  const order: string[] = [];
  for (const l of lines) if (l.who && !order.includes(l.who)) order.push(l.who);
  return order;
}
export { TermText } from './ui.tsx';
