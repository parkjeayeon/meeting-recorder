// 회의록 마크다운(minutes.md)을 화면이 그릴 덩어리로: 소제목, 목록(할 일은 체크 가능), 문단, **굵게**, (12:34) 시각.
// '## 확인 필요' 섹션은 '확인 필요' 탭에서 하나씩 처리하므로 건너뛴다. 흐름도는 '## 요약' 다음 소제목 앞에 (없으면 끝에).

export type Block =
  | { readonly kind: 'h3' | 'h4' | 'p'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly ListItem[] }
  | { readonly kind: 'flows' };
export type ListItem =
  | { readonly todo: false; readonly text: string }
  /** index: 회의록 안 몇 번째 할 일인지 (체크하면 본체에 그 번호로) */
  | { readonly todo: true; readonly checked: boolean; readonly index: number; readonly text: string };

export function minutesBlocks(md: string, { flows = false } = {}): Block[] {
  const out: Block[] = [];
  let list: ListItem[] | null = null;
  let todoIndex = 0;
  let skipping = false;
  let flowPlaced = false;
  let sawSummary = false;
  for (const line of md.split('\n')) {
    const todo = line.match(/^\s*- \[( |x)\]\s+(.*)$/i);
    const item = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) skipping = heading[1] === '##' && heading[2]!.trim() === '확인 필요';
    if (skipping) continue;
    if (todo || item) {
      if (!list) out.push({ kind: 'list', items: (list = []) });
      if (todo) list.push({ todo: true, checked: todo[1]!.trim() !== '', index: todoIndex++, text: todo[2]! });
      else list.push({ todo: false, text: item![1]! });
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    if (heading) {
      if (heading[1] === '#') continue; // 제목은 페이지 머리에 있다
      if (heading[1] === '##' && flows && !flowPlaced && sawSummary) {
        out.push({ kind: 'flows' });
        flowPlaced = true;
      }
      if (heading[1] === '##') sawSummary = heading[2]!.trim() === '요약';
      out.push({ kind: heading[1] === '##' ? 'h3' : 'h4', text: heading[2]! });
    } else out.push({ kind: 'p', text: line });
  }
  if (flows && !flowPlaced) out.push({ kind: 'flows' });
  return out;
}

export type Inline =
  | { readonly kind: 'bold' | 'text'; readonly text: string }
  /** (12:34, 15:00) 시각들과 바로 뒤 문장부호 — 한 덩어리로 묶어 마침표만 다음 줄로 넘어가지 않게 */
  | { readonly kind: 'stamps'; readonly times: readonly string[]; readonly punct: string };

/** 한 줄 안: 굵게 · 글 · 시각 묶음. 시각은 굵게 밖에서만 */
export function inlinePieces(text: string): Inline[] {
  const out: Inline[] = [];
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (!part) return;
    if (i % 2) {
      out.push({ kind: 'bold', text: part });
      return;
    }
    const segs = part.split(/(\(\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*,\s*\d{1,2}:\d{2}(?::\d{2})?)*\s*\))/);
    segs.forEach((seg, j) => {
      if (j % 2 === 0) {
        if (seg) out.push({ kind: 'text', text: seg });
        return;
      }
      const punct = /^[.,;:!?…)\]」』]+/.exec(segs[j + 1] ?? '')?.[0] ?? '';
      if (punct) segs[j + 1] = segs[j + 1]!.slice(punct.length);
      out.push({ kind: 'stamps', times: seg.match(/\d{1,2}:\d{2}(?::\d{2})?/g) ?? [], punct });
    });
  });
  return out;
}
