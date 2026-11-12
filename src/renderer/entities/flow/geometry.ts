// 흐름도 한 장의 자리 계산 (옛 화면 flowSvgH의 계산을 그대로): 상자 크기·줄·칸, 화살표 경로, 바뀐 경위 호, 메모 자리.
// 배치는 고정된 규칙: 띠(도구·담당)마다 가로줄, 같은 띠에서는 오른쪽으로, 띠를 바꾸면 같은 칸 위아래로 내려가고(꺾은선),
// 메모는 해당 단계 칸 아래에, 바뀐 경위는 해당 단계 위에 점선 호로. 글자 폭은 재는 함수(wrap)를 받는다.
import { FLOW, flowOrder, placeLanes } from './layout.ts';

export interface FlowLane {
  readonly id: string;
  readonly name: string;
  readonly desc?: string | null;
}
export interface FlowStepFull {
  readonly id: string;
  readonly title: string;
  readonly detail?: string | null;
  readonly lane?: string | null;
  readonly at: string;
  readonly quote?: string | null;
  readonly optional?: boolean;
}
export interface FlowNote {
  readonly step: string;
  readonly kind: string;
  readonly text: string;
  readonly at: string;
  readonly quote?: string | null;
}
export interface FlowDoc {
  readonly id: string;
  readonly title: string;
  readonly summary?: string | null;
  readonly lanes?: readonly FlowLane[];
  readonly steps: readonly FlowStepFull[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly notes?: readonly FlowNote[];
  readonly annotations?: readonly { readonly from: string; readonly to: string; readonly text: string; readonly at: string; readonly quote?: string | null }[];
}
/** 글을 줄로 (px·굵기의 글꼴로 maxW 안에, maxLines 넘으면 말줄임) */
export type Wrap = (text: unknown, px: number, weight: number, maxW: number, maxLines: number) => string[];

type Pos = { row: number; col: number };
/** 넓은 그림을 여러 줄로 접을 때 한 줄: 들어갈 단계·띠·칸, 번호(그림 전체 기준), 줄을 넘는 화살표 */
export interface FlowPart {
  readonly steps: readonly FlowStepFull[];
  readonly lanes: readonly FlowLane[];
  readonly pos: ReadonlyMap<string, Pos>;
  readonly number: ReadonlyMap<string, number>;
  readonly out: readonly { readonly from: string; readonly toNum: number }[];
  readonly in: readonly { readonly to: string; readonly fromNum: number }[];
}

export interface FlowGeometry {
  readonly W: number;
  readonly H: number;
  readonly BW: number;
  readonly BH: number;
  readonly PAD: number;
  readonly LABEL: number;
  readonly lanes: readonly { readonly id: string; readonly name: string; readonly color: string; readonly band: { y: number; h: number }; readonly top: number; readonly desc: readonly string[] }[];
  readonly edges: readonly string[];
  readonly arcs: readonly { readonly d: string; readonly x: number; readonly y: number; readonly text: string }[];
  readonly steps: readonly { readonly s: FlowStepFull; readonly x: number; readonly y: number; readonly num: number; readonly color: string; readonly title: readonly string[]; readonly detail: readonly string[] }[];
  readonly out: readonly { readonly d: string; readonly x: number; readonly y: number; readonly toNum: number }[];
  readonly in: readonly { readonly d: string; readonly x: number; readonly y: number; readonly fromNum: number }[];
  readonly notes: readonly { readonly n: FlowNote; readonly lines: readonly string[]; readonly x: number; readonly y: number; readonly h: number; readonly num: number | undefined }[];
  /** 접기 계산에 쓰는 것 */
  readonly layout: { readonly steps: readonly FlowStepFull[]; readonly lanes: readonly FlowLane[]; readonly cols: number };
}

export function flowGeometry(f: FlowDoc, wrap: Wrap, part: FlowPart | null = null, per = 4): FlowGeometry {
  const { BW, GX, GY, PAD } = FLOW;
  const allLanes = (f.lanes?.length ?? 0) > 1 ? f.lanes! : [];
  const steps = part?.steps ?? flowOrder(f);
  const lanes = part?.lanes ?? allLanes;
  const notesIn: FlowNote[] = [...(f.notes ?? [])];
  let arcs: NonNullable<FlowDoc['annotations']>[number][] = [];
  const laneIdx = new Map<string | null | undefined, number>(lanes.map((l, i) => [l.id, i]));
  const colorIdx = new Map<string | null | undefined, number>(allLanes.map((l, i) => [l.id, i]));
  const laneColor = (id: string | null | undefined) => (colorIdx.has(id) ? `var(--s${(colorIdx.get(id)! % 6) + 1})` : 'var(--ink)');
  const numOf = part?.number ?? new Map(steps.map((s, i) => [s.id, i + 1]));
  const LABEL = lanes.length ? FLOW.LABEL : 0;
  // 칸 정하기 (접은 줄이면 이미 정해 왔다)
  const pos = new Map<string, Pos>(part?.pos ?? []);
  if (!part) {
    if (lanes.length) for (const [id, p] of placeLanes(steps, laneIdx)) pos.set(id, p);
    else steps.forEach((s, i) => pos.set(s.id, { row: Math.floor(i / per), col: i % per }));
  }
  // 바뀐 경위: 같은 줄의 서로 다른 두 단계를 잇는 것만 호로, 나머지는 그 단계의 메모(정보)로
  for (const a of f.annotations ?? []) {
    const p = pos.get(a.from);
    const q = pos.get(a.to);
    if (!p || !q) continue;
    if (p.row === q.row && a.from !== a.to) arcs.push(a);
    else notesIn.push({ step: a.to, kind: 'info', text: a.text, at: a.at, quote: a.quote });
  }
  arcs = arcs.slice(0, 2);
  const rows = Math.max(...[...pos.values()].map((p) => p.row)) + 1;
  const cols = Math.max(...[...pos.values()].map((p) => p.col)) + 1;
  // 상자 높이: 가장 긴 내용에 맞춘다
  const box = new Map(steps.map((s) => [s.id, { title: wrap(s.title, 14, 700, BW - (s.optional ? 82 : 52), 2), detail: wrap(s.detail, 12.5, 400, BW - 28, 3) }]));
  const BH = 30 + Math.max(...[...box.values()].map((b) => b.title.length * 19 + b.detail.length * 18)) + 34;
  // 줄마다 위쪽 여유: 바뀐 경위 호가 있으면 더
  const annRows = new Set(arcs.map((a) => pos.get(a.from)!.row));
  const rowTop: number[] = [];
  let y = PAD + (annRows.has(0) ? 30 : 4);
  for (let i = 0; i < rows; i++) {
    if (i) y += annRows.has(i) ? 30 : 0;
    rowTop.push(y);
    y += BH + GY;
  }
  const IN = part?.in?.length ? 64 : 0; // 앞 줄에서 이어지는 화살표 자리
  const xOf = (c: number) => PAD + LABEL + IN + c * (BW + GX);
  const bandTop = (i: number) => rowTop[i]! - (annRows.has(i) ? 26 : 10);
  const bandBottom = (i: number) => rowTop[i]! + BH + 10;
  const gapY = (i: number) => (i + 1 < rows ? (bandBottom(i) + bandTop(i + 1)) / 2 : bandBottom(i) + GY / 2); // i줄과 i+1줄 사이
  const at = (id: string) => {
    const p = pos.get(id)!;
    return { x: xOf(p.col), y: rowTop[p.row]!, ...p };
  };
  // 메모: 단계 칸 아래에 쌓는다
  const notesTop = rowTop[rows - 1]! + BH + 26;
  const notes: { n: FlowNote; lines: string[]; x: number; y: number; h: number; num: number | undefined }[] = [];
  const colY = new Map<number, number>();
  for (const n of notesIn) {
    if (!pos.has(n.step)) continue;
    const lines = wrap(n.text, 12.5, 400, BW - 44, 4);
    const h = 18 + lines.length * 18 + 26;
    const c = pos.get(n.step)!.col;
    const ny = colY.get(c) ?? notesTop;
    notes.push({ n, lines, x: xOf(c), y: ny, h, num: numOf.get(n.step) });
    colY.set(c, ny + h + 10);
  }
  const W = xOf(cols) - GX + PAD + (part?.out?.length ? 70 : 0);
  const H = Math.max(notesTop - 26, ...notes.map((b) => b.y + b.h)) + PAD;

  const edges: string[] = [];
  for (const e of f.edges ?? []) {
    if (!pos.has(e.from) || !pos.has(e.to)) continue;
    const a = at(e.from);
    const b = at(e.to);
    let d: string;
    if (a.row === b.row && b.col > a.col) d = `M${a.x + BW} ${a.y + BH / 2} L${b.x - 3} ${b.y + BH / 2}`;
    else if (a.row === b.row) d = `M${a.x + BW / 2} ${a.y} V${a.y - 14} H${b.x + BW / 2} V${b.y - 3}`;
    else if (a.col === b.col && Math.abs(b.row - a.row) === 1) d = b.row > a.row ? `M${a.x + BW / 2} ${a.y + BH} V${b.y - 3}` : `M${a.x + BW / 2} ${a.y} V${b.y + BH + 3}`;
    // 다른 줄·다른 칸: 세로 → 두 줄 사이 빈 곳에서 가로 → 세로로 꺾어 상자·글을 가로지르지 않는다.
    // 두 줄 이상 건너가면 상자 옆면(받는 단계 쪽)에서 나가 칸 사이 세로 통로로 내려간다 (같은 칸이면 오른쪽 통로)
    else if (Math.abs(b.row - a.row) > 1) {
      const left = b.col < a.col;
      const sx = left ? a.x : a.x + BW;
      const lane = left ? a.x - GX / 2 : a.x + BW + GX / 2;
      const down = b.row > a.row;
      d = `M${sx} ${a.y + BH / 2} H${lane} V${down ? gapY(b.row - 1) : gapY(b.row)} H${b.x + BW / 2} V${down ? b.y - 3 : b.y + BH + 3}`;
    } else if (b.row > a.row) d = `M${a.x + BW / 2} ${a.y + BH} V${gapY(a.row)} H${b.x + BW / 2} V${b.y - 3}`;
    else d = `M${a.x + BW / 2} ${a.y} V${gapY(b.row)} H${b.x + BW / 2} V${b.y + BH + 3}`;
    edges.push(d);
  }
  return {
    W, H, BW, BH, PAD, LABEL,
    lanes: lanes.map((l, i) => ({ id: l.id, name: l.name, color: laneColor(l.id), band: { y: bandTop(i), h: bandBottom(i) - bandTop(i) }, top: rowTop[i]!, desc: wrap(l.desc, 11.5, 400, LABEL - 22, 3) })),
    edges,
    arcs: arcs.map((a) => {
      const p = at(a.from);
      const q = at(a.to);
      const x1 = Math.min(p.x, q.x) + BW / 2 - 40;
      const x2 = Math.max(p.x, q.x) + BW / 2 + 40;
      const top = q.y - 6;
      return { d: `M${x1} ${top} Q${(x1 + x2) / 2} ${top - 22} ${x2} ${top}`, x: (x1 + x2) / 2, y: top - 16, text: a.text };
    }),
    steps: steps.map((s) => {
      const p = at(s.id);
      const b = box.get(s.id)!;
      return { s, x: p.x, y: p.y, num: numOf.get(s.id)!, color: laneColor(s.lane), title: b.title, detail: b.detail };
    }),
    // 줄을 넘어가는 화살표: 오른쪽 끝으로 '다음 줄 N번으로', 왼쪽 끝에서 'N번에서 이어짐'
    out: (part?.out ?? []).map((o) => {
      const p = at(o.from);
      return { d: `M${p.x + BW} ${p.y + BH / 2} H${W - PAD + 2}`, x: W - PAD, y: p.y + BH / 2 - 8, toNum: o.toNum };
    }),
    in: (part?.in ?? []).map((o) => {
      const p = at(o.to);
      const x0 = PAD + LABEL + 4;
      return { d: `M${x0} ${p.y + BH / 2} H${p.x - 3}`, x: x0, y: p.y + BH / 2 - 8, fromNum: o.fromNum };
    }),
    notes,
    layout: { steps, lanes, cols },
  };
}

/** 그림 놓을 폭(avail)보다 많이(80% 넘게 줄여야) 넓으면 여러 줄로 접는다: 단계 순서대로 앞에서부터 한 줄을 채우고,
 *  들어갈 칸을 넘으면 다음 줄로 — 줄마다 배치를 새로 계산해 번호 순서가 섞이지 않고 세로로 길게 늘이지 않는다.
 *  띠 없는 흐름은 한 줄 칸 수(per)만 줄인다. 접지 않으면 null */
export function foldFlow(f: FlowDoc, wide: FlowGeometry, avail: number | null): { per: number } | { parts: FlowPart[] } | null {
  if (!avail || wide.W * 0.8 <= avail) return null;
  const { BW, GX, PAD } = FLOW;
  const { steps, lanes } = wide.layout;
  const label = lanes.length ? FLOW.LABEL : 0;
  const per = Math.max(2, Math.floor((avail / 0.85 - 2 * PAD - label - 70 - 64 + GX) / (BW + GX)));
  if (!lanes.length) return { per };
  const laneIdx = new Map<string | null | undefined, number>(lanes.map((l, i) => [l.id, i]));
  const chunks: FlowStepFull[][] = [];
  let cur: FlowStepFull[] = [];
  for (const st of steps) {
    const next = [...cur, st];
    const cols = Math.max(...[...placeLanes(next, laneIdx).values()].map((p) => p.col)) + 1;
    if (cur.length && cols > per) {
      chunks.push(cur);
      cur = [st];
    } else cur = next;
  }
  if (cur.length) chunks.push(cur);
  const number = new Map(steps.map((st, i) => [st.id, i + 1]));
  return {
    parts: chunks.map((part) => {
      const partLanes = lanes.filter((l) => part.some((st) => st.lane === l.id));
      const rowOf = new Map<string | null | undefined, number>(partLanes.map((l, i) => [l.id, i]));
      const ids = new Set(part.map((st) => st.id));
      return {
        steps: part,
        lanes: partLanes,
        pos: placeLanes(part, rowOf),
        number,
        out: f.edges.filter((e) => ids.has(e.from) && !ids.has(e.to) && number.has(e.to)).map((e) => ({ from: e.from, toNum: number.get(e.to)! })),
        in: f.edges.filter((e) => ids.has(e.to) && !ids.has(e.from) && number.has(e.from)).map((e) => ({ to: e.to, fromNum: number.get(e.from)! })),
      };
    }),
  };
}
