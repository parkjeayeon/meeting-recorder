// 회의 화면의 질문 탭 본문 (옛 askHead·askView와 같은 마크업): 질문과 조건·진행·실패, 다 찾으면
// 주제로 다룬 회의 / 잠깐 언급된 회의 (조건이 기간·상태뿐이면 한 묶음), 줄마다 걸린 이유 한 줄. 보면 본 것으로 표시한다.
import { useLayoutEffect, useRef } from 'react';
import { ASK_STAGES, askError, askSecs, LiveSecs, rangeText, scopeText, type AskHit, type AskJob } from '../../entities/ask/index.ts';
import { LedgerRows, type LedgerActions, type MeetingItem } from '../../entities/meeting/index.ts';
import { Icon, Num, scrollSpy } from '../../shared/ui/index.tsx';
import type { AskStore } from './store.ts';

function AskHead({ t, store }: { readonly t: AskJob; readonly store: AskStore }) {
  const c = t.conds;
  const steps = ASK_STAGES.filter(([k]) => k === 'parse' || !c || c.terms?.length);
  const at = steps.findIndex(([k]) => k === t.stage);
  const running = t.status === 'running';
  const terms = c?.terms ?? [];
  let foot;
  if (running) {
    foot = (
      <div className="steps">
        {steps.map(([, label], i) => (
          <span key={label} className={i < at ? 'ok' : i === at ? 'now' : ''}>
            {/* 표시마다 key를 달리해 새로 만든다 (React가 빈칸을 돌기로 고쳐 쓰면 style=""이 남는다) */}
            {i < at ? <Icon key="ok" id="i-check" /> : i === at ? <span key="now" className="spin" /> : <span key="wait" style={{ width: 11 }} />}
            {label}
          </span>
        ))}
        <span className="later"><LiveSecs t={t} />· 다른 화면으로 가도 계속 찾습니다</span>
      </div>
    );
  } else if (t.status === 'error') {
    const e = askError(t);
    foot = (
      <div className="ask-error" role="alert">
        <Icon id="i-alert" />
        <div><b>{e.title}</b><p>{e.hint}</p>{e.detail ? <p className="why">{e.detail}</p> : null}</div>
      </div>
    );
  } else if (t.status === 'stopped') foot = <div className="conds">{`${askSecs(t)} 만에 멈췄습니다 · 다시 찾기로 처음부터 찾습니다`}</div>;
  else foot = <div className="conds">{`${t.results.length}건 · ${t.candidates ? `후보 ${t.candidates}개 중 추림 · ` : ''}${askSecs(t)} 걸림`}</div>;
  return (
    <div className="askhead">
      <div className="qline">
        <Icon id="i-search" />
        <b>{t.q}</b>
        {running ? <button className="btn small" onClick={() => void store.stop(t)}>멈추기</button> : null}
        {!running ? <button className="btn small" onClick={() => {
          store.setDraft(t.q);
          store.toggle(true);
        }}>질문 고치기</button> : null}
        {!running ? <button className="btn small" onClick={async () => {
          const n = await store.redo(t);
          if (n) store.go(n);
        }}><Icon id="i-redo" />다시 찾기</button> : null}
      </div>
      {/* 실패했으면 '푸는 중'을 남기지 않는다 */}
      {c || running ? (
        <div className="conds">
          {c ? (
            <>
              <span className="cond">{`범위 ${scopeText(t.scope)}`}</span>
              {c.from || c.to ? <span className="cond">{`기간 ${rangeText(c.from, c.to)}`}</span> : null}
              {c.status ? <span className="cond">상태 조건 있음</span> : null}
              {c.focus === 'main' ? <span className="cond">주로 다룬 회의만</span> : null}
              {terms.length ? <span className="cond">{`찾을 말 ${terms.slice(0, 4).join(' · ')}${terms.length > 4 ? ` 외 ${terms.length - 4}` : ''}`}</span> : null}
            </>
          ) : <span>조건을 푸는 중…</span>}
        </div>
      ) : null}
      {foot}
    </div>
  );
}

function Results({ groups, byId, actions }: { readonly groups: readonly (readonly [string, string, readonly AskHit[]])[]; readonly byId: ReadonlyMap<string, MeetingItem>; readonly actions: LedgerActions }) {
  const body = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  useLayoutEffect(() => scrollSpy(body.current!, nav.current!));
  const shown = groups.filter(([, , list]) => list.length);
  return (
    <div className="mlist">
      <div ref={body}>
        {shown.map(([id, title, list]) => (
          <section key={id} className="mix-sec" id={id} data-spy="">
            <div className="sec-h"><h2>{title}</h2><span>{`${list.length}건`}</span></div>
            <div className="ledger-month">
              <LedgerRows list={list.map((x) => byId.get(x.id)!)} recent reasons={list.map((x) => (x.reason ? { text: x.reason, quote: x.quote } : null))} actions={actions} />
            </div>
          </section>
        ))}
      </div>
      <nav ref={nav} className="index" aria-label="바로 가기">
        <span className="pill" aria-hidden="true" />
        <h3>바로 가기</h3>
        {shown.map(([id, title, list]) => <button key={id} data-target={id}>{title}<Num>{list.length}</Num></button>)}
      </nav>
    </div>
  );
}

export function AskTab({ t, all, store, actions }: { readonly t: AskJob; readonly all: readonly MeetingItem[]; readonly store: AskStore; readonly actions: LedgerActions }) {
  useLayoutEffect(() => store.markSeen(t));
  if (t.status !== 'done') return <div><AskHead t={t} store={store} /></div>;
  const byId = new Map(all.map((r) => [r.id, r]));
  const hits = t.results.filter((x) => byId.has(x.id)); // 그 사이 지운 회의는 뺀다
  if (!hits.length) {
    return (
      <div>
        <AskHead t={t} store={store} />
        <div className="empty-state">
          <span className="empty-mark"><Icon id="i-search" /></span>
          <b>맞는 회의를 찾지 못했습니다</b>
          <p>범위를 넓히거나 다른 말로 물어보세요.</p>
        </div>
      </div>
    );
  }
  const groups: [string, string, AskHit[]][] = hits.some((x) => x.level)
    ? [['ask-main', '주제로 다룬 회의', hits.filter((x) => x.level !== 'mention')], ['ask-mention', '잠깐 언급된 회의', hits.filter((x) => x.level === 'mention')]]
    : [['ask-all', '맞는 회의', hits]];
  return (
    <div>
      <AskHead t={t} store={store} />
      <Results groups={groups} byId={byId} actions={actions} />
    </div>
  );
}
