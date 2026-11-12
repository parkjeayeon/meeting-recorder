// 회의 한 줄의 부품 (옛 rowState·jobCard와 같은 마크업)
import { clock, dayLabel, TIME } from '../../shared/lib/index.ts';
import { Icon } from '../../shared/ui/index.tsx';
import { busyShort, meetState, progressOf, statusText, type MeetingItem } from './model.ts';

const QUIET: Readonly<Record<string, string>> = { none: '녹음만', short: '짧은 녹음', empty: '들린 말 없음', plain: '회의록' };

/** 줄 목록의 상태: 바탕 없이 글자 + 작은 표시 (주홍은 실패만, 확인 남음은 점만) */
export function RowState({ r }: { readonly r: MeetingItem }) {
  const st = meetState(r);
  if (st === 'busy') return <span className="rs busy"><i />{busyShort(r.minutes)}</span>;
  if (st === 'fail') return <span className="rs fail"><Icon id="i-alert" />실패</span>;
  if (st === 'open') return <span className="rs open"><i />{`확인 ${r.review?.open}개`}</span>;
  if (st === 'draft') return <span className="rs draft"><i />마치기 전</span>;
  if (st === 'done') return <span className="rs done"><Icon id="i-check" />확정</span>;
  return <span className="rs">{QUIET[st]}</span>;
}

/** 회의록을 만드는 중인 회의 카드 (진행 막대) */
export function JobCard({ r }: { readonly r: MeetingItem }) {
  const p = progressOf(r.minutes);
  return (
    <a className="job" href={`#meeting/${encodeURIComponent(r.id)}`}>
      <b>{`${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))} 회의 · 회의록 만드는 중`}</b>
      <span className="pct">{p !== null ? `${Math.round(p * 100)}%` : ''}</span>
      <span className="sub">{`${statusText(r.minutes)} · 녹음 ${clock(r.durationSec)}`}</span>
      <div className={`bar${p === null ? ' indeterminate' : ''}`}><i style={{ width: `${Math.round((p ?? 0.3) * 100)}%` }} /></div>
    </a>
  );
}
