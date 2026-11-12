// 회의 페이지의 흐름도 (src/flow.js가 만든 flow.json): 사용자가 요청한 회의만. 회의록 요약 아래에 그림마다 카드 —
// 한 줄 요약·채팅·SVG 저장·다시 만들기·지우기, 인수인계. 흐름도가 없으면 '흐름도 만들기' 줄, 그림마다 채팅(고친 그림을 제안받아 반영).
// 뿌리 요소(div.flows · div.flow-row · aside.chat)는 옛 회의 페이지가 만들고 여기는 그 안을 그린다 (createIslands).
import { useLayoutEffect, useRef } from 'react';
import { flowOrder, type FlowDoc, type Wrap } from '../../entities/flow/index.ts';
import type { Jobs } from '../../shared/lib/index.ts';
import { Icon, JobButton, useNativeEvent } from '../../shared/ui/index.tsx';
import { FlowCanvas } from './svg.tsx';

export interface Handoff {
  readonly from?: string | null;
  readonly to?: string | null;
  readonly give: readonly { readonly text: string; readonly owner?: string | null }[];
  readonly todo: readonly { readonly text: string; readonly owner?: string | null }[];
  readonly decided: readonly { readonly text: string; readonly owner?: string | null }[];
}
export interface FlowData {
  readonly flows: readonly FlowDoc[];
  readonly handoff?: Handoff | null;
  readonly reason?: string | null;
}

function HandoffBox({ hd }: { readonly hd: Handoff }) {
  const col = (head: string, cls: string, items: Handoff['give']) => (items.length > 0 ? (
    <div className={`handoff-col ${cls}`}>
      <b>{head}</b>
      <ul>{items.map((x, i) => <li key={i}>{x.text}{x.owner ? <span className="flane">{x.owner}</span> : null}</li>)}</ul>
    </div>
  ) : null);
  return (
    <section className="handoff">
      <div className="handoff-head"><b>인수인계</b>{hd.from || hd.to ? <span>{`${hd.from ?? ''} → ${hd.to ?? ''}`}</span> : null}</div>
      <div className="handoff-cols">
        {col(`${hd.from ?? '넘기는 사람'}이 넘겨줄 것`, 'give', hd.give)}
        {col(`${hd.to ?? '받는 사람'}이 할 일`, 'todo', hd.todo)}
        {col('정해진 것', 'decided', hd.decided)}
      </div>
    </section>
  );
}

export interface FlowsProps {
  readonly data: FlowData;
  readonly seek: ((sec: number) => void) | null;
  /** 그림 놓을 폭 (회의 페이지 본문 폭 − 카드 여백), 모르면 null */
  readonly avail: number | null;
  readonly jobs: Jobs;
  /** 그림마다 다시 만들기 작업 키 */
  readonly remakeKey: (flowId: string) => string;
  readonly openChat: (flowId: string) => void;
  readonly saveSvg: (f: FlowDoc) => void;
  readonly remake: (f: FlowDoc) => void;
  readonly remove: (f: FlowDoc) => void;
  /** 글 나누기 (기본은 본문 글꼴로 재기 — 시험에서 바꾼다) */
  readonly wrap?: Wrap;
}

/** 흐름도 카드들과 인수인계 (div.flows 안) */
export function FlowsBody({ data, seek, avail, jobs, remakeKey, openChat, saveSvg, remake, remove, wrap }: FlowsProps) {
  return (
    <>
      {data.flows.map((f) => (
        <section key={f.id} className="flow">
          <div className="flow-head">
            <div className="flow-titles"><h3>{f.title}</h3>{f.summary ? <p className="flow-summary">{f.summary}</p> : null}</div>
            <span className="tc-badge guess" title="단계·메모는 LLM이 정리했고, 각 항목의 녹취 인용이 실제로 있는지 앱이 확인했습니다">LLM 정리 · 녹취로 확인</span>
            <div className="flow-acts">
              <button className="btn small ghost" onClick={() => openChat(f.id)}><Icon id="i-chat" />채팅</button>
              <button className="btn small ghost" title="흐름도를 SVG 그림 파일로 저장" onClick={() => saveSvg(f)}><Icon id="i-download" />SVG</button>
              <JobButton jobs={jobs} jobKey={remakeKey(f.id)} className="btn small ghost" icon="i-redo" label="다시 만들기" onClick={() => remake(f)} />
              <button className="btn small ghost" onClick={() => remove(f)}><Icon id="i-trash" />지우기</button>
            </div>
          </div>
          <div className="flow-canvas"><FlowCanvas f={f} seek={seek} avail={avail} wrap={wrap} /></div>
        </section>
      ))}
      {data.handoff ? <HandoffBox hd={data.handoff} /> : null}
    </>
  );
}

export interface FlowRowProps {
  /** flow.json이 있나 (만들어 봤는데 그릴 흐름이 없었으면 그 이유) */
  readonly data: FlowData | null;
  readonly jobs: Jobs;
  readonly jobKey: string;
  /** 만들기 (focus: 그릴 흐름, 빈칸이면 알아서) */
  readonly make: (focus: string) => void;
}

/** 흐름도가 없을 때 회의록 아래 줄 (div.flow-row 안): 무엇을 그릴지(선택) 적고 만들기 */
export function FlowRowBody({ data, jobs, jobKey, make }: FlowRowProps) {
  const input = useRef<HTMLInputElement>(null);
  const busy = jobs.has(jobKey);
  return (
    <>
      <div className="flow-row-text">
        <b>흐름도</b>
        <span>{data ? `그릴 흐름을 찾지 못했습니다 · ${data.reason ?? ''}` : '인수인계·업무 절차처럼 단계와 순서를 설명한 회의는 그림으로 정리할 수 있습니다. 원본·정리본·회의록을 모두 보고 만듭니다.'}</span>
      </div>
      <div className="flow-row-acts">
        <input ref={input} type="text" className="flow-focus" placeholder="그릴 흐름 (선택) · 예: 데이터 처리 순서만" maxLength={200} aria-label="그릴 흐름" disabled={busy || undefined} />
        <JobButton jobs={jobs} jobKey={jobKey} className="btn small" icon="i-plus" label="흐름도 만들기" onClick={() => {
          input.current!.disabled = true;
          make(input.current!.value);
        }} />
      </div>
    </>
  );
}

export interface FlowChatMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly revision?: FlowDoc | null;
  readonly applied?: boolean;
}
export interface FlowChatProps {
  readonly f: FlowDoc;
  readonly messages: readonly FlowChatMessage[];
  readonly busy: boolean;
  readonly draft: string;
  readonly setDraft: (text: string) => void;
  readonly send: (text: string) => void;
  readonly apply: (index: number) => Promise<void>;
  readonly close: () => void;
}

/** 흐름도 채팅 (aside.chat 안): 고친 그림을 제안받아 '이대로 바꾸기'로 반영 (바꾼 그림도 녹취 인용을 다시 확인) */
export function FlowChatBody({ f, messages, busy, draft, setDraft, send, apply, close }: FlowChatProps) {
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    input.current!.value = draft;
    const id = requestAnimationFrame(() => {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 그릴 때 한 번 (옛 페이지가 바뀔 때마다 새로 그린다)
  useNativeEvent(input, 'input', (el) => setDraft(el.value));
  const go = () => {
    const text = input.current!.value.trim();
    if (text && !busy) send(text);
  };
  useNativeEvent(input, 'keydown', (_el, e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing) {
      k.preventDefault();
      go();
    }
  });
  return (
    <>
      <header className="chat-head">
        <Icon id="i-chat" /><b>흐름도 채팅</b><span style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="닫기" onClick={close}><Icon id="i-x" /></button>
      </header>
      <div className="chat-ctx"><span className="tag">{f.title}</span></div>
      <div ref={log} className="chat-log">
        {!messages.length ? <p className="chat-empty">그림에서 고칠 점을 말해 주세요. 예: "3번과 4번 순서가 바뀌었어요", "업로드 뒤에 백업 단계도 있어요", "메모를 더 짧게". 녹취를 다시 보고 고친 그림을 제안합니다.</p> : null}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="msg-text">{m.text.split(/\*\*(.+?)\*\*/g).map((part, k) => (part ? (k % 2 ? <b key={k}>{part}</b> : part) : null))}</div>
            {m.revision ? (
              <div className="redo-result">
                <div className="redo-lines">
                  <b>{m.revision.title}</b>
                  {flowOrder(m.revision).map((s, k) => <div key={s.id} className="redo-line"><span className="num">{String(k + 1)}</span><span>{`${s.title} — ${s.detail}`}</span></div>)}
                </div>
                {m.applied ? <div className="proposal-state ok"><Icon id="i-check" />그림에 반영됨</div> : (
                  <div className="redo-acts">
                    <button className="btn small primary" onClick={(e) => {
                      e.currentTarget.classList.add('busy');
                      void apply(i);
                    }}>이대로 바꾸기</button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? <div className="msg assistant busy"><div className="msg-text">녹취를 다시 보고 있습니다…</div></div> : null}
      </div>
      <div className="chat-input">
        <textarea ref={input} rows={2} placeholder="예: 마지막에 백업 단계도 넣어 주세요" />
        <button className="icon-btn send" aria-label="보내기" disabled={busy || undefined} onClick={go}><Icon id="i-send" /></button>
      </div>
    </>
  );
}
