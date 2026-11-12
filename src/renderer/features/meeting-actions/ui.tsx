// 회의 페이지의 액션 (src/actions.js가 만든 actions.json): 할 일(약속·맡은 일·다짐)과 받은 조언·알아 둘 것.
// 뿌리 요소(div.acts · div.flow-row)는 옛 회의 페이지가 만들고 여기는 그 안을 그린다 (createIslands).
// 찾기는 오래 걸리는 작업이라 jobs에 키(`${dir}|액션`)로 두어, 화면을 다시 그리거나 떠났다 와도 '찾는 중'이 남는다.
import { useRef, useState } from 'react';
import { parseStamp } from '../../../core/script.mts';
import type { Jobs } from '../../shared/lib/index.ts';
import { Icon, JobButton, Num, useNativeEvent } from '../../shared/ui/index.tsx';

export interface ActionItem {
  readonly id: string;
  readonly owner?: string | null;
  readonly task: string;
  readonly due?: string | null;
  readonly kind: string;
  readonly at: string;
  readonly quote: string;
  readonly done: boolean;
}
export interface AdviceItem {
  readonly id: string;
  readonly group: string;
  readonly key: boolean;
  readonly why?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly text: string;
  readonly at: string;
  readonly quote: string;
}
export interface ActionsData {
  readonly actions: readonly ActionItem[];
  readonly advice: readonly AdviceItem[];
  readonly adviceTitle?: string | null;
}

const ACTION_KIND: Readonly<Record<string, string>> = { promise: '약속', assigned: '맡음', resolution: '다짐' };

function Stamp({ at, seek }: { readonly at: string; readonly seek: ((sec: number) => void) | null }) {
  return seek ? <button className="seek" title="여기부터 듣기" onClick={() => seek(parseStamp(at))}>{at}</button> : <span className="num">{at}</span>;
}

/** 할 일 한 줄: 체크는 속성으로만(옛 화면처럼 HTML 속성을 남기지 않게), 바뀌면 직접 단 처리기로 받는다 */
function ActionRow({ a, done, seek, onToggle }: { readonly a: ActionItem; readonly done: boolean; readonly seek: ((sec: number) => void) | null; readonly onToggle: (checked: boolean) => void }) {
  const cb = useRef<HTMLInputElement>(null);
  useNativeEvent(cb, 'change', (el) => onToggle(el.checked));
  return (
    <li className={`act-item${done ? ' done' : ''}`} title={`녹취: “${a.quote}”`}>
      <label className="act-check">
        <input ref={(el) => {
          cb.current = el;
          if (el) el.checked = done;
        }} type="checkbox" aria-label={`${a.task} 했음`} />
        <span className="act-task">{a.task}</span>
      </label>
      <div className="act-meta">
        <span className="act-kind">{ACTION_KIND[a.kind] ?? ''}</span>
        <span className="flane">{a.owner}</span>
        {a.due ? <span className="flane due">{a.due}</span> : null}
        <Stamp at={a.at} seek={seek} />
      </div>
    </li>
  );
}

export interface ActionsProps {
  readonly data: ActionsData;
  readonly seek: ((sec: number) => void) | null;
  readonly jobs: Jobs;
  readonly jobKey: string;
  /** 다시 찾기 */
  readonly find: () => void;
  /** 할 일 체크 (주인이 저장하고 기록을 다시 읽는다) */
  readonly toggle: (id: string, done: boolean) => void;
}

/** 액션 탭 (div.acts 안): 할 일은 카드 하나 안에 체크리스트(담당·기한·시각은 오른쪽), 받은 조언은 핵심(★)과 묶음별 */
export function ActionsBody({ data, seek, jobs, jobKey, find, toggle }: ActionsProps) {
  const [done, setDone] = useState<ReadonlyMap<string, boolean>>(() => new Map(data.actions.map((a) => [a.id, a.done])));
  const doneCount = data.actions.filter((a) => done.get(a.id)).length;
  const keys = data.advice.filter((a) => a.key);
  const groups = [...new Set(data.advice.map((a) => a.group))];
  const who = (a: AdviceItem) => (a.from || a.to ? <span className="act-who">{`${a.from ?? ''}${a.to ? ` → ${a.to}` : ''}`}</span> : null);
  return (
    <>
      <div className="tab-bar">
        <span>회의가 끝난 뒤 챙길 것입니다. LLM이 원본·정리본·회의록을 보고 고르고, 각 항목의 녹취 인용을 앱이 확인했습니다. 체크는 회의록의 할 일과 따로 저장됩니다.</span>
        <JobButton jobs={jobs} jobKey={jobKey} className="btn small ghost" icon="i-redo" label="다시 찾기" onClick={find} />
      </div>
      <section className="act-sec">
        {data.actions.length ? (
          <div className="act-board">
            <div className="act-board-head">
              <h3>할 일</h3>
              <Num>{`${doneCount}/${data.actions.length}`}</Num>
              <span className="act-progress" aria-hidden="true"><i style={{ width: `${(doneCount / Math.max(1, data.actions.length)) * 100}%` }} /></span>
            </div>
            <ul className="act-list">
              {data.actions.map((a) => (
                <ActionRow key={a.id} a={a} done={Boolean(done.get(a.id))} seek={seek} onToggle={(checked) => {
                  setDone((m) => new Map(m).set(a.id, checked));
                  toggle(a.id, checked);
                }} />
              ))}
            </ul>
          </div>
        ) : (
          <>
            <div className="act-head"><h3>할 일</h3></div>
            <p className="act-empty">약속하거나 맡은 할 일은 없었습니다.</p>
          </>
        )}
      </section>
      {data.advice.length > 0 ? (
        <section className="act-sec">
          <div className="act-head"><h3>{data.adviceTitle ?? '받은 조언'}</h3><Num>{String(data.advice.length)}</Num></div>
          {keys.length > 0 ? (
            <div className="act-keys">
              {keys.map((a) => (
                <div key={a.id} className="act-key" title={`녹취: “${a.quote}”`}>
                  <b>{'★ '}{a.text}</b>
                  {a.why ? <p>{a.why}</p> : null}
                  <div className="act-meta">{who(a)}<Stamp at={a.at} seek={seek} /></div>
                </div>
              ))}
            </div>
          ) : null}
          {groups.map((g) => (
            <div key={g} className="act-group">
              <h4>{g}</h4>
              <ul>
                {data.advice.filter((a) => a.group === g).map((a) => (
                  <li key={a.id} title={`녹취: “${a.quote}”`}>
                    <span>{a.key ? '★ ' : null}{a.text}</span>
                    <span className="act-meta inline">{who(a)}<Stamp at={a.at} seek={seek} /></span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

export interface ActionsRowProps {
  /** actions.json이 있나 (찾아봤는데 없었으면 그렇다고 보이고 다시 찾기) */
  readonly found: boolean;
  readonly jobs: Jobs;
  readonly jobKey: string;
  readonly find: () => void;
}

/** 회의록 아래 '액션' 줄 (div.flow-row 안): 요청할 때만 만든다 */
export function ActionsRowBody({ found, jobs, jobKey, find }: ActionsRowProps) {
  return (
    <>
      <div className="flow-row-text">
        <b>액션</b>
        <span>{found ? '찾아봤지만 약속한 할 일이나 남길 조언이 없었습니다.' : '약속하거나 맡은 할 일과 받은 조언을 찾아 따로 정리합니다. 있을 때만 "액션" 탭이 생깁니다.'}</span>
      </div>
      <div className="flow-row-acts"><JobButton jobs={jobs} jobKey={jobKey} className="btn small" icon="i-check" label={found ? '다시 찾기' : '액션 찾기'} onClick={find} /></div>
    </>
  );
}
