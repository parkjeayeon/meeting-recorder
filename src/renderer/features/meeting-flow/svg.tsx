// 흐름도 그림(SVG). 자리는 entities/flow의 flowGeometry가 계산하고 여기는 그리기만 — 옛 화면과 같은 요소·같은 순서.
// 색은 앱 값(CSS 변수·클래스), LLM 글은 글자로만 넣는다.
import { useMemo } from 'react';
import { parseStamp } from '../../../core/script.mts';
import { flowGeometry, foldFlow, wrapLines, type FlowDoc, type FlowPart, type Wrap } from '../../entities/flow/index.ts';

let measureCtx: CanvasRenderingContext2D | null = null;
/** 글자 폭을 재서 줄을 나눈다 (본문 글꼴로) */
export const wrapText: Wrap = (text, px, weight, maxW, maxLines) => {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${weight} ${px}px ${getComputedStyle(document.body).fontFamily}`;
  return wrapLines(text, (t) => measureCtx!.measureText(t).width <= maxW, maxLines);
};

/** 시각 칩: 녹음이 있으면 눌러서 그 자리부터 듣기 */
function Stamp({ x, y, t, seek }: { readonly x: number; readonly y: number; readonly t: string; readonly seek: ((sec: number) => void) | null }) {
  return (
    <g className={`fl-stamp${seek ? ' play' : ''}`} transform={`translate(${x} ${y})`} onClick={seek ? () => seek(parseStamp(t)) : undefined}>
      <rect width={10 + t.length * 7.3} height={19} rx={5} />
      <text x={5} y={13.5}>{t}</text>
      {seek ? <title>여기부터 듣기</title> : null}
    </g>
  );
}

export interface FlowSvgProps {
  readonly f: FlowDoc;
  readonly seek: ((sec: number) => void) | null;
  readonly part?: FlowPart | null;
  /** 띠 없는 흐름의 한 줄 칸 수 */
  readonly per?: number;
  readonly wrap?: Wrap;
}

export function FlowSvg({ f, seek, part = null, per = 4, wrap = wrapText }: FlowSvgProps) {
  const g = flowGeometry(f, wrap, part, per);
  const mid = useMemo(() => `fl-arrow-${f.id}-${Math.random().toString(36).slice(2, 7)}`, [f.id]);
  const { W, H, BW, BH } = g;
  return (
    // 앱 전체 svg 규칙(아이콘 16px)보다 앞서게. 넓으면 화면 폭에 맞춰 줄인다 (원래 크기보다 키우지는 않음)
    <svg className="flow-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={f.title} style={{ width: '100%', maxWidth: `${W}px`, height: 'auto' }}>
      <defs>
        <marker id={mid} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="fl-arrowhead" />
        </marker>
      </defs>
      {g.lanes.map((l) => [
        <rect key={`b${l.id}`} x={g.PAD - 6} y={l.band.y} width={W - 2 * g.PAD + 12} height={l.band.h} rx={12} className="fl-lane" />,
        <text key={`n${l.id}`} x={g.PAD + 8} y={l.top + 20} className="fl-lane-name" style={{ fill: l.color }}>{l.name}</text>,
        ...l.desc.map((t, k) => <text key={`d${l.id}${k}`} x={g.PAD + 8} y={l.top + 40 + k * 16} className="fl-lane-desc">{t}</text>),
      ])}
      {/* 화살표 (상자 밑에 그린다) */}
      <g className="fl-edges">
        {g.edges.map((d, i) => <path key={i} d={d} className="fl-edge" markerEnd={`url(#${mid})`} />)}
      </g>
      {/* 바뀐 경위: 해당 단계들 위에 점선 호와 글 */}
      {g.arcs.map((a, i) => [
        <path key={`a${i}`} d={a.d} className="fl-anno-arc" />,
        <text key={`t${i}`} x={a.x} y={a.y} className="fl-anno">{a.text}</text>,
      ])}
      {g.steps.map(({ s, x, y, num, color, title, detail }) => (
        <g key={s.id} className={`fl-step${s.optional ? ' optional' : ''}`} transform={`translate(${x} ${y})`}>
          <title>{`녹취: “${s.quote}”`}</title>
          <rect width={BW} height={BH} rx={12} className="fl-box" />
          <circle cx={21} cy={23} r={11} style={{ fill: color }} />
          <text x={21} y={27.5} className="fl-num">{String(num)}</text>
          {title.map((t, k) => <text key={`t${k}`} x={40} y={28 + k * 19} className="fl-title">{t}</text>)}
          {detail.map((t, k) => <text key={`d${k}`} x={14} y={30 + title.length * 19 + 6 + k * 18} className="fl-detail">{t}</text>)}
          {s.optional ? <text x={BW - 12} y={27} className="fl-tag">선택</text> : null}
          <Stamp x={14} y={BH - 30} t={s.at} seek={seek} />
        </g>
      ))}
      {/* 줄을 넘어가는 화살표: 오른쪽 끝으로 '다음 줄 N번으로', 왼쪽 끝에서 'N번에서 이어짐' */}
      {g.out.map((o, i) => [
        <path key={`op${i}`} d={o.d} className="fl-edge" markerEnd={`url(#${mid})`} />,
        <text key={`ot${i}`} x={o.x} y={o.y} className="fl-cont end">{`다음 줄 ${o.toNum}번으로`}</text>,
      ])}
      {g.in.map((o, i) => [
        <path key={`ip${i}`} d={o.d} className="fl-edge dashed" markerEnd={`url(#${mid})`} />,
        <text key={`it${i}`} x={o.x} y={o.y} className="fl-cont">{`${o.fromNum}번에서`}</text>,
      ])}
      {/* 메모 */}
      {g.notes.map(({ n, lines, x, y, h, num }, i) => (
        <g key={i} className={`fl-note ${n.kind}`} transform={`translate(${x} ${y})`}>
          <rect width={BW} height={h} rx={10} />
          <circle cx={16} cy={18} r={8} />
          <text x={16} y={22} className="fl-note-icon">{n.kind === 'info' ? 'i' : '!'}</text>
          <text x={BW - 12} y={h - 15} className="fl-note-step">{`${num}번 단계`}</text>
          {lines.map((t, k) => <text key={k} x={32} y={22 + k * 18} className="fl-note-text">{t}</text>)}
          <Stamp x={32} y={h - 28} t={n.at} seek={seek} />
        </g>
      ))}
    </svg>
  );
}

/** 그림 놓을 폭에 맞춰: 넓으면 여러 줄(div.flow-parts)로 접는다 */
export function FlowCanvas({ f, seek, avail, wrap = wrapText }: { readonly f: FlowDoc; readonly seek: ((sec: number) => void) | null; readonly avail: number | null; readonly wrap?: Wrap }) {
  const fold = foldFlow(f, flowGeometry(f, wrap), avail);
  if (!fold) return <FlowSvg f={f} seek={seek} wrap={wrap} />;
  if ('per' in fold) return <FlowSvg f={f} seek={seek} per={fold.per} wrap={wrap} />;
  return <div className="flow-parts">{fold.parts.map((p, i) => <FlowSvg key={i} f={f} seek={seek} part={p} wrap={wrap} />)}</div>;
}
