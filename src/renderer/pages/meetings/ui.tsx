// 회의 목록 (옛 pageMeetings를 그대로 옮김: 같은 글자·같은 클래스).
// 갈래(filter)는 주인의 상태다 — 질문으로 찾기가 탭을 열고, 홈의 챙길 일이 갈래를 골라 들어온다. 검색어는 이 화면 것.
// 질문 탭(칩과 본문)은 질문으로 찾기(features/ask)의 상태 주인(store)을 읽고 그 명령을 쓴다.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react';
import { askLabel, LiveSecs, type AskJob } from '../../entities/ask/index.ts';
import { AskTab, type AskStore } from '../../features/ask/index.ts';
import { FolderEmpty, type Issue } from '../../entities/issue/index.ts';
import { busyShort, LedgerRows, meetState, meetTitle, MonthSections, monthGroups, statusText, YearNav, type LedgerActions, type MeetingItem } from '../../entities/meeting/index.ts';
import { dayLabel, sizeLabel, TIME, type Source } from '../../shared/lib/index.ts';
import { Icon, Num, scrollSpy, SearchBox } from '../../shared/ui/index.tsx';
import { chips, HAND_MAX, mixed, pick, type Filter } from './model.ts';

/** 녹음 폴더에 있지만 목록에 안 나오는 폴더 (recordings:stray) */
export interface Stray {
  readonly id: string;
  readonly dir: string;
  readonly reason: string;
  readonly audio: boolean;
  readonly bytes: number;
}
export interface MeetingsInput {
  readonly meetings: readonly MeetingItem[];
  readonly strays: readonly Stray[];
  readonly folder: Issue | null;
  /** 'all' · 'final' · 'hand' · 'rest' · 'ask:<질문 id>' */
  readonly filter: string;
  /** 탭으로 보일 질문 (막힌 질문 뺌, 오래된 것부터) */
  readonly asks: readonly AskJob[];
}
export interface MeetingsActions extends LedgerActions {
  readonly setFilter: (id: string) => void;
  /** 확인 필요 탭을 열며 들어간다 */
  readonly openReview: (r: MeetingItem) => void;
  readonly trashStrays: (list: readonly Stray[]) => void;
  readonly reveal: (dir: string) => void;
  /** 파일 고르기(paths 없음) 또는 끌어다 놓은 파일 */
  readonly importMeeting: (paths?: readonly string[]) => void;
  readonly openMeetingStart: () => void;
  readonly filePath: (f: File) => string | null;
}

const STRAY_REASON: Readonly<Record<string, string>> = {
  'bad-name': '폴더 이름에서 날짜를 읽지 못함',
  'no-meta': '녹음이 끊겨 회의 정보(meta.json)가 없음',
  'bad-meta': '회의 정보(meta.json)가 깨짐',
  'old-memo': '예전 버전이 남긴 받아쓰기 녹음 (글 없음)',
};
const href = (r: MeetingItem) => `#meeting/${encodeURIComponent(r.id)}`;
const stopThen = (fn: () => void) => (e: { preventDefault(): void; stopPropagation(): void }) => {
  e.preventDefault();
  e.stopPropagation();
  fn();
};

// 목록에 안 나오는 폴더: 열 수 없으니 이유를 보여 주고 지울 수 있게 (휴지통으로, 되살릴 수 있음)
function StrayBox({ strays, actions }: { readonly strays: readonly Stray[]; readonly actions: MeetingsActions }) {
  return (
    <div className="stray">
      <div className="stray-head">
        <b>{`목록에 보이지 않는 폴더 ${strays.length}개`}</b>
        <span>녹음 폴더에 있지만 열 수 없는 폴더입니다. 필요 없으면 휴지통으로 옮기세요.</span>
        {strays.length > 1 ? <button className="btn small" onClick={() => actions.trashStrays(strays)}><Icon id="i-trash" />모두 휴지통으로</button> : null}
      </div>
      {strays.map((f) => (
        <div key={f.dir} className="stray-row">
          <span className="stray-name">{f.id}</span>
          <span className="status">{`${STRAY_REASON[f.reason] ?? f.reason} · ${f.audio ? '녹음 파일 있음' : '녹음 파일 없음'}`}</span>
          <Num>{sizeLabel(f.bytes)}</Num>
          <button className="icon-btn" title="Finder에서 보기" aria-label="Finder에서 보기" onClick={() => actions.reveal(f.dir)}><Icon id="i-folder" /></button>
          <button className="icon-btn" title="휴지통으로" aria-label="휴지통으로" onClick={() => actions.trashStrays([f])}><Icon id="i-trash" /></button>
        </div>
      ))}
    </div>
  );
}

// 카드의 상태: 알약
function CardState({ r }: { readonly r: MeetingItem }) {
  const st = meetState(r);
  if (st === 'busy') return <span className="tag accent busy">{busyShort(r.minutes)}</span>;
  if (st === 'fail') return <span className="tag fail">실패</span>;
  if (st === 'open') return <span className="tag accent">{`확인 ${r.review?.open}`}</span>;
  return <span className="tag">{st === 'draft' ? '마치기 전' : '녹음만'}</span>;
}

function HandCard({ r, actions }: { readonly r: MeetingItem; readonly actions: MeetingsActions }) {
  const st = meetState(r);
  const act = st === 'busy' ? <span className="hint" style={{ margin: 0 }}>{statusText(r.minutes)}</span>
    : st === 'fail' || st === 'none' ? <button className="btn small" onClick={stopThen(() => actions.openMeeting(r))}><Icon id="i-redo" />{st === 'fail' ? '다시 만들기' : '회의록 만들기'}</button>
    : <button className="btn small" onClick={stopThen(() => actions.openReview(r))}>{st === 'draft' ? <Icon id="i-check" /> : null}{st === 'draft' ? '확인 마치기' : '확인하기'}</button>;
  return (
    <a className="hcard" href={href(r)}>
      <div className="hcard-top"><span>{`${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))}`}</span><CardState r={r} /></div>
      <b>{meetTitle(r)}</b>
      <div className="hcard-act">{act}</div>
    </a>
  );
}

function AskChip({ t, pressed, ask, actions }: { readonly t: AskJob; readonly pressed: boolean; readonly ask: AskStore; readonly actions: MeetingsActions }) {
  return (
    <button className={`chip ask${t.status === 'error' ? ' bad' : ''}`} aria-pressed={String(pressed) as 'true' | 'false'} title={t.q} onClick={() => actions.setFilter(`ask:${t.id}`)}>
      {t.status === 'running' ? <span className="spin" /> : <Icon id={t.status === 'error' ? 'i-alert' : t.status === 'stopped' ? 'i-x' : 'i-search'} />}
      {askLabel(t)}
      {t.status === 'running' ? <LiveSecs t={t} className="num" /> : t.status === 'done' ? <Num>{t.results.length}</Num> : t.status === 'stopped' ? <span className="num">멈춤</span> : null}
      <span className="x" role="button" aria-label="탭 닫기" onClick={(e) => {
        e.stopPropagation();
        void ask.remove(t);
      }}><Icon id="i-x" /></span>
    </button>
  );
}

function EmptyBox({ icon, title, text, children }: { readonly icon: string; readonly title: string; readonly text: string; readonly children?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-mark"><Icon id={icon} /></span>
      <b>{title}</b>
      {text ? <p>{text}</p> : null}
      {children ? <div className="empty-acts">{children}</div> : null}
    </div>
  );
}

function Empty({ all, input, q, filter, actions }: { readonly all: readonly MeetingItem[]; readonly input: MeetingsInput; readonly q: string; readonly filter: Filter; readonly actions: MeetingsActions }) {
  if (!all.length && input.folder) return <FolderEmpty issue={input.folder} />;
  if (!all.length) {
    return (
      <EmptyBox icon="i-people" title="아직 회의 녹음이 없습니다" text="회의를 시작할 때 위쪽 회의 녹음을 누르세요. 끝나면 녹취와 회의록이 여기에 쌓입니다. 다른 앱에서 녹음한 파일은 가져오거나 이 화면에 끌어다 놓으세요.">
        <button className="btn rec" onClick={actions.openMeetingStart}><Icon id="i-rec" />회의 녹음 시작</button>
        <button className="btn" onClick={() => actions.importMeeting()}><Icon id="i-folder" />파일 가져오기</button>
      </EmptyBox>
    );
  }
  const back = <button className="btn" onClick={() => actions.setFilter('all')}>전체 보기</button>;
  if (q) return <EmptyBox icon="i-search" title={`"${q}"가 들어간 회의가 없습니다`} text="제목과 요약에서 찾습니다. 다른 말로 찾아 보세요." />;
  if (filter === 'hand') return <EmptyBox icon="i-check" title="확인할 회의가 없습니다" text="모든 회의록을 확정했습니다. 새 회의가 끝나면 확인할 부분이 여기에 모입니다.">{back}</EmptyBox>;
  if (filter === 'final') return <EmptyBox icon="i-check" title="아직 확정한 회의가 없습니다" text="회의록의 확인 필요를 모두 처리하고 확인을 마치면 여기에 모입니다.">{back}</EmptyBox>;
  return <EmptyBox icon="i-check" title="회의록이 없는 녹음이 없습니다" text="">{back}</EmptyBox>;
}

/** 목록 + 오른쪽 바로가기. 그린 뒤 스크롤 감시를 붙이고, 다시 그리면 다시 붙인다 (옛 화면도 그릴 때마다 새로 붙였다) */
function MeetingList({ items, filter, q, actions }: { readonly items: readonly MeetingItem[]; readonly filter: Filter; readonly q: string; readonly actions: MeetingsActions }) {
  const body = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => scrollSpy(body.current!, nav.current!));
  let sections: ReactNode;
  let navItems: ReactNode;
  if (filter !== 'all' || q) {
    const years = monthGroups(items);
    sections = <MonthSections years={years} actions={actions} />;
    navItems = <YearNav years={years} />;
  } else {
    const m = mixed(items);
    const olderYears = m.older.length ? monthGroups(m.older) : [];
    sections = (
      <>
        {m.hand.length ? (
          <section className="mix-sec" id="sec-hand" data-spy="">
            <div className="sec-h"><h2>확인할 회의</h2><span>{m.kinds}</span></div>
            <div className="hgrid">{m.hand.slice(0, HAND_MAX).map((r) => <HandCard key={r.id} r={r} actions={actions} />)}</div>
            {m.hand.length > HAND_MAX ? <button className="btn small more-btn" onClick={() => actions.setFilter('hand')}>{`${m.hand.length - HAND_MAX}건 더 보기`}<Icon id="i-right" /></button> : null}
          </section>
        ) : (
          // 확인할 회의가 없을 때: 칸을 없애지 않고 다 끝났다는 한 줄
          <section className="mix-sec" id="sec-hand">
            <div className="sec-h"><h2>확인할 회의</h2></div>
            <div className="all-clear">
              <span className="ok-mark"><Icon id="i-check" /></span>
              <span>
                <b>확인할 회의가 없습니다</b>
                <span>{m.lastDone ? ` · 모든 회의록을 확정했습니다. 마지막 확정은 ${dayLabel(m.lastDone.startedAt)} ${TIME.format(new Date(m.lastDone.startedAt))} 회의` : ' · 모든 회의록을 확정했습니다'}</span>
              </span>
            </div>
          </section>
        )}
        <section className="mix-sec" id="sec-recent" data-spy="">
          <div className="sec-h recent-h"><h2>최근 회의</h2><span>{`${m.recent.length}건`}</span></div>
          <div className="ledger-month"><LedgerRows list={m.recent} recent actions={actions} /></div>
        </section>
        {m.older.length ? (
          <div className="mix-sec">
            <div className="archive-h"><h2>이전 회의</h2><span>{`${m.older.length}건`}</span></div>
            <MonthSections years={olderYears} actions={actions} />
          </div>
        ) : null}
      </>
    );
    navItems = (
      <>
        {m.hand.length ? <button className="hot" data-target="sec-hand">확인할 회의<Num>{m.hand.length}</Num></button> : null}
        <button data-target="sec-recent">최근 회의<Num>{m.recent.length}</Num></button>
        {m.older.length ? <div className="sep" /> : null}
        <YearNav years={olderYears} />
      </>
    );
  }
  return (
    <div className="mlist">
      <div ref={body}>{sections}</div>
      <nav ref={nav} className="index" aria-label="바로 가기">
        <span className="pill" aria-hidden="true" />
        <h3>바로 가기</h3>
        {navItems}
      </nav>
    </div>
  );
}

export function MeetingsPage({ source, ask, actions }: { readonly source: Source<MeetingsInput>; readonly ask: AskStore; readonly actions: MeetingsActions }) {
  const input = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const [q, setQ] = useState('');
  const [drop, setDrop] = useState(false);
  const all = input.meetings;
  const asking = input.filter.startsWith('ask:') ? input.asks.find((t) => `ask:${t.id}` === input.filter) ?? null : null;
  const filter = (asking ? 'all' : input.filter.startsWith('ask:') ? 'all' : input.filter) as Filter;
  const items = asking ? [] : pick(all, filter, q);

  const files = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  return (
    <div
      className={`page wide${drop ? ' drop' : ''}`}
      // 녹음 파일을 끌어다 놓으면 가져온다 (여러 개면 이름 순서대로 이어 붙임)
      onDragOver={(e) => {
        if (!files(e)) return;
        e.preventDefault();
        setDrop(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const paths = [...e.dataTransfer.files].map((f) => actions.filePath(f)).filter((p): p is string => Boolean(p));
        if (paths.length) actions.importMeeting(paths);
      }}
    >
      <div className="page-head">
        <h1>회의<Num>{all.length || ''}</Num></h1>
        <button className="btn" title="다른 앱에서 녹음한 파일로 회의록을 만듭니다. 여기로 끌어다 놓아도 됩니다" onClick={() => actions.importMeeting()}><Icon id="i-folder" />파일 가져오기</button>
        {/* 질문 탭은 질문이 거른 결과 (제목 검색과 섞지 않는다) */}
        <SearchBox placeholder="제목, 요약 검색" hidden={!all.length || Boolean(asking)} onInput={(v) => setQ(v.trim().toLowerCase())} />
      </div>
      <div className="chips">
        {all.length ? [
          ...chips(all, filter).map((c) => (
            <button key={c.id} className="chip" aria-pressed={String(!asking && filter === c.id) as 'true' | 'false'} onClick={() => actions.setFilter(c.id)}>{c.label}<Num>{c.n}</Num></button>
          )),
          ...input.asks.map((t) => <AskChip key={`ask:${t.id}`} t={t} pressed={input.filter === `ask:${t.id}`} ask={ask} actions={actions} />),
        ] : null}
      </div>
      <div className="bulk-row">
        {!asking && filter === 'rest' && items.length > 1 ? (
          <>
            <span>{`회의록이 없는 녹음 ${items.length}개`}</span>
            <button className="btn small" onClick={() => actions.trash(items)}><Icon id="i-trash" />모두 휴지통으로</button>
          </>
        ) : null}
      </div>
      <div>{!asking && (filter === 'all' || filter === 'rest') && input.strays.length ? <StrayBox strays={input.strays} actions={actions} /> : null}</div>
      {asking ? (
        <div key="ask"><AskTab t={asking} all={all} store={ask} actions={actions} /></div>
      ) : (
        <div key="list">{items.length ? <MeetingList items={items} filter={filter} q={q} actions={actions} /> : <Empty all={all} input={input} q={q} filter={filter} actions={actions} />}</div>
      )}
    </div>
  );
}
