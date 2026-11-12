// 정리본·원본 스크립트 (div.script 안)와 화자 — 줄마다 시각(눌러서 듣기)·화자(눌러서 이름 바꾸기)·말(용어 밑줄).
// 지금 재생 중인 줄은 playing (따라가기면 그 줄로 화면을 옮긴다). 이름 바꾸기는 그 자리에서 입력칸으로 (Enter·밖을 누르면 저장, Esc는 취소).
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clock, parseStamp, speakerStats, type ScriptLine } from '../../../core/script.mts';
import { TermText, type Term, type TermMatcher } from '../../entities/minutes/index.ts';
import { fmt } from '../../shared/lib/index.ts';
import { Icon, useNativeEvent } from '../../shared/ui/index.tsx';
import type { Playback } from './playback.ts';

/** 이름 바꾸기: to가 null이면 그만둠. 끝나면 주인이 다시 그린다 */
export type Rename = (from: string, to: string | null) => void;

/** 그 자리 이름 입력칸 (옛 renameSpeaker: input.rename) */
function RenameInput({ from, rename }: { readonly from: string; readonly rename: Rename }) {
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const to = input.current!.value.trim();
    rename(from, save && to && to !== from ? to : null);
  };
  useLayoutEffect(() => {
    input.current!.value = from;
    input.current!.focus();
    input.current!.select();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 열 때 한 번
  useNativeEvent(input, 'keydown', (_el, e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter') finish(true);
    if (k === 'Escape') finish(false);
  });
  useNativeEvent(input, 'blur', () => finish(true));
  return <input ref={input} type="text" className="rename" />;
}

export interface ScriptProps {
  readonly lines: readonly ScriptLine[];
  readonly color: (who: string) => string;
  readonly playback: Playback;
  readonly matcher: TermMatcher | null;
  readonly openTerm: (anchor: HTMLElement, t: Term) => void;
  readonly rename: Rename;
}

/** 지금 시각 직전의 줄 (이진 탐색). 멈춰 있고 0초면 없음 */
export function playingIndex(times: readonly number[], t: number, atStart: boolean): number {
  if (atStart) return -1;
  let lo = 0;
  let hi = times.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return idx;
}

export function ScriptBody({ lines, color, playback, matcher, openTerm, rename }: ScriptProps) {
  const s = useSyncExternalStore(playback.subscribe, playback.getSnapshot);
  const [renaming, setRenaming] = useState<number | null>(null); // 이름을 고치는 줄
  const timed = lines.map((l, i) => [l, i] as const).filter(([l]) => l.at !== null);
  const playing = playingIndex(timed.map(([l]) => l.at!), s.time, s.paused && s.time === 0);
  const playingLine = playing >= 0 ? timed[playing]![1] : -1;
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  // 따라가기: 재생 중에 줄이 바뀌면 그 줄을 가운데로
  const last = useRef(-1);
  useLayoutEffect(() => {
    if (playingLine === last.current) return;
    last.current = playingLine;
    if (playingLine >= 0 && s.follow && !s.paused) rows.current[playingLine]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  return lines.map((l, i) => (
    <div key={i} ref={(el) => void (rows.current[i] = el)} className={i === playingLine ? 'sline playing' : 'sline'}>
      <button className="stime" title="여기부터 듣기" onClick={() => l.at !== null && playback.seek(l.at)}>{l.stamp}</button>
      {l.who ? (renaming === i ? <RenameInput from={l.who} rename={rename} /> : (
        <button className="who" title="눌러서 이름 바꾸기" onClick={() => setRenaming(i)}><i style={{ background: color(l.who) }} />{l.who}</button>
      )) : <span />}
      <span className="ssaid"><TermText text={l.said} matcher={matcher} open={openTerm} /></span>
    </div>
  ));
}

/** 페이지 위 화자 줄 (div.spk-bar 안): 이름을 누르면 바꾼다 */
export function SpeakerBarBody({ order, color, rename }: { readonly order: readonly string[]; readonly color: (who: string) => string; readonly rename: Rename }) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const generic = order.some((w) => /^화자 \d+$/.test(w));
  return (
    <>
      <span className="spk-bar-label">화자</span>
      {order.map((who, i) => (renaming === i ? <RenameInput key={who} from={who} rename={rename} /> : (
        <button key={who} className="spk-chip" title="눌러서 이름 바꾸기" onClick={() => setRenaming(i)}>
          <i style={{ background: color(who) }} /><span>{who}</span><Icon id="i-pencil" />
        </button>
      )))}
      {generic ? <span className="spk-bar-hint">이름을 누르면 바꿀 수 있습니다. 회의록과 스크립트에 모두 반영됩니다.</span> : null}
    </>
  );
}

/** 화자 탭 (div.spk-list 안): 사람마다 말한 비율·시간·줄 수·처음 말한 시각 */
export function SpeakersBody({ raw, total, color, seek, rename }: { readonly raw: readonly ScriptLine[]; readonly total: number; readonly color: (who: string) => string; readonly seek: (sec: number) => void; readonly rename: Rename }) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const stats = speakerStats([...raw], total);
  const sum = stats.reduce((n, x) => n + x.sec, 0) || 1;
  return (
    <>
      <p className="hint" style={{ margin: '0 0 6px' }}>이름을 누르면 바꿀 수 있습니다. 말한 시간은 스크립트 줄 간격으로 어림한 값입니다.</p>
      {stats.map((x, i) => (
        <div key={x.who} className="spk">
          <div className="spk-name">
            <i style={{ background: color(x.who) }} />
            {renaming === i ? <RenameInput from={x.who} rename={rename} /> : <button onClick={() => setRenaming(i)}>{x.who}</button>}
          </div>
          <div className="share"><i style={{ width: `${(x.sec / sum) * 100}%`, background: color(x.who) }} /></div>
          <span className="num">{`${Math.round((x.sec / sum) * 100)}%`}</span>
          <div className="spk-sub">{`약 ${clock(x.sec)} · ${fmt.format(x.lines)}줄 · 처음 말한 시각 `}<button className="seek" onClick={() => seek(parseStamp(x.first))}>{x.first}</button></div>
        </div>
      ))}
    </>
  );
}
