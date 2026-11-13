import { Fragment, useRef, useSyncExternalStore } from 'react';
import type { Source } from '../../shared/lib/index.ts';
import { Icon, Num, useNativeEvent } from '../../shared/ui/index.tsx';

export interface PaletteItem {
  readonly icon: string;
  readonly title: string;
  readonly sub?: string;
  readonly meta?: string;
  readonly run: () => unknown;
}

export type PaletteGroup = readonly [label: string, items: readonly PaletteItem[]];

export interface PaletteView {
  readonly q: string;
  readonly groups: readonly PaletteGroup[];
  readonly selected: number;
  readonly instance: number;
}

interface PaletteActions {
  readonly select: (index: number) => void;
  readonly run: (index: number) => void;
}

function Item({ item, index, selected, select, run }: PaletteActions & { item: PaletteItem; index: number; selected: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useNativeEvent(ref, 'mouseenter', () => select(index));
  useNativeEvent(ref, 'click', () => run(index));
  // 빈 제목·설명이면 옛 h()처럼 빈 글자 노드를 붙인다(HTML을 같게). 목록은 그릴 때마다 새로 만들어 한 번만 붙는다
  return (
    <button ref={ref} className="pitem" role="option" aria-selected={selected ? 'true' : 'false'}>
      <Icon id={item.icon} /><span className="ptext" ref={(node) => { if (node && item.sub === '') node.append(''); }}>
        <b ref={(node) => { if (node && item.title === '') node.append(''); }}>{item.title}</b>{item.sub && <small>{item.sub}</small>}
      </span>{item.meta && <Num>{item.meta}</Num>}
    </button>
  );
}

export function PaletteList({ source, select, run }: PaletteActions & { source: Source<PaletteView | null> }) {
  const view = useSyncExternalStore(source.subscribe, source.getSnapshot);
  if (!view) return null;
  if (!view.groups.length) return <div key={view.instance} className="pempty">{`"${view.q}"에 맞는 것이 없습니다`}</div>;
  let i = 0;
  return <Fragment key={view.instance}>{view.groups.map(([label, items]) => (
    <Fragment key={label}>
      <div className="pgroup">{label}</div>
      {items.map((item) => {
        const index = i++;
        return <Item key={index} item={item} index={index} selected={index === view.selected} select={select} run={run} />;
      })}
    </Fragment>
  ))}</Fragment>;
}
