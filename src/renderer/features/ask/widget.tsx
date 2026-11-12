// 오른쪽 아래 둥근 버튼 + 질문 창 + 다 찾았을 때 알림. 어느 화면에서든 보인다 (옛 drawAsk와 같은 마크업)
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ASK_EXAMPLES, ASK_STAGES, askError, askLabel, askSecs, LiveSecs, rangeText, scopeText, type AskJob } from '../../entities/ask/index.ts';
import { Icon, useNativeEvent } from '../../shared/ui/index.tsx';
import { CondBar } from './cond-bar.tsx';
import type { AskStore } from './store.ts';

export interface AskWidgetDeps {
  /** 지금 회의 화면인가 (그러면 찾기를 시작하자마자 그 탭으로, 버튼 이름도 '탭 보기') */
  readonly onMeetings: () => boolean;
  /** 이 기능이 Codex로 돌게 되면 Claude Code를 추천한다는 안내를 보일지 */
  readonly usesCodex: () => boolean;
  readonly noteClosed: () => boolean;
  readonly closeNote: () => void;
  readonly openSettings: (sec: string) => void;
}

export function AskWidget({ store, deps }: { readonly store: AskStore; readonly deps: AskWidgetDeps }) {
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const running = s.jobs.filter((t) => t.status === 'running');
  const unseen = s.jobs.filter((t) => t.status === 'done' && !t.seen).length;
  const t = s.toast;
  const bad = t ? t.status !== 'done' : false;
  return (
    <>
      {s.open ? <Panel store={store} deps={deps} /> : t ? (
        <button className={`fab-toast${bad ? ' bad' : ''}`} onClick={() => (bad ? store.toggle(true) : store.go(t))}>
          <Icon id={bad ? 'i-alert' : 'i-check'} />
          <span><b>{askLabel(t)}</b>{t.status === 'error' ? ' 찾지 못했습니다' : t.results.length ? ` ${t.results.length}건을 찾았습니다` : ' 맞는 회의가 없습니다'}</span>
          <span className="go">보기</span>
        </button>
      ) : null}
      <button className="fab" aria-label={s.open ? '질문 창 닫기' : '질문으로 찾기'} aria-expanded={s.open} title={s.open ? '질문 창 닫기' : running.length ? `질문으로 찾기 · ${running.length}개 찾는 중` : '질문으로 찾기'} onClick={() => store.toggle()}>
        <Icon id={s.open ? 'i-x' : 'i-chat'} />
        {running.length > 0 ? <span className="fab-ring" /> : null}
        {!s.open && unseen > 0 ? <span className="fab-badge">{String(unseen)}</span> : null}
      </button>
    </>
  );
}

function Panel({ store, deps }: { readonly store: AskStore; readonly deps: AskWidgetDeps }) {
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const ta = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const [noteClosed, setNoteClosed] = useState(deps.noteClosed);
  // 입력칸 값은 쥐지 않는다: 바깥에서 바뀐 질문(예시·질문 고치기·보낸 뒤 비움)만 넣는다
  useLayoutEffect(() => {
    if (ta.current!.value !== s.draft) ta.current!.value = s.draft;
  }, [s.draft]);
  useNativeEvent(ta, 'input', (el) => store.setDraft(el.value));
  // 키도 입력칸에 직접 (거품이 안 오르는 keydown도 받게 — 옛 화면처럼)
  useNativeEvent(ta, 'keydown', (_el, e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing) {
      k.preventDefault();
      void send();
    }
    if (k.key === 'Escape') store.toggle(false);
  });
  // 그릴 때마다 대화 끝으로 (옛 화면도 그릴 때마다), 막 열었으면 입력칸에 포커스
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  });
  useLayoutEffect(() => {
    if (!s.justOpened) return;
    const id = requestAnimationFrame(() => ta.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [s.justOpened]);
  // 회의 화면이면 바로 그 탭으로, 다른 화면이면 그 자리에 둔다 (다 찾으면 버튼 뱃지와 알림)
  const send = async () => {
    const t = await store.start(ta.current!.value);
    if (t && deps.onMeetings()) store.go(t);
  };
  const showNote = deps.usesCodex() && !noteClosed;
  return (
    <aside className={`askpanel${s.justOpened ? ' opening' : ''}`} role="dialog" aria-label="질문으로 찾기">
      <header>
        <Icon id="i-chat" />
        <span>질문으로 찾기</span>
        <button className="icon-btn" aria-label="닫기" onClick={() => store.toggle(false)}><Icon id="i-x" /></button>
      </header>
      <div ref={log} className="asklog">
        {showNote ? (
          // 채팅 첫머리: 이 기능이 Codex로 돌게 되면 Claude Code를 추천한다고만 알린다 (측정: docs/measurements.md)
          <div className="bubble ai note">
            <span className="warn-line"><Icon id="i-alert" /><b>이 기능은 Claude Code를 추천해요</b></span>
            <span>Claude Code에 로그인돼 있지 않아 Codex로 찾습니다. 정확도는 비슷하지만 Claude Code가 더 빠르고 사용량을 덜 씁니다.</span>
            <div className="warn-acts">
              <button className="btn small" onClick={() => deps.openSettings('cleanup')}>설정 › 다듬기 열기</button>
              <button className="btn small ghost" onClick={() => {
                deps.closeNote();
                setNoteClosed(true);
              }}>알겠어요</button>
            </div>
          </div>
        ) : null}
        {s.jobs.length ? s.jobs.map((t) => <Bubbles key={t.id} t={t} store={store} deps={deps} />) : (
          <div className="ask-hint">
            찾고 싶은 회의를 말로 적으세요. 기간·주제·상태를 함께 적어도 됩니다. 녹취까지 찾아 회의 화면에 탭을 만들고, 다른 화면으로 가도 계속 찾습니다.
            <div className="ask-examples">
              {ASK_EXAMPLES.map((x) => <button key={x} type="button" onClick={() => store.useExample(x)}>{x}</button>)}
            </div>
          </div>
        )}
      </div>
      <div className="askcompose">
        <div className="composer">
          <textarea ref={ta} rows={1} placeholder="예: 작년 2월 성능 시험 관련 회의" aria-label="찾을 회의" />
          <div className="bottom">
            <CondBar scope={s.scope} setScope={store.setScope} />
            <button className="ask-send" aria-label="찾기" title="찾기 (Enter)" onClick={() => void send()}><Icon id="i-send" /></button>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** 질문 하나의 대화: 내 질문 + 답 (찾는 중·멈춤·실패·막힘·찾음) */
function Bubbles({ t, store, deps }: { readonly t: AskJob; readonly store: AskStore; readonly deps: AskWidgetDeps }) {
  const again = async (scope = t.scope, go = true) => {
    const n = await store.redo(t, scope);
    if (n && go && deps.onMeetings()) store.go(n);
  };
  const me = <div className="bubble me">{t.q}<small>{`범위 ${scopeText(t.scope)}`}</small></div>;
  let ai;
  if (t.status === 'blocked') {
    // 질문 속 기간과 기간 칩이 겹치지 않을 때: 찾지 않고 이유와 고칠 방법을 보인다
    ai = (
      <div className="bubble ai warn">
        <span className="warn-line"><Icon id="i-alert" /><b>찾지 않았습니다</b></span>
        <span>{`질문의 기간(${rangeText(t.conds?.from, t.conds?.to)})과 기간 칩(${rangeText(t.scope.from, t.scope.to)})이 겹치지 않아요. 둘 다 맞아야 해서 이대로 찾으면 늘 0건입니다.`}</span>
        <div className="warn-acts">
          <button className="btn small" onClick={() => {
            store.setScope({ ...store.getSnapshot().scope, from: '', to: '' });
            void again({ ...t.scope, from: '', to: '' });
          }}>기간 칩 빼고 질문 날짜로 찾기</button>
          <button className="btn small ghost" onClick={async () => {
            store.setDraft(t.q);
            await store.remove(t);
            setTimeout(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus());
          }}>질문 고치기</button>
        </div>
      </div>
    );
  } else if (t.status === 'running') {
    ai = (
      <div className="bubble ai">
        <span className="busy-line">
          <span className="spin" />
          {ASK_STAGES.find(([k]) => k === t.stage)?.[1] ?? ''}
          <LiveSecs t={t} className="num" />
          <button className="btn small ghost ask-stop" onClick={() => void store.stop(t)}>멈추기</button>
        </span>
      </div>
    );
  } else if (t.status === 'stopped') {
    ai = (
      <div className="bubble ai">
        <span>{`${askSecs(t)} 만에 멈췄습니다.`}</span>
        <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => void again()}><Icon id="i-redo" />다시 찾기</button>
      </div>
    );
  } else if (t.status === 'error') {
    const e = askError(t);
    ai = (
      <div className="bubble ai warn">
        <span className="warn-line"><Icon id="i-alert" /><b>{e.title}</b></span>
        <span>{e.hint}</span>
        <div className="warn-acts"><button className="btn small" onClick={() => void again(t.scope, false)}><Icon id="i-redo" />다시 찾기</button></div>
      </div>
    );
  } else {
    const c = t.conds;
    ai = (
      <div className="bubble ai">
        <span>{t.results.length ? `${t.results.length}건을 찾아 탭으로 모았습니다.` : '맞는 회의를 찾지 못했습니다.'}</span>
        {c ? (
          <div className="conds">
            {c.from || c.to ? <span className="cond">{rangeText(c.from, c.to)}</span> : null}
            {(c.terms ?? []).slice(0, 3).map((x, i) => <span key={i} className="cond">{x}</span>)}
          </div>
        ) : null}
        <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => store.go(t)}>{deps.onMeetings() ? '탭 보기' : '회의에서 보기'}<Icon id="i-right" /></button>
      </div>
    );
  }
  return <>{me}{ai}</>;
}
