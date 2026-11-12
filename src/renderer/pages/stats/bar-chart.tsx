// 최근 14일 받아쓴 글자 막대 (옛 barChart와 같은 SVG·같은 클래스). 막대에 마우스를 올리면 그날의 글자 수·횟수
import { useRef, useState } from 'react';
import { DAY, fmt } from '../../shared/lib/index.ts';
import { Num } from '../../shared/ui/index.tsx';
import type { StatsDay } from './model.ts';

const W = 700;
const H = 200;
const pad = { l: 40, r: 8, t: 10, b: 24 };

export function BarChart({ days }: { readonly days: readonly StatsDay[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<{ day: StatsDay; left: number; top: number } | null>(null);
  const max = Math.max(...days.map((d) => d.chars), 10);
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / days.length;
  return (
    <div className="chart">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="최근 14일 하루별 받아쓴 글자 수">
        {[0, 0.5, 1].map((f) => {
          const y = pad.t + ih - f * ih;
          return [
            <line key={`l${f}`} className="gridline" x1={pad.l} x2={W - pad.r} y1={y} y2={y} />,
            <text key={`t${f}`} className="axis" x={pad.l - 8} y={y + 3.5} textAnchor="end">{fmt.format(Math.round(top * f))}</text>,
          ];
        })}
        {days.map((d, i) => {
          const x = pad.l + i * bw + bw * 0.22;
          const w = bw * 0.56;
          const bh = d.chars ? Math.max(3, (d.chars / top) * ih) : 2;
          const y = pad.t + ih - bh;
          const r = Math.min(4, w / 2, bh); // 위쪽 끝만 둥글게 (아래는 기준선에 붙는다)
          const show = () => {
            const rect = svg.current?.getBoundingClientRect();
            if (rect) setTip({ day: d, left: ((x + w / 2) / W) * rect.width, top: (y / H) * rect.height });
          };
          return [
            <rect key={`h${i}`} className="hit" x={pad.l + i * bw} y={pad.t} width={bw} height={ih} onMouseEnter={show} onMouseLeave={() => setTip(null)} />,
            <path key={`b${i}`} className={`barmark${d.chars ? '' : ' zero'}`} d={`M${x},${y + bh}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + bh}Z`} />,
            (i % 2 === 1 || i === 13) && (
              <text key={`d${i}`} className="axis" x={x + w / 2} y={H - 6} textAnchor="middle">{i === 13 ? '오늘' : `${d.d.getMonth() + 1}/${d.d.getDate()}`}</text>
            ),
          ];
        })}
      </svg>
      <div className="tooltip" hidden={!tip} style={tip ? { left: `${tip.left}px`, top: `${tip.top}px` } : undefined}>
        {tip && (
          <>
            {`${DAY.format(tip.day.d)} · `}
            <Num>{`${fmt.format(tip.day.chars)}자`}</Num>
            {` · ${tip.day.count}회`}
          </>
        )}
      </div>
    </div>
  );
}
