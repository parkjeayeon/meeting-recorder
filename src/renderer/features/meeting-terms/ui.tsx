// 회의 페이지의 용어: 회의록 아래 '용어' 칸, 밑줄 친 말을 누르면 뜨는 설명 카드, 본문에서 드래그하면 뜨는 '설명 추가'.
// 뿌리 요소(section.glossary · div.term-card · div.term-add)는 옛 회의 페이지가 만들고 여기는 그 안을 그린다 (createIslands).
// 파일을 바꾸는 일(설명 고치기·지우기·확인, 만들기)은 주인(옛 회의 페이지)이 준 명령으로.
import { useLayoutEffect, useRef, useState } from 'react';
import { parseStamp } from '../../../core/script.mts';
import type { Term } from '../../entities/minutes/index.ts';
import { Icon, Num } from '../../shared/ui/index.tsx';

const BASIS_LABEL: Readonly<Record<string, string>> = { general: '일반 용어', meeting: '회의 내용에서', unknown: '회의에서 설명 없음' };
const isGuess = (t: Term) => t.status !== 'confirmed';

/** 바꾸기 (patch: { status } · { note } · { remove }, done: 끝나면 보일 알림). termId '*'는 확인 전 모두 */
export type ChangeTerm = (termId: string, patch: Record<string, unknown>, done?: string) => void;

/** 시각: 녹음이 있으면 눌러서 그 자리부터 듣기 */
function Stamp({ at, seek }: { readonly at: string; readonly seek: ((sec: number) => void) | null }) {
  return seek ? <button className="seek" title="여기부터 듣기" onClick={() => seek(parseStamp(at))}>{at}</button> : <span className="num">{at}</span>;
}

export interface GlossaryProps {
  readonly terms: readonly Term[];
  /** glossary.json이 있나 (있으면 '추정 설명 다시 찾기') */
  readonly exists: boolean;
  readonly openCard: (anchor: HTMLElement, t: Term) => void;
  readonly change: ChangeTerm;
  /** 용어 설명 만들기 (끝나면 주인이 다시 그린다) */
  readonly make: () => Promise<void>;
}

/** 회의록 아래 '용어' 칸: 설명을 스티커처럼 모아 보여 주고, 확인 전인 것은 한 번에 확인 (section.glossary 안) */
export function GlossaryBody({ terms, exists, openCard, change, make }: GlossaryProps) {
  const [making, setMaking] = useState(false);
  const guesses = terms.filter(isGuess);
  return (
    <>
      <div className="glossary-head">
        <h3>용어{terms.length > 0 ? <Num>{terms.length}</Num> : null}</h3>
        <span style={{ flex: 1 }} />
        {guesses.length > 1 ? <button className="btn small" onClick={() => change('*', { status: 'confirmed' }, `${guesses.length}개를 확인했습니다`)}><Icon id="i-check" />{`확인 전 ${guesses.length}개 모두 확인`}</button> : null}
        <button className={making ? 'btn small busy' : 'btn small'} aria-busy={making ? 'true' : undefined} onClick={() => {
          setMaking(true);
          void make();
        }}>{making ? '용어 찾는 중… (10초 안팎)' : exists ? '추정 설명 다시 찾기' : '용어 설명 만들기'}</button>
      </div>
      <p className="hint">{terms.length
        ? '밑줄 친 말을 누르면 설명을 볼 수 있습니다. 점선은 LLM이 회의 내용으로 추정한 설명입니다. 본문에서 단어를 드래그하면 설명을 더할 수 있습니다.'
        : '회의록에 나온 사내 용어·약어·기술 용어에 한 줄 설명을 붙입니다. 본문에서 단어를 드래그해 하나씩 더할 수도 있습니다.'}</p>
      {terms.length > 0 ? (
        <div className="gl-grid">
          {terms.map((t) => (
            <button key={t.id} className={`gl-item${isGuess(t) ? ' guess' : ''}`} onClick={(e) => openCard(e.currentTarget, t)}>
              <b>{t.term}</b><span>{t.note}</span>{isGuess(t) ? <i className="gl-badge">추정</i> : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

export interface TermCardProps {
  readonly t: Term;
  /** 카드 뿌리 (div.term-card, 옛 페이지가 body에 붙임) — 용어 아래(넘치면 위)에 놓는다 */
  readonly host: HTMLElement;
  readonly anchor: Element;
  readonly seek: ((sec: number) => void) | null;
  readonly change: ChangeTerm;
  /** 고치는 중 (설명 입력칸과 저장·취소) */
  readonly editing: boolean;
  /** 고치기·취소: 주인이 카드를 새로 연다 (옛 화면처럼 — 새 카드를 재서 놓아야 자리가 같다) */
  readonly reopen: (editing: boolean) => void;
}

/** 용어 설명 카드 (div.term-card 안): 맞아요·고치기·지우기, 고치는 중이면 설명 입력칸과 저장·취소 */
export function TermCardBody({ t, host, anchor, seek, change, editing, reopen }: TermCardProps) {
  const note = useRef<HTMLTextAreaElement>(null);
  const guess = isGuess(t);
  // 용어 아래에, 화면 밖으로 나가면 위로 (카드는 열 때마다 새로 만들어 한 번만 잰다)
  useLayoutEffect(() => {
    if (editing && note.current) note.current.value = t.note ?? '';
    const a = anchor.getBoundingClientRect();
    const c = host.getBoundingClientRect();
    const top = a.bottom + 6 + c.height > innerHeight - 8 ? Math.max(8, a.top - 6 - c.height) : a.bottom + 6;
    host.style.top = `${top}px`;
    host.style.left = `${Math.min(Math.max(8, a.left), innerWidth - c.width - 8)}px`;
    if (editing) note.current?.focus();
  }, [editing, anchor, host, t.note]);
  return (
    <>
      <div className="tc-head">
        <b>{t.term}</b>
        <span className={`tc-badge${guess ? ' guess' : ''}`}>{guess ? 'LLM 추정 · 확인 전' : t.edited ? '직접 고침' : BASIS_LABEL[t.basis ?? ''] ?? ''}</span>
      </div>
      {editing ? <textarea ref={note} className="tc-edit" rows={3} maxLength={200} aria-label="설명" /> : <p className="tc-note">{t.note}</p>}
      {!editing && t.at?.length ? (
        <div className="tc-at"><span>회의에서 나온 곳</span>{t.at.map((s, i) => <Stamp key={i} at={s} seek={seek} />)}</div>
      ) : null}
      <div className="tc-acts">
        {editing ? (
          <>
            <button className="btn small primary" onClick={() => {
              const v = note.current!.value;
              if (v.trim()) change(t.id, { note: v }, '설명을 고쳤습니다');
            }}>저장</button>
            <button className="btn small" onClick={() => reopen(false)}>취소</button>
          </>
        ) : (
          <>
            {guess ? <button className="btn small primary" onClick={() => change(t.id, { status: 'confirmed' })}><Icon id="i-check" />맞아요</button> : null}
            <button className="btn small" onClick={() => reopen(true)}><Icon id="i-pencil" />고치기</button>
            <button className="btn small ghost" onClick={() => change(t.id, { remove: true }, `'${t.term}' 설명을 지웠습니다`)}>지우기</button>
          </>
        )}
      </div>
    </>
  );
}

export interface ExplainAddProps {
  /** 고른 말 (공백 하나로) */
  readonly text: string;
  /** 설명 찾아 더하기 (끝나면 주인이 버튼을 치우고 다시 그린다) */
  readonly explain: () => Promise<void>;
  /** 잘못 들린 말이면 확인 필요로 (회의록·녹취가 있을 때만) */
  readonly toReview: (() => void) | null;
}

/** 본문·스크립트에서 단어를 드래그하면 뜨는 버튼들 (div.term-add 안). 누를 때 고른 글이 풀리지 않게 mousedown을 막는다 */
export function ExplainAddBody({ text, explain, toReview }: ExplainAddProps) {
  const [busy, setBusy] = useState(false);
  const short = text.length > 12 ? `${text.slice(0, 12)}…` : text;
  return (
    <>
      <button className={busy ? 'btn small busy' : 'btn small'} aria-busy={busy ? 'true' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => {
        setBusy(true);
        void explain();
      }}><Icon id="i-plus" /><span>{busy ? '설명 찾는 중…' : `'${short}' 설명 추가`}</span></button>
      {toReview ? <button className="btn small" onMouseDown={(e) => e.preventDefault()} onClick={toReview}><Icon id="i-flag" /><span>확인 필요에 추가</span></button> : null}
    </>
  );
}
