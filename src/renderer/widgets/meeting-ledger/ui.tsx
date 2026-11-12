// 회의 장부 줄과 달별 장부 (옛 ledgerRows·monthSections와 같은 마크업)
import type { MouseEvent } from 'react';
import { meetTitle, RowState, type MeetingItem } from '../../entities/meeting/index.ts';
import { clock, TIME } from '../../shared/lib/index.ts';
import { Icon, Num } from '../../shared/ui/index.tsx';
import { ledgerRows, type LedgerYear } from './model.ts';

export interface LedgerActions {
  /** 열어서 회의록 만들기·다시 만들기 */
  readonly openMeeting: (r: MeetingItem) => void;
  /** 확인 창을 거쳐 휴지통으로 */
  readonly trash: (list: readonly MeetingItem[]) => void;
}

/** 줄 안의 버튼: 누르면 줄(링크)로 가지 않게 */
const stopThen = (fn: () => void) => (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  fn();
};

/** 화자 수만큼 색 점 (6개까지) */
export function SpeakerDots({ n }: { readonly n: number | undefined }) {
  if (!n) return <span />;
  return (
    <span className="speakers" title={`화자 ${n}명`}>
      {Array.from({ length: Math.min(n, 6) }, (_, i) => <i key={i} style={{ background: `var(--s${i + 1})` }} />)}
    </span>
  );
}

export function LedgerRows({ list, recent = false, actions }: { readonly list: readonly MeetingItem[]; readonly recent?: boolean; readonly actions: LedgerActions }) {
  return ledgerRows(list, { recent }).map((row) => {
    const { r, st } = row;
    return (
      <a key={r.id} className={`lrow${row.first ? ' daystart' : ''}`} href={`#meeting/${encodeURIComponent(r.id)}`}>
        {row.first ? <span className={`lday${row.weekend ? ' weekend' : ''}`}>{row.day}<small>{row.small}</small></span> : <span />}
        <time className="ltime">{TIME.format(new Date(r.startedAt))}</time>
        <span className={`ltitle${row.muted ? ' muted' : ''}`}>
          <b>{meetTitle(r)}</b>
          {row.sub ? <span className={row.sub.why ? 'why' : undefined}>{row.sub.text}</span> : null}
        </span>
        <RowState r={r} />
        <Num>{clock(r.durationSec)}</Num>
        <SpeakerDots n={r.minutes?.speakers} />
        <span className="racts">
          {row.redo ? (
            <button className="icon-btn" title={st === 'fail' ? '열어서 다시 만들기' : '열어서 회의록 만들기'} aria-label="다시 만들기" onClick={stopThen(() => actions.openMeeting(r))}>
              <Icon id="i-redo" />
            </button>
          ) : null}
          {row.trash ? (
            <button className="icon-btn" title="휴지통으로" aria-label="휴지통으로" onClick={stopThen(() => actions.trash([r]))}>
              <Icon id="i-trash" />
            </button>
          ) : null}
        </span>
      </a>
    );
  });
}

/** 달별 장부 섹션들 (바로가기는 YearNav) */
export function MonthSections({ years, actions }: { readonly years: readonly LedgerYear[]; readonly actions: LedgerActions }) {
  return years.flatMap((y) => y.months.map((mo, i) => (
    <section key={`${mo.id}:${i}`} className="ledger-month" id={mo.id} data-spy="">
      <div className="ledger-mhead"><h2>{mo.title}</h2><span>{mo.summary}</span></div>
      <LedgerRows list={mo.list} actions={actions} />
    </section>
  )));
}

/** 바로가기의 해 묶음: 올해는 늘 펼침, 지난 해는 접어 둠 (펼침은 스크롤 감시가 맡는다) */
export function YearNav({ years }: { readonly years: readonly LedgerYear[] }) {
  return years.map((y, i) => (
    <div key={`${y.year}:${i}`} className={`ygroup${y.current ? ' open fixed' : ''}`}>
      <button className="yhead" data-year-head="" data-target={y.months[0]?.id ?? ''}>
        {y.current ? `${y.year}년` : <><Icon id="i-right" />{`${y.year}년`}</>}
        {y.current ? null : <Num>{y.count}</Num>}
      </button>
      <div className="ymonths">
        <div className="ymonths-in">
          {y.months.map((mo, k) => <button key={`${mo.id}:${k}`} data-target={mo.id}>{mo.label}<Num>{mo.list.length}</Num></button>)}
        </div>
      </div>
    </div>
  ));
}

