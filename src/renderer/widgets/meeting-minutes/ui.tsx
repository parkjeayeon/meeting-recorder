// 회의록 본문 (article.doc 안): 소제목·목록·할 일(체크)·문단, **굵게**, (12:34) 시각은 눌러서 듣기, 용어 밑줄.
// 흐름도는 '요약' 다음 소제목 앞에, 그 아래 '액션'·'흐름도' 만들기 줄(없을 때만), 용어 칸, 확인 필요 안내.
// 덩어리 나누기는 entities/minutes, 흐름도·액션·용어는 각 기능 부품 — 여기는 묶어서 그린다.
import { useRef, useState, type ReactNode } from 'react';
import { parseStamp } from '../../../core/script.mts';
import { inlinePieces, minutesBlocks, TermText, type Term, type TermMatcher } from '../../entities/minutes/index.ts';
import { ActionsRowBody, type ActionsRowProps } from '../../features/meeting-actions/index.ts';
import { FlowRowBody, FlowsBody, type FlowRowProps, type FlowsProps } from '../../features/meeting-flow/index.ts';
import { GlossaryBody, type GlossaryProps } from '../../features/meeting-terms/index.ts';
import { Icon, useNativeEvent } from '../../shared/ui/index.tsx';

export interface MinutesProps {
  /** minutes.md */
  readonly md: string;
  /** 녹음이 있으면 시각을 눌러 그 자리부터 */
  readonly seek: ((sec: number) => void) | null;
  readonly matcher: TermMatcher | null;
  readonly openTerm: (anchor: HTMLElement, t: Term) => void;
  /** 흐름도가 있으면 카드들, 없으면 null (만들기 줄을 그린다) */
  readonly flows: FlowsProps | null;
  readonly flowRow: FlowRowProps;
  /** 액션이 없을 때만 '액션 찾기' 줄 */
  readonly actionsRow: ActionsRowProps | null;
  readonly glossary: GlossaryProps;
  /** 확인 필요 안내 ('## 확인 필요' 섹션이 있을 때) */
  readonly review: { readonly finalized: boolean; readonly open: number; readonly go: () => void } | null;
  /** 할 일 체크 (n번째 할 일) */
  readonly toggleTodo: (index: number, done: boolean) => void;
}

/** 한 줄: 굵게·글·시각 묶음. 용어 밑줄은 한 줄 안에서 처음 나온 곳에만 */
function Inline({ text, matcher, seek, openTerm }: { readonly text: string; readonly matcher: TermMatcher | null; readonly seek: MinutesProps['seek']; readonly openTerm: MinutesProps['openTerm'] }) {
  const seen = new Set<string>();
  return inlinePieces(text).map((p, i) => {
    if (p.kind !== 'stamps') {
      const t = <TermText key={i} text={p.text} matcher={matcher} seen={seen} open={openTerm} />;
      return p.kind === 'bold' ? <b key={i}>{t}</b> : t;
    }
    // 시각 칩과 바로 뒤 문장부호("(02:50)." → 칩 + ".")를 한 덩어리로 묶어 마침표만 다음 줄로 넘어가지 않게 한다
    return [
      ' ',
      <span key={i} className="stamps">
        {p.times.map((t, k) => [k ? ' ' : null, seek ? <button key={k} className="seek" title="여기부터 듣기" onClick={() => seek(parseStamp(t))}>{t}</button> : <span key={k} className="num">{t}</span>])}
        {p.punct || null}
      </span>,
    ];
  });
}

/** 할 일 한 줄: 체크는 속성으로만, 바뀌면 바로 줄을 지우고 주인이 저장 */
function Todo({ checked, onToggle, children }: { readonly checked: boolean; readonly onToggle: (done: boolean) => void; readonly children: ReactNode }) {
  const [done, setDone] = useState(checked);
  const cb = useRef<HTMLInputElement>(null);
  useNativeEvent(cb, 'change', (el) => {
    setDone(el.checked);
    onToggle(el.checked);
  });
  return (
    <li className={`todo${done ? ' done' : ''}`}>
      <input ref={(el) => {
        cb.current = el;
        if (el) el.checked = done;
      }} type="checkbox" aria-label="할 일 완료" />
      <span>{children}</span>
    </li>
  );
}

export function MinutesBody(p: MinutesProps) {
  const line = (text: string, matcher = p.matcher) => <Inline text={text} matcher={matcher} seek={p.seek} openTerm={p.openTerm} />;
  return (
    <>
      {minutesBlocks(p.md, { flows: Boolean(p.flows) }).map((b, i) => {
        if (b.kind === 'flows') return <div key={i} className="flows"><FlowsBody {...p.flows!} /></div>;
        if (b.kind === 'list') {
          return (
            <ul key={i}>
              {b.items.map((it, k) => (it.todo
                ? <Todo key={k} checked={it.checked} onToggle={(d) => p.toggleTodo(it.index, d)}>{line(it.text)}</Todo>
                : <li key={k}>{line(it.text)}</li>))}
            </ul>
          );
        }
        const Tag = b.kind;
        return <Tag key={i}>{line(b.text, b.kind === 'p' ? p.matcher : null)}</Tag>;
      })}
      {p.actionsRow ? <div className="flow-row"><ActionsRowBody {...p.actionsRow} /></div> : null}
      {!p.flows ? <div className="flow-row"><FlowRowBody {...p.flowRow} /></div> : null}
      <section className="glossary"><GlossaryBody {...p.glossary} /></section>
      {p.review ? (
        <div className="review-callout">
          <Icon id={p.review.finalized ? 'i-check' : 'i-alert'} />
          <span>{p.review.finalized ? '확인을 마친 회의록입니다.' : p.review.open ? `초안입니다. 확인이 필요한 부분이 ${p.review.open}개 남아 있습니다.` : '확인 필요 항목을 모두 처리했습니다. 확인을 마치면 회의록이 확정됩니다.'}</span>
          <button className="btn small" onClick={p.review.go}>{p.review.finalized ? '확인 결과 보기' : '확인하기'}</button>
        </div>
      ) : null}
    </>
  );
}
