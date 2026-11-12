// 회의 페이지 (옛 pageMeeting의 그리기를 옮김: 같은 글자·같은 클래스). 무엇을 보일지는 주인(옛 페이지의 draw)이 만든 view로 받고,
// 주인이 다시 그릴 때마다(version) 안을 새로 만든다 — 옛 화면처럼 열어 둔 고치기 줄·누른 버튼 표시가 다시 그릴 때 풀린다.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActionsBody, type ActionsProps } from '../../features/meeting-actions/index.ts';
import { FlowChatBody, type FlowChatProps } from '../../features/meeting-flow/index.ts';
import { PlayerBody, ScriptBody, SpeakerBarBody, SpeakersBody, type PlayerProps, type ScriptProps } from '../../features/meeting-player/index.ts';
import { ReviewBody, ReviewChatBody, type ReviewChatProps, type ReviewProps } from '../../features/meeting-review/index.ts';
import { MinutesBody, type MinutesProps } from '../../widgets/meeting-minutes/index.ts';
import { sizeLabel, type Source } from '../../shared/lib/index.ts';
import { Icon, Num } from '../../shared/ui/index.tsx';

export interface MeetingHead {
  readonly title: string;
  /** "2026년 11월 1일 (일) 23:00" */
  readonly when: string;
  readonly length: string;
  readonly speakers: number | null;
  /** 참석 인원으로 지정한 값의 말 ("3명") */
  readonly speakersHint: string | null;
  /** 회의록이 있을 때 확인 상태 (누르면 확인 필요 탭) */
  readonly review: { readonly finalized: boolean; readonly open: number } | null;
  readonly provider: string | null;
  readonly model: string | null;
  /** "녹음 689MB · 압축함" */
  readonly audio: string | null;
  readonly diarizeError: string | null;
}
export interface MeetingMenu {
  /** 회의록이 있으면 '회의록 복사' */
  readonly minutes: boolean;
  /** 만드는 중이 아니고 짧은 녹음도 아니면 '다시 만들기' */
  readonly remake: boolean;
  readonly busy: boolean;
  readonly transcript: boolean;
  /** 압축할 수 있으면 메뉴 글 */
  readonly compress: { readonly bytes: number; readonly estimate: number } | null;
  readonly compressBusy: boolean;
  readonly speakersValue: string;
}
export type StateCard =
  | { readonly kind: 'busy'; readonly text: string; readonly progress: number | null }
  | { readonly kind: 'short' }
  | { readonly kind: 'stalled'; readonly offline: boolean; readonly error: string; readonly speakersValue: string }
  | { readonly kind: 'none' | 'error' | 'empty'; readonly error: string; readonly speakersValue: string };
export interface CompressNote {
  readonly bytes: number;
  readonly estimate: number;
  readonly busy: boolean;
}
export type TabBody =
  | { readonly kind: 'minutes'; readonly props: MinutesProps }
  | { readonly kind: 'review'; readonly props: ReviewProps }
  | { readonly kind: 'actions'; readonly props: ActionsProps }
  | { readonly kind: 'script'; readonly clean: boolean; readonly props: ScriptProps | null; readonly making: boolean }
  | { readonly kind: 'speakers'; readonly props: Parameters<typeof SpeakersBody>[0] | null }
  | { readonly kind: 'none' };

export interface MeetingView {
  readonly version: number;
  /** 지워진 회의 (뒤로 갈 곳이 있으면 '뒤로') */
  readonly gone: { readonly canBack: boolean } | null;
  readonly head: MeetingHead | null;
  readonly menu: MeetingMenu | null;
  readonly speakerBar: Parameters<typeof SpeakerBarBody>[0] | null;
  readonly player: PlayerProps | null;
  readonly compress: CompressNote | null;
  readonly state: StateCard | null;
  readonly tabs: readonly (readonly [string, string, string | null])[];
  readonly tab: string | null;
  readonly body: TabBody;
  readonly chat: ReviewChatProps | null;
  readonly flowChat: FlowChatProps | null;
}
export interface MeetingCommands {
  readonly setTab: (tab: string) => void;
  readonly copyMinutes: () => Promise<void>;
  readonly copyScript: (clean: boolean) => Promise<void>;
  readonly copyTranscript: () => void;
  readonly makeClean: () => void;
  readonly remake: (speakers: string) => void;
  readonly resume: () => void;
  readonly reveal: () => void;
  readonly compress: () => void;
  readonly declineCompress: () => void;
  readonly trash: () => void;
  readonly back: () => void;
  readonly toMeetings: () => void;
  /** 그린 탭 본문 (⌘F가 찾는 곳) */
  readonly setFindScope: (el: HTMLElement | null) => void;
}

/** 참석 인원 고르기 (자동·2~10명). 값은 속성으로만 넣는다 */
function SpeakersSelect({ value, selRef }: { readonly value: string; readonly selRef: { current: HTMLSelectElement | null } }) {
  useLayoutEffect(() => {
    selRef.current!.value = value;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- 그릴 때 한 번
  return (
    <select ref={selRef} aria-label="참석 인원">
      <option value="">자동</option>
      {Array.from({ length: 9 }, (_, i) => <option key={i} value={String(i + 2)}>{`${i + 2}명`}</option>)}
    </select>
  );
}

/** 오른쪽 위: 회의록 복사 · 다시 만들기(참석 인원) · 더 보기(Finder·원본 복사·압축·휴지통). 메뉴는 밖을 누르면 닫힌다 */
function Actions({ m, c }: { readonly m: MeetingMenu; readonly c: MeetingCommands }) {
  const [menu, setMenu] = useState<'remake' | 'more' | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setMenu(null);
    const t = setTimeout(() => document.addEventListener('mousedown', outside));
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', outside);
    };
  }, [menu]);
  const toggle = (which: 'remake' | 'more') => setMenu(menu ? null : which);
  return (
    <div ref={wrap} className="meet-acts">
      {m.minutes ? <button className="btn" onClick={(e) => {
        const btn = e.currentTarget;
        void c.copyMinutes().then(() => btn.blur());
      }}><Icon id="i-copy" />회의록 복사</button> : null}
      {m.remake ? <button className="btn" onClick={() => toggle('remake')}><Icon id="i-redo" />다시 만들기</button> : null}
      <button className="icon-btn" aria-label="더 보기" onClick={() => toggle('more')}><Icon id="i-more" /></button>
      {menu === 'remake' ? (
        <div className="menu">
          <label>참석 인원<SpeakersSelect value={m.speakersValue} selRef={sel} /></label>
          <button className="btn primary" onClick={() => {
            setMenu(null);
            c.remake(sel.current!.value);
          }}>녹취부터 다시 만들기</button>
        </div>
      ) : null}
      {menu === 'more' ? (
        <div className="menu">
          <button onClick={() => { setMenu(null); c.reveal(); }}><Icon id="i-folder" />Finder에서 보기</button>
          {m.transcript ? <button onClick={() => { setMenu(null); c.copyTranscript(); }}><Icon id="i-copy" />원본 스크립트 복사</button> : null}
          {m.compress ? <button disabled={m.compressBusy || undefined} onClick={() => { setMenu(null); c.compress(); }}><Icon id="i-folder" />{`녹음 압축하기 (${sizeLabel(m.compress.bytes)} → 약 ${sizeLabel(m.compress.estimate)})`}</button> : null}
          <hr />
          <button className="danger" disabled={m.busy || undefined} onClick={() => { setMenu(null); c.trash(); }}><Icon id="i-trash" />휴지통으로 옮기기</button>
        </div>
      ) : null}
    </div>
  );
}

function Head({ h, menu, c }: { readonly h: MeetingHead; readonly menu: MeetingMenu; readonly c: MeetingCommands }) {
  return (
    <div className="meet-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1>{h.title}</h1>
        <div className="meet-meta">
          <span className="tag">{h.when}</span>
          <span className="tag"><Num>{h.length}</Num></span>
          {h.speakers ? <span className="tag">{`화자 ${h.speakers}명`}</span> : null}
          {h.speakersHint ? <span className="tag">{`참석 인원 ${h.speakersHint}로 지정`}</span> : null}
          {h.review ? (
            <button className={`tag tag-btn${h.review.finalized ? '' : ' accent'}`} title="확인 필요 보기" onClick={() => c.setTab('review')}>
              {h.review.finalized ? '확정된 회의록' : h.review.open ? `초안 · 확인 ${h.review.open}개 남음` : '초안 · 확인 마치기 전'}
            </button>
          ) : null}
          {h.provider ? <span className="tag">{`${h.provider}로 작성`}</span> : null}
          {h.model ? <span className="tag">{`Whisper ${h.model}`}</span> : null}
          {h.audio ? <span className="tag">{h.audio}</span> : null}
          {h.diarizeError ? <span className="tag accent">{`화자 구분 실패: ${h.diarizeError}`}</span> : null}
        </div>
      </div>
      <Actions m={menu} c={c} />
    </div>
  );
}

function StateCardView({ s, c }: { readonly s: StateCard; readonly c: MeetingCommands }) {
  const sel = useRef<HTMLSelectElement>(null);
  if (s.kind === 'busy') {
    return (
      <div className="state">
        <b>회의록을 만드는 중입니다</b>
        <p>{`${s.text} · 2시간 회의는 약 20분 걸립니다. 창을 닫아도 계속됩니다.`}</p>
        <div className={`bar${s.progress === null ? ' indeterminate' : ''}`} style={{ marginTop: '14px' }}><i style={{ width: `${Math.round((s.progress ?? 0.3) * 100)}%` }} /></div>
      </div>
    );
  }
  if (s.kind === 'short') return <div className="state"><b>짧은 녹음입니다</b><p>10초 미만 녹음은 회의록을 만들지 않습니다. 필요 없으면 오른쪽 위 ⋯ 메뉴에서 휴지통으로 옮기세요.</p></div>;
  // 회의록 쓰기에서 멈췄으면(인터넷 끊김·앱 종료) 저장된 녹취로 회의록만 다시 쓴다
  if (s.kind === 'stalled') {
    return (
      <div className="state">
        <b>{s.offline ? '인터넷 연결이 없어 회의록을 쓰지 못했습니다' : '회의록을 쓰다가 멈췄습니다'}</b>
        <p className="err">{s.offline ? '녹취와 화자 구분은 저장되어 있습니다. 연결되면 자동으로 이어서 씁니다.' : `${s.error} · 녹취와 화자 구분은 저장되어 있어 회의록만 다시 쓸 수 있습니다.`}</p>
        <div className="row">
          <button className="btn primary" onClick={c.resume}>회의록만 다시 쓰기</button>
          <label className="hint" style={{ margin: '0 0 0 12px' }}>참석 인원 </label>
          <SpeakersSelect value={s.speakersValue} selRef={sel} />
          <button className="btn" onClick={() => c.remake(sel.current!.value)}>녹취부터 다시</button>
        </div>
      </div>
    );
  }
  return (
    <div className="state">
      <b>{s.kind === 'error' ? '회의록을 만들지 못했습니다' : s.kind === 'empty' ? '들린 말이 없었습니다' : '아직 회의록이 없습니다'}</b>
      <p className={s.kind === 'error' ? 'err' : ''}>{s.kind === 'error' ? s.error : s.kind === 'empty' ? '녹음에서 말소리를 찾지 못했습니다. 마이크를 확인해 주세요.' : '녹음은 저장되어 있습니다. 녹취·화자 구분·회의록을 만들 수 있습니다.'}</p>
      <div className="row">
        <label className="hint" style={{ margin: 0 }}>참석 인원 </label>
        <SpeakersSelect value={s.speakersValue} selRef={sel} />
        <button className="btn primary" onClick={() => c.remake(sel.current!.value)}>{s.kind === 'error' ? '다시 만들기' : '회의록 만들기'}</button>
      </div>
    </div>
  );
}

// 녹음 압축 안내: 녹음에 딸린 안내라 재생 막대 바로 아래 한 줄로. 줄어드는 크기를 막대 길이로 보여 준다
function Compress({ n, c }: { readonly n: CompressNote; readonly c: MeetingCommands }) {
  const ratio = Math.max(0.04, Math.min(1, n.estimate / n.bytes));
  return (
    <div className="compress-note" role="region" aria-label="녹음 압축">
      <div className="compress-text">
        <div className="compress-head">
          <b>확인을 마쳤으니 녹음을 압축할까요?</b>
          <span className="compress-size">
            <span className="compress-bar" aria-hidden="true"><i style={{ width: `${(ratio * 100).toFixed(1)}%` }} /></span>
            {`${sizeLabel(n.bytes)} → 약 ${sizeLabel(n.estimate)}`}
          </span>
        </div>
        <span className="compress-detail">AAC 96kbps · 재생·구간 다시 받아쓰기·녹취부터 다시 만들기는 그대로 됩니다. 원본 WAV는 지웁니다.</span>
      </div>
      <div className="compress-acts">
        <button className={`btn small${n.busy ? ' busy' : ''}`} disabled={n.busy || undefined} onClick={c.compress}>{n.busy ? '압축하는 중…' : '압축하기'}</button>
        <button className="btn small ghost" disabled={n.busy || undefined} onClick={c.declineCompress}>그대로 두기</button>
      </div>
    </div>
  );
}

function Body({ b, c }: { readonly b: TabBody; readonly c: MeetingCommands }) {
  const [making, setMaking] = useState(false);
  if (b.kind === 'minutes') return <article className="doc"><MinutesBody {...b.props} /></article>;
  if (b.kind === 'review') return <div className="review"><ReviewBody {...b.props} /></div>;
  if (b.kind === 'actions') return <div className="acts"><ActionsBody {...b.props} /></div>;
  if (b.kind === 'speakers') {
    return b.props ? <div className="spk-list"><SpeakersBody {...b.props} /></div> : (
      <div className="state"><b>화자 구분 결과가 없습니다</b><p>설정 › 회의에서 화자 구분을 켜고 회의록을 다시 만들면 누가 말했는지 표시됩니다.</p></div>
    );
  }
  if (b.kind === 'script') {
    const busy = making || b.making;
    return (
      <>
        <div className="tab-bar">
          <span>{b.clean ? '맞장구·하다 만 말·잡담을 쳐내고, 같은 사람이 이어서 한 말을 한 줄로 합친 스크립트입니다.' : '녹취 그대로의 스크립트입니다.'}</span>
          {b.props ? <button className="btn" onClick={(e) => {
            const btn = e.currentTarget; // await 뒤에는 e.currentTarget이 null
            void c.copyScript(b.clean).then(() => btn.blur());
          }}><Icon id="i-copy" />{b.clean ? '정리본 복사' : '원본 복사'}</button> : null}
        </div>
        {b.props ? <div className="script"><ScriptBody {...b.props} /></div> : (
          <div className="state">
            <b>정리본이 아직 없습니다</b>
            <p>대화 흐름과 상관없는 말을 쳐낸 정리본을 만듭니다.</p>
            <div className="row">
              <button className={busy ? 'btn primary busy' : 'btn primary'} onClick={() => {
                setMaking(true); // 흐리게 하지 않고 진행 중 표시
                c.makeClean();
              }}>{busy ? '만드는 중… (1~2분)' : '정리본 만들기'}</button>
            </div>
          </div>
        )}
      </>
    );
  }
  return null;
}

/** 지워진 회의 */
function Gone({ canBack, c }: { readonly canBack: boolean; readonly c: MeetingCommands }) {
  return (
    <div className="empty gone">
      <b>삭제된 녹음입니다</b>휴지통으로 옮겼거나 폴더를 옮긴 회의입니다. Finder 휴지통에서 되살리면 다시 보입니다.<br />
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
        {canBack ? <button className="btn" onClick={c.back}><Icon id="i-left" />뒤로</button> : null}
        <button className="btn" onClick={c.toMeetings}>회의 목록</button>
      </div>
    </div>
  );
}

function Page({ v, c }: { readonly v: MeetingView; readonly c: MeetingCommands }) {
  let parts: ReactNode;
  if (v.gone) parts = <Gone canBack={v.gone.canBack} c={c} />;
  else if (v.head) {
    parts = (
      <>
        <Head h={v.head} menu={v.menu!} c={c} />
        {v.speakerBar ? <div className="spk-bar"><SpeakerBarBody {...v.speakerBar} /></div> : null}
        {v.player ? <div className="player"><PlayerBody {...v.player} /></div> : null}
        {v.compress ? <Compress n={v.compress} c={c} /> : null}
        {v.state ? <StateCardView s={v.state} c={c} /> : null}
        {v.tabs.length > 0 ? (
          <div className="tabs" role="tablist">
            {v.tabs.map(([id, label, n]) => <button key={id} className="tab" role="tab" aria-selected={id === v.tab} onClick={() => c.setTab(id)}>{label}{n ? <Num>{n}</Num> : null}</button>)}
          </div>
        ) : null}
        <div ref={c.setFindScope}><Body b={v.body} c={c} /></div>
        {v.chat ? <aside className="chat" aria-label="확인 필요 채팅"><ReviewChatBody {...v.chat} /></aside> : null}
        {v.flowChat ? <aside className="chat" aria-label="흐름도 채팅"><FlowChatBody {...v.flowChat} /></aside> : null}
      </>
    );
  }
  return <div className="page">{parts}</div>;
}

export function MeetingPage({ source, commands }: { readonly source: Source<MeetingView | null>; readonly commands: MeetingCommands }) {
  const v = useSyncExternalStore(source.subscribe, source.getSnapshot);
  // 처음 읽는 동안은 빈 페이지 (옛 화면도 회의록을 읽은 뒤에 그렸다)
  if (!v) return <div className="page" />;
  // 주인이 다시 그릴 때마다 안을 새로 (옛 화면처럼 부품 안 상태가 풀린다)
  return <Page key={v.version} v={v} c={commands} />;
}
