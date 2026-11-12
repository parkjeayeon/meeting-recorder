// 흐름도 배치의 계산 (src/flow.js가 만든 flow.json을 그릴 때). 그리기(SVG)는 화면 쪽, 여기는 순서·칸·줄 나누기만.

export interface FlowStep {
  readonly id: string;
  readonly lane?: string | null;
}
export interface Flow<S extends FlowStep = FlowStep> {
  readonly steps: readonly S[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
}

/** 상자 폭·가로 간격·세로 간격·여백·띠 이름 칸 (px) */
export const FLOW = { BW: 164, GX: 36, GY: 46, PAD: 18, LABEL: 104 } as const;

/** 화살표 순서대로 단계를 늘어놓는다 (들어오는 화살표가 없는 단계부터, 갈래는 나온 순서대로, 남은 것은 원래 순서) */
export function flowOrder<S extends FlowStep>(f: Flow<S>): S[] {
  const next = new Map<string, string[]>(f.steps.map((s) => [s.id, []]));
  const into = new Set<string>();
  for (const e of f.edges) {
    next.get(e.from)?.push(e.to);
    into.add(e.to);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !next.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const n of next.get(id)!) visit(n);
  };
  for (const s of f.steps) if (!into.has(s.id)) visit(s.id);
  for (const s of f.steps) visit(s.id);
  return out.map((id) => f.steps.find((s) => s.id === id)!);
}

/** 띠가 있는 흐름의 칸: 같은 띠는 오른쪽으로, 띠를 바꾸면 같은 칸 위아래로 (처음 들어가는 빈 띠만 한 칸 당겨 폭을 줄인다) */
export function placeLanes(steps: readonly FlowStep[], laneIdx: ReadonlyMap<string | null | undefined, number>): Map<string, { row: number; col: number }> {
  const pos = new Map<string, { row: number; col: number }>();
  const last = new Map<number, number>();
  let prev: { row: number; col: number } | null = null;
  for (const s of steps) {
    const row = laneIdx.get(s.lane) ?? 0;
    const after = (last.get(row) ?? -1) + 1;
    const col: number = !prev ? 0 : prev.row === row ? prev.col + 1 : last.has(row) ? Math.max(after, prev.col) : Math.max(after, prev.col - 1);
    last.set(row, col);
    prev = { row, col };
    pos.set(s.id, prev);
  }
  return pos;
}

/** 글자 폭(fits: 이 글이 한 줄에 들어가나)으로 줄을 나눈다 (낱말 단위, 너무 긴 낱말은 글자 단위), 넘치면 말줄임 */
export function wrapLines(text: unknown, fits: (t: string) => boolean, maxLines: number): string[] {
  const lines: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(/(\s+)/)) {
      if (fits(cur + word)) cur += word;
      else if (fits(word.trim())) {
        lines.push(cur.trim());
        cur = word.trim();
      } else {
        for (const ch of word) {
          if (fits(cur + ch)) cur += ch;
          else {
            lines.push(cur);
            cur = ch.trim();
          }
        }
      }
    }
    lines.push(cur.trim());
  }
  const out = lines.filter((l, i) => l || i === 0);
  if (out.length > maxLines) {
    out.length = maxLines;
    let last = out[maxLines - 1]!;
    while (last && !fits(`${last}…`)) last = last.slice(0, -1);
    out[maxLines - 1] = `${last}…`;
  }
  return out;
}
