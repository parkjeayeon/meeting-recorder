// 회의 페이지의 '확인 필요' 탭 (div.review 안): 항목마다 추정 적용 · 직접 고치기 · 채팅 · 그대로 두기, 여러 개 골라 한 번에,
// 직접 추가, 확인 마치기, 처리한 항목 고치기·되돌리기·다시 열기, 구간 다시 받아쓰기(구간을 모르면 직접 고르기).
// 고른 항목·고쳐 쓴 말·갈래 같은 상태와 파일을 바꾸는 명령은 주인(옛 회의 페이지)의 것 — 여기는 받은 대로 그린다.
import { useLayoutEffect, useRef, useState } from 'react';
import { noteVariants } from '../../../core/review.mts';
import { clock, parseStamp } from '../../../core/script.mts';
import { itemRange, REVIEW_KIND } from '../../entities/review/index.ts';
import type { Jobs } from '../../shared/lib/index.ts';
import { Field, Icon, JobButton, Num, useNativeEvent } from '../../shared/ui/index.tsx';
import { needsRewrite, type Fix, type Review, type ReviewItem } from './model.ts';

export interface ReviewProps {
  /** review.json — 없으면 null (회의록에 '확인 필요' 섹션이 있으면 '정리하기', 없으면 빈 목록으로) */
  readonly review: Review | null;
  readonly minutes: string;
  readonly transcript: string;
  readonly filter: 'open' | 'done';
  readonly selected: ReadonlySet<string>;
  /** 항목별로 고쳐 쓴 '고칠 말' (다시 그려도 남게) */
  readonly guessDraft: ReadonlyMap<string, string>;
  /** 구간을 몰라 직접 고르는 중인 항목 */
  readonly redoPick: ReadonlySet<string>;
  readonly addDraft: string;
  /** 녹음이 있으면 시각을 눌러 그 자리부터, 재생 중인 위치 */
  readonly seek: ((sec: number) => void) | null;
  readonly now: () => number;
  readonly jobs: Jobs;
  readonly addKey: string;
  readonly actions: ReviewActions;
}
export interface ReviewActions {
  readonly setFilter: (f: 'open' | 'done') => void;
  readonly select: (id: string, on: boolean) => void;
  readonly selectAll: (on: boolean) => void;
  readonly setGuess: (id: string, value: string) => void;
  readonly apply: (fixes: readonly Fix[]) => void;
  readonly keep: (ids: readonly string[]) => void;
  readonly openChat: (ids: readonly string[]) => void;
  /** 구간 다시 받아쓰기 (채팅을 열고) */
  readonly redo: (id: string, range: { start: number; end: number }) => void;
  readonly toggleRedoPick: (id: string) => void;
  readonly reopen: (id: string) => void;
  readonly revert: (it: ReviewItem) => void;
  /** 고친 말을 다른 말로 (되돌린 뒤 다시 적용) */
  readonly reapply: (it: ReviewItem, guess: string) => Promise<void>;
  /** 고치기를 그만둠 (다시 그린다) */
  readonly cancelEdit: () => void;
  readonly makeReview: () => Promise<boolean>;
  readonly setAddDraft: (text: string) => void;
  readonly add: (text: string) => void;
  readonly finalize: () => Promise<boolean>;
  /** 알림 (구간 고르기의 잘못된 값) */
  readonly warn: (title: string) => void;
}

const Stamp = ({ at, seek }: { readonly at: string; readonly seek: ((sec: number) => void) | null }) =>
  seek ? <button className="seek" title="여기부터 듣기" onClick={() => seek(parseStamp(at))}>{at}</button> : null;

/** 속성으로만 체크하는 체크 상자 (옛 화면처럼 HTML 속성을 남기지 않게), 바뀌면 직접 단 처리기로 */
function Check({ checked, indeterminate = false, label, onChange }: { readonly checked: boolean; readonly indeterminate?: boolean; readonly label: string; readonly onChange: (on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current!.checked = checked;
    ref.current!.indeterminate = indeterminate;
  });
  useNativeEvent(ref, 'change', (el) => onChange(el.checked));
  return <input ref={ref} type="checkbox" aria-label={label} />;
}

/** 확인 필요 섹션이 있는데 아직 항목으로 나누지 않은 회의록 */
function MakeReview({ make }: { readonly make: () => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="state">
      <b>확인 필요 항목을 하나씩 처리할 수 있게 정리합니다</b>
      <p>회의록의 "확인 필요"를 항목별로 나누고, 고칠 말 추정이 있으면 채워 둡니다.</p>
      <div className="row">
        <button className={busy ? 'btn primary busy' : 'btn primary'} onClick={async () => {
          setBusy(true); // 흐리게 하지 않고 진행 중 표시
          if (!(await make())) setBusy(false);
        }}>{busy ? '정리하는 중…' : '정리하기'}</button>
      </div>
    </div>
  );
}

// 확인 필요 › 직접 추가: 목록이 놓친 것을 말로 짚으면 녹취에서 찾아 항목으로 만든다 (그 뒤는 다른 항목과 같이 적용·채팅·되돌리기)
function ReviewAdd({ draft, jobs, jobKey, setDraft, add }: { readonly draft: string; readonly jobs: Jobs; readonly jobKey: string; readonly setDraft: (t: string) => void; readonly add: (t: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };
  useLayoutEffect(() => {
    input.current!.value = draft;
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 그릴 때 한 번 (옛 페이지가 바뀔 때마다 새로 그린다)
  useNativeEvent(input, 'input', (el) => {
    setDraft(el.value);
    fit();
  });
  const send = () => {
    const text = input.current!.value.trim();
    if (text && !jobs.has(jobKey)) add(text);
  };
  useNativeEvent(input, 'keydown', (_el, e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing) {
      k.preventDefault();
      send();
    }
  });
  return (
    <div className="review-add">
      <textarea ref={input} rows={1} placeholder={'놓친 게 있나요? 예: "통신 한정성"은 "안정성"이야 · 12분쯤 나온 회사 이름이 이상해'} disabled={jobs.has(jobKey) || undefined} />
      <JobButton jobs={jobs} jobKey={jobKey} className="btn small" icon="i-plus" label="확인 필요에 추가" onClick={send} />
    </div>
  );
}

// 확인 마치기: 남은 항목은 그대로 둔 것으로 하고, 채팅·이름 등 문장에 영향이 있는 결과만 회의록에 반영한다
function Finalize({ review, openCount, finalize }: { readonly review: Review; readonly openCount: number; readonly finalize: () => Promise<boolean> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  if (review.finalizedAt) {
    const f = review.finalize ?? {};
    return (
      <div className="finalize done">
        <Icon id="i-check" />
        <div className="finalize-text">
          <b>확인을 마쳤습니다</b>
          <span>{`고침 ${f.applied ?? 0} · 그대로 둠 ${f.kept ?? 0}${f.rewritten ? ' · 회의록의 해당 부분을 고쳐 썼습니다 (이전 회의록은 minutes.before-finalize.md로 보관)' : ' · 회의록 문장은 그대로입니다'}`}</span>
        </div>
      </div>
    );
  }
  const rewrite = needsRewrite(review.items);
  const label = state === 'busy' ? (rewrite ? '회의록에 반영하는 중…' : '마치는 중…') : state === 'failed' ? '다시 시도' : openCount ? `남은 ${openCount}개는 그대로 두고 확인 마치기` : '확인 마치기';
  return (
    <div className="finalize">
      <div className="finalize-text">
        <b>{openCount ? `확인 필요 ${openCount}개 남음` : '모두 처리했습니다'}</b>
        <span>{rewrite ? '채팅으로 밝혀진 내용이나 고친 이름은 회의록의 해당 문장에 반영합니다. 나머지 문장은 그대로 둡니다.' : '고친 단어는 이미 녹취·정리본·회의록에 반영되어 있습니다. 마치면 회의록이 확정됩니다.'}</span>
      </div>
      <button className={state === 'busy' ? 'btn primary busy' : 'btn primary'} onClick={async () => {
        setState('busy'); // 흐리게 하지 않고 진행 중 표시
        if (!(await finalize())) setState('failed');
      }}><Icon id="i-check" />{label}</button>
    </div>
  );
}

// 구간 직접 고르기: 시작·끝(mm:ss)을 넣거나 '지금 재생 위치'로. 끝을 비우면 시작부터 1분, 최대 10분
function RedoPicker({ it, now, redo, warn }: { readonly it: ReviewItem; readonly now: () => number; readonly redo: ReviewActions['redo']; readonly warn: (t: string) => void }) {
  const start = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const t = setTimeout(() => start.current?.focus());
    return () => clearTimeout(t);
  }, []);
  const ok = (v: string) => /^\d{1,2}(:\d{2}){1,2}$/.test(v.trim());
  const go = () => {
    const s = start.current!;
    const e = end.current!;
    if (!ok(s.value)) return s.focus();
    if (e.value.trim() && !ok(e.value)) return e.focus();
    const a = parseStamp(s.value.trim());
    const b = e.value.trim() ? parseStamp(e.value.trim()) : a + 60;
    if (b <= a) return warn('끝이 시작보다 뒤여야 합니다');
    if (b - a > 600) return warn('한 번에 10분까지 다시 받아쓸 수 있습니다');
    redo(it.id, { start: a, end: b });
  };
  const here = (input: { current: HTMLInputElement | null }) => (
    <button className="btn small ghost" title="재생 중인 위치를 넣습니다" onClick={() => {
      input.current!.value = clock(Math.floor(now() || 0));
    }}>지금 재생 위치</button>
  );
  return (
    <div className="redo-pick">
      <span className="hint" style={{ margin: 0 }}>메모에 시각이 없어 구간을 모릅니다. 녹음을 들어 보고 그 구간을 넣어 주세요.</span>
      <div className="redo-pick-row">
        <Field inputRef={start} inputMode="numeric" placeholder="시작 12:30" aria-label="시작 시각" onEnter={go} />
        {here(start)}
        <span className="hint" style={{ margin: 0 }}>~</span>
        <Field inputRef={end} inputMode="numeric" placeholder="끝 (비우면 1분)" aria-label="끝 시각" onEnter={go} />
        {here(end)}
        <button className="btn small primary" onClick={go}>다시 받아쓰기</button>
      </div>
    </div>
  );
}

/** 남은 항목 하나 */
function OpenItem({ it, p }: { readonly it: ReviewItem; readonly p: ReviewProps }) {
  const { actions, seek } = p;
  const guess = p.guessDraft.has(it.id) ? p.guessDraft.get(it.id)! : it.guess ?? '';
  const guessRef = useRef<HTMLInputElement>(null);
  const what = useRef<HTMLInputElement>(null);
  const from = useRef<HTMLInputElement>(null);
  const to = useRef<HTMLInputElement>(null);
  const range = itemRange(it);
  let fix = null;
  if (it.kind === 'lost') {
    // 유실 구간은 고칠 글자가 아니라 반복된 문장이다. 들어 보고 채팅하거나 그대로 둔다
    if (it.heardNote) fix = <div className="ritem-fix muted"><span className="hint" style={{ margin: 0 }}>반복된 문장</span><span className="quote">{it.heardNote}</span></div>;
  } else if (it.heard) {
    const applyGuess = () => {
      const v = guessRef.current!.value;
      if (v.trim()) actions.apply([{ id: it.id, guess: v }]);
    };
    // 이름이 두 가지로 섞인 항목: 어느 쪽으로 통일할지 바로 고른다 (다른 쪽을 고른 쪽으로 모두 바꾼다)
    const variants = noteVariants(it.note, p.transcript).slice(0, 2);
    fix = (
      <>
        <div className="ritem-fix">
          <span className="heard">{it.heard}</span>
          <Icon id="i-right" />
          <Field inputRef={guessRef} initial={guess} placeholder="고칠 말 (기억나는 대로)" onInput={(v) => actions.setGuess(it.id, v)} onEnter={applyGuess} />
          <button className="btn small primary" onClick={applyGuess}>적용</button>
        </div>
        {variants.length === 2 ? (
          <div className="ritem-unify">
            <span className="hint" style={{ margin: 0 }}>한 가지로 통일</span>
            {variants.map((v, k) => <button key={v} className="btn small" onClick={() => actions.apply([{ id: it.id, heard: variants[1 - k]!, guess: v }])}>{`모두 '${v}'(으)로`}</button>)}
          </div>
        ) : null}
      </>
    );
  } else {
    // 녹취에 같은 글자가 없는 항목(이름·뜻 확인 등): LLM을 거치지 않고 바로 처리할 수 있게
    // ① 확인한 내용을 적고 '확인됨' (녹취는 그대로, 확인을 마칠 때 회의록 문장에 반영)
    // ② 녹취에 적힌 글자와 고칠 말을 넣어 '적용' (녹취에 그 글자가 없으면 이유를 알린다)
    const resolve = () => actions.apply([{ id: it.id, resolve: what.current!.value.trim() || '확인함' }]);
    const pair = () => {
      const a = from.current!.value.trim();
      const b = to.current!.value.trim();
      if (a && b) actions.apply([{ id: it.id, heard: a, guess: b }]);
      else (a ? to : from).current!.focus();
    };
    fix = (
      <>
        {it.heardNote ? <div className="ritem-fix muted"><span className="heard">{it.heardNote}</span><span className="hint" style={{ margin: 0 }}>녹취에 이 글자 그대로는 없습니다</span></div> : null}
        <div className="ritem-fix">
          <Field inputRef={what} placeholder="확인한 내용 (예: 외부 개발자, 이름은 그대로)" aria-label="확인한 내용" onEnter={resolve} />
          <button className="btn small primary" onClick={resolve}><Icon id="i-check" />확인됨</button>
        </div>
        <div className="ritem-fix ritem-pair">
          <Field inputRef={from} placeholder="녹취에 적힌 글자" aria-label="녹취에 적힌 글자" />
          <Icon id="i-right" />
          <Field inputRef={to} placeholder="고칠 말" aria-label="고칠 말" onEnter={pair} />
          <button className="btn small" onClick={pair}>적용</button>
        </div>
      </>
    );
  }
  return (
    <>
      {fix}
      <div className="ritem-acts">
        <button className="btn small ghost" onClick={() => actions.openChat([it.id])}><Icon id="i-chat" />채팅</button>
        {/* 구간을 알면 바로, 모르면(메모에 시각도 단서도 없음) 구간을 직접 고르는 줄을 연다 */}
        {(it.kind === 'lost' || it.kind === 'meaning') && seek ? (
          <button className="btn small ghost" title={range ? '이 구간만 녹음에서 다시 받아씁니다' : '구간을 몰라 직접 고릅니다'} aria-expanded={range ? undefined : p.redoPick.has(it.id)} onClick={() => (range ? actions.redo(it.id, range) : actions.toggleRedoPick(it.id))}>
            <Icon id="i-redo" />구간 다시 받아쓰기
          </button>
        ) : null}
        <button className="btn small ghost" onClick={() => actions.keep([it.id])}>{it.kind === 'lost' ? '유실 그대로 두기' : '그대로 두기'}</button>
      </div>
      {p.redoPick.has(it.id) && !range ? <RedoPicker it={it} now={p.now} redo={actions.redo} warn={actions.warn} /> : null}
    </>
  );
}

/** 처리한 항목 하나: 확인 마치기 전까지는 다시 손볼 수 있다 (고친 말 바꾸기·되돌리기, 그대로 둔 것 다시 열기) */
function DoneItem({ it, locked, actions }: { readonly it: ReviewItem; readonly locked: boolean; readonly actions: ReviewActions }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!editing) return;
    input.current!.focus();
    input.current!.select();
  }, [editing]);
  const isRedo = Boolean(it.redo?.appliedAt);
  // 되돌리기 기능 전에 다시 받아쓴 구간은 원래 줄·녹취 구간 기록이 없어 되돌릴 수 없다 → 버튼 대신 안내
  // (단어 항목은 기록이 없어도 고치기 전 보관본에서 바꾼 줄을 다시 찾는다)
  const noUndo = it.status === 'applied' && isRedo && !it.redo!.replaced;
  if (editing) {
    // 고친 말을 다른 말로: 되돌린 뒤 새 말로 다시 적용
    const save = () => {
      const g = input.current!.value.trim();
      if (!g || g === it.applied) return actions.cancelEdit();
      setSaving(true);
      void actions.reapply(it, g);
    };
    return (
      <div className="ritem-done ritem-fix">
        <span className="heard">{it.heard}</span>
        <Icon id="i-right" />
        <Field inputRef={input} initial={it.applied} aria-label="고칠 말" onEnter={save} />
        <button className={saving ? 'btn small primary busy' : 'btn small primary'} onClick={save}>적용</button>
        <button className="btn small ghost" onClick={actions.cancelEdit}>취소</button>
      </div>
    );
  }
  return (
    <div className="ritem-done">
      {it.status === 'resolved' ? <><span className="proposal-state ok" style={{ margin: 0 }}><Icon id="i-check" />확인됨</span><span>{it.resolution ?? ''}</span></>
        : it.status === 'applied' ? (
          <>
            {isRedo ? <span className="num">{`${clock(it.redo!.start)}~${clock(it.redo!.end)} 구간`}</span> : <span className="heard">{it.heard ?? it.heardNote ?? ''}</span>}
            <Icon id="i-right" />
            <b>{it.applied}</b>
            <span className="hint" style={{ margin: 0 }}>{isRedo ? `${it.count ?? 0}줄` : `${it.count ?? 0}곳 고침`}</span>
          </>
        ) : <span>그대로 둠</span>}
      {!locked && (it.status === 'kept' || it.status === 'resolved') ? <button className="btn small ghost" onClick={() => actions.reopen(it.id)}>다시 열기</button> : null}
      {!locked && it.status === 'applied' && !noUndo && !isRedo && it.heard ? <button className="btn small ghost" onClick={() => setEditing(true)}><Icon id="i-pencil" />고치기</button> : null}
      {!locked && it.status === 'applied' && !noUndo ? <button className="btn small ghost" onClick={() => actions.revert(it)}>되돌리기</button> : null}
      {!locked && noUndo ? <span className="hint" style={{ margin: 0 }}>되돌리기 기능 전에 반영한 구간이라 되돌릴 수 없습니다</span> : null}
    </div>
  );
}

export function ReviewBody(p: ReviewProps) {
  const { actions } = p;
  // 확인 필요 섹션이 없는 회의록: 정리할 것은 없고 직접 추가만 한다
  const review = p.review ?? (/^## 확인 필요/m.test(p.minutes) ? null : { items: [] });
  if (!review) return <MakeReview make={actions.makeReview} />;
  const items = review.items;
  const open = items.filter((it) => it.status === 'open');
  const done = items.filter((it) => it.status !== 'open');
  const shown = p.filter === 'open' ? open : done;
  const guessOf = (it: ReviewItem) => (p.guessDraft.has(it.id) ? p.guessDraft.get(it.id)! : it.guess ?? '');
  const sel = open.filter((it) => p.selected.has(it.id));
  const applicable = sel.filter((it) => it.heard && guessOf(it).trim());
  const locked = Boolean(review.finalizedAt);
  return (
    <>
      <div className="tab-bar"><span>들린 말을 고칠 말로 바꾸면 녹취·정리본·회의록에 모두 반영됩니다. 처음 고칠 때 원본을 따로 보관합니다.</span></div>
      <div className="review-bar">
        {p.filter === 'open' && open.length > 0 ? (
          <label className="review-all">
            <Check checked={open.length > 0 && sel.length === open.length} indeterminate={sel.length > 0 && sel.length < open.length} label="모두 고르기" onChange={actions.selectAll} />
            {sel.length ? `${sel.length}개 선택` : '모두 고르기'}
          </label>
        ) : null}
        {p.filter === 'open' && sel.length > 0 ? (
          <>
            <button className="btn small primary" disabled={!applicable.length || undefined} title="고칠 말이 있는 항목만 적용됩니다" onClick={() => actions.apply(applicable.map((it) => ({ id: it.id, guess: guessOf(it) })))}>
              <Icon id="i-check" />{`추정대로 적용${applicable.length ? ` ${applicable.length}` : ''}`}
            </button>
            <button className="btn small" onClick={() => actions.openChat(sel.map((it) => it.id))}><Icon id="i-chat" />채팅으로 확인</button>
            <button className="btn small" onClick={() => actions.keep(sel.map((it) => it.id))}>그대로 두기</button>
          </>
        ) : null}
        <span style={{ flex: 1 }} />
        <div className="chips" style={{ margin: 0 }}>
          <button className="chip" aria-pressed={p.filter === 'open'} onClick={() => actions.setFilter('open')}>남은 것<Num>{open.length}</Num></button>
          <button className="chip" aria-pressed={p.filter === 'done'} onClick={() => actions.setFilter('done')}>처리함<Num>{done.length}</Num></button>
        </div>
      </div>
      <ReviewAdd draft={p.addDraft} jobs={p.jobs} jobKey={p.addKey} setDraft={actions.setAddDraft} add={actions.add} />
      {items.length ? <Finalize review={review} openCount={open.length} finalize={actions.finalize} /> : null}
      {!shown.length ? (
        <div className="empty"><b>{p.filter === 'open' ? '확인할 항목이 없습니다' : '아직 처리한 항목이 없습니다'}</b>{p.filter === 'open' && items.length ? '모두 처리했습니다.' : ''}</div>
      ) : shown.map((it) => (
        <div key={it.id} className={`ritem${p.selected.has(it.id) ? ' on' : ''} ${it.status}`}>
          <div className="ritem-head">
            {it.status === 'open' ? <Check checked={p.selected.has(it.id)} label="고르기" onChange={(on) => actions.select(it.id, on)} /> : null}
            {/* 형식 검사가 올린 항목은 '근거 확인' (core/check.mts) */}
            <span className={`tag kind-${it.kind}`}>{it.source === 'check' ? '근거 확인' : REVIEW_KIND[it.kind] ?? '확인'}</span>
            {it.at ? <Stamp at={it.at} seek={p.seek} /> : null}
            <span className="ritem-note">{it.note}</span>
          </div>
          {it.status === 'open' ? <OpenItem it={it} p={p} /> : <DoneItem it={it} locked={locked} actions={actions} />}
        </div>
      ))}
    </>
  );
}
