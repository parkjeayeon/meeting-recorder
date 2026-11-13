// 확인 필요 채팅 (aside.chat 안): 기억나는 것을 말하면 녹취 앞뒤를 보고 고칠 말을 제안한다.
// 제안마다 적용·그대로 두기·확인됨으로·구간 다시 받아쓰기, 녹취에서 그대로 찾지 못한 제안은 녹취 글자로 고쳐 적용, 다시 받아쓴 구간은 '녹취에 반영'.
// 채팅 상태(메시지·쓰던 글·적용 중·받아쓰는 중)와 명령은 회의 페이지 주인의 것.
import { useLayoutEffect, useRef, useState } from 'react';
import { clock } from '../../../core/script.mts';
import { REVIEW_KIND } from '../../entities/review/index.ts';
import { Field, Icon, useNativeEvent } from '../../shared/ui/index.tsx';
import type { Fix, ReviewItem } from './model.ts';

export interface ChatProposal {
  readonly id: string;
  readonly heard?: string | null;
  readonly guess?: string;
  readonly keep?: boolean;
  readonly resolve?: string;
  readonly redo?: { readonly start: number; readonly end: number };
}
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly proposals?: readonly ChatProposal[];
  readonly unmatched?: readonly { readonly id: string; readonly heard?: string | null; readonly guess: string }[];
  readonly redo?: { readonly id: string; readonly text: string; readonly empty?: boolean } | null;
}
export interface ReviewChatProps {
  /** 채팅으로 확인하는 항목들 */
  readonly items: readonly ReviewItem[];
  readonly messages: readonly ChatMessage[];
  readonly busy: boolean;
  /** 다시 받아쓰는 중인 항목 */
  readonly redoing: string | null;
  /** 적용 중인 항목 */
  readonly applying: ReadonlySet<string>;
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  readonly send: (text: string) => void;
  readonly close: () => void;
  readonly apply: (fixes: readonly Fix[]) => void;
  /** 녹취 글자로 고쳐 적용 (끝나면 주인이 다시 그린다) */
  readonly applyUnmatched: (fix: Fix) => Promise<void>;
  readonly redo: (id: string, range: { start: number; end: number }) => void;
  readonly applyRedo: (id: string) => void;
}

const Text = ({ text }: { readonly text: string }) => (
  <div className="msg-text">{text.split(/\*\*(.+?)\*\*/g).map((part, i) => (part ? (i % 2 ? <b key={i}>{part}</b> : part) : null))}</div>
);

function Unmatched({ p, applyUnmatched }: { readonly p: NonNullable<ChatMessage['unmatched']>[number]; readonly applyUnmatched: ReviewChatProps['applyUnmatched'] }) {
  const target = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const go = () => {
    const heard = target.current!.value.trim();
    if (!heard) return target.current!.focus();
    setBusy(true);
    void applyUnmatched({ id: p.id, heard, guess: p.guess });
  };
  return (
    <div className="proposal unmatched">
      <div className="proposal-row">
        <Field inputRef={target} initial={p.heard ?? ''} placeholder="녹취에 있는 글자" aria-label="고칠 대상" onEnter={go} />
        <Icon id="i-right" />
        <b>{p.guess}</b>
        <button className={busy ? 'btn small busy' : 'btn small'} onClick={go}>적용</button>
      </div>
      <span className="hint" style={{ margin: 0 }}>{p.heard ? `녹취에서 '${p.heard}'를 그대로 찾지 못했습니다. 녹취에 적힌 글자로 고치면 적용할 수 있습니다.` : '고칠 대상을 받지 못했습니다. 녹취에 적힌 글자를 넣으면 적용할 수 있습니다.'}</span>
    </div>
  );
}

function RedoResult({ redo, applied, applyRedo }: { readonly redo: NonNullable<ChatMessage['redo']>; readonly applied: boolean; readonly applyRedo: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="redo-result">
      <div className="redo-lines">
        {redo.text.split('\n').map((l, i) => {
          const x = /^\[([\d:]+)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/.exec(l);
          return <div key={i} className="redo-line">{x ? <><span className="num">{x[1]}</span>{x[2] ? <b>{x[2]}</b> : null}<span>{x[3]}</span></> : l}</div>;
        })}
      </div>
      {applied ? <div className="proposal-state ok"><Icon id="i-check" />녹취에 반영됨</div> : (
        <div className="redo-acts">
          <button className={busy ? 'btn small primary busy' : 'btn small primary'} onClick={() => {
            setBusy(true);
            applyRedo(redo.id);
          }}>녹취에 반영</button>
        </div>
      )}
    </div>
  );
}

export function ReviewChatBody(p: ReviewChatProps) {
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    input.current!.value = p.draft; // 화면을 다시 그려도 쓰던 글이 남게
    const id = requestAnimationFrame(() => {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 그릴 때 한 번 (페이지가 다시 그릴 때마다 새로 그린다)
  useNativeEvent(input, 'input', (el) => p.setDraft(el.value));
  const go = () => {
    const text = input.current!.value.trim();
    if (text && !p.busy) p.send(text);
  };
  useNativeEvent(input, 'keydown', (_el, e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing) {
      k.preventDefault();
      go();
    }
  });
  const itemOf = (id: string) => p.items.find((x) => x.id === id);
  return (
    <>
      <header className="chat-head">
        <Icon id="i-chat" /><b>확인 필요 채팅</b><span style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="닫기" onClick={p.close}><Icon id="i-x" /></button>
      </header>
      <div className="chat-ctx">{p.items.map((it) => <span key={it.id} className="tag">{it.at ? `${it.at} ` : ''}{it.heard ?? it.heardNote ?? REVIEW_KIND[it.kind]}</span>)}</div>
      <div ref={log} className="chat-log">
        {!p.messages.length ? <p className="chat-empty">기억나는 것, 그때 상황, 맞는 이름 등을 알려 주세요. 녹취 앞뒤를 같이 보고 고칠 말을 제안합니다. 기억이 안 나면 "그대로 두자"고 하면 됩니다.</p> : null}
        {p.messages.map((m, mi) => {
          // 이미 처리한 항목(적용·그대로 둠)은 버튼 대신 결과를 보여 준다 → 같은 제안을 두 번 누르지 않게
          const fixes = (m.proposals ?? []).filter((x) => !x.keep && !x.redo && !x.resolve && itemOf(x.id)?.status === 'open');
          // 녹취에서 고칠 말을 찾지 못한 제안: 버리지 않고 이유와 함께. 녹취에 있는 글자로 고쳐 넣으면 적용할 수 있다
          const unmatched = (m.unmatched ?? []).filter((x) => itemOf(x.id)?.status === 'open');
          return (
            <div key={mi} className={`msg ${m.role}`}>
              <Text text={m.text} />
              {m.proposals?.length ? (
                <div className="proposals">
                  {m.proposals.map((x, k) => {
                    const it = itemOf(x.id);
                    if (x.redo) {
                      const busy = p.redoing === x.id;
                      return (
                        <div key={k} className="proposal">
                          <Icon id="i-redo" /><span>{`${clock(x.redo.start)}~${clock(x.redo.end)} 구간 다시 받아쓰기`}</span>
                          <button className={`btn small${busy ? ' busy' : ''}`} onClick={() => p.redo(x.id, x.redo!)}>{busy ? '받아쓰는 중…' : '다시 받아쓰기'}</button>
                        </div>
                      );
                    }
                    const done = Boolean(it && it.status !== 'open');
                    const busy = p.applying.has(x.id);
                    if (x.resolve) {
                      return (
                        <div key={k} className={`proposal${done ? ' done' : ''}`}>
                          <span>확인됨으로: <b>{x.resolve}</b></span>
                          {done ? <span className={`proposal-state${it!.status === 'resolved' ? ' ok' : ''}`}>{it!.status === 'resolved' ? <><Icon id="i-check" />확인됨</> : '처리함'}</span>
                            : <button className={`btn small primary${busy ? ' busy' : ''}`} onClick={() => p.apply([{ id: x.id, resolve: x.resolve }])}>{busy ? '처리 중…' : '확인됨으로'}</button>}
                        </div>
                      );
                    }
                    const state = !done ? null
                      : it!.status === 'kept' ? <span className="proposal-state">그대로 둠</span>
                      : it!.status === 'resolved' ? <span className="proposal-state ok"><Icon id="i-check" />확인됨</span>
                      : <span className="proposal-state ok"><Icon id="i-check" />{it!.applied === x.guess || x.keep ? '적용됨' : `'${it!.applied}'로 적용됨`}</span>;
                    return (
                      <div key={k} className={`proposal${done ? ' done' : ''}`}>
                        {x.keep ? <span>{`${it?.heard ?? it?.heardNote ?? x.id}: 그대로 두기`}</span> : <><span className="heard">{x.heard}</span><Icon id="i-right" /><b>{x.guess}</b></>}
                        {state ?? (
                          <button className={`btn small${busy ? ' busy' : ''}`} aria-busy={busy ? 'true' : 'false'} onClick={() => p.apply([x.keep ? { id: x.id, keep: true } : { id: x.id, heard: x.heard, guess: x.guess }])}>
                            {busy ? '적용 중…' : x.keep ? '그대로 두기' : '적용'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {fixes.length > 1 ? (
                    <button className="btn small primary" disabled={fixes.some((x) => p.applying.has(x.id)) || undefined} onClick={() => p.apply(fixes.map((x) => ({ id: x.id, heard: x.heard, guess: x.guess })))}>{`${fixes.length}개 모두 적용`}</button>
                  ) : null}
                </div>
              ) : null}
              {unmatched.length ? <div className="proposals">{unmatched.map((x, k) => <Unmatched key={k} p={x} applyUnmatched={p.applyUnmatched} />)}</div> : null}
              {m.redo && !m.redo.empty ? <RedoResult redo={m.redo} applied={Boolean(itemOf(m.redo.id)?.redo?.appliedAt)} applyRedo={p.applyRedo} /> : null}
            </div>
          );
        })}
        {p.redoing ? <div className="msg assistant busy"><div className="msg-text">녹음에서 그 구간을 다시 받아쓰는 중입니다… (30초 구간에 몇 초)</div></div> : null}
        {p.busy ? <div className="msg assistant busy"><div className="msg-text">녹취를 보고 있습니다…</div></div> : null}
      </div>
      <div className="chat-input">
        <textarea ref={input} rows={2} placeholder="예: 화자 1 이름은 김민준이에요 / 그 부분은 기억 안 나요" />
        <button className="icon-btn send" aria-label="보내기" disabled={p.busy || undefined} onClick={go}><Icon id="i-send" /></button>
      </div>
    </>
  );
}
