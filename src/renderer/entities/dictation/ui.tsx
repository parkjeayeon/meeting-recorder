// 받아쓴 글 (옛 markedText와 같은 마크업: div.dtext 안에 글, 고친 곳은 del·ins)
import type { Marked } from './marks.ts';

export function DictText({ marked, plain }: { readonly marked: Marked; readonly plain: boolean }) {
  return (
    <div className={plain ? 'dtext plain' : 'dtext'}>
      {marked.parts
        ? marked.parts.map((p, k) => [
            p.space ? ' ' : null,
            p.op === 'eq' ? p.words : p.op === 'del' ? <del key={k} title="다듬기가 지운 말">{p.words}</del> : <ins key={k} title="다듬기가 넣은 말">{p.words}</ins>,
          ])
        : marked.text}
    </div>
  );
}
