// 회의 페이지의 주인: 페이지 상태(탭·고른 항목·고쳐 쓴 말·채팅 …), 파일을 바꾸는 명령, ⌘F, body에 뜨는 용어 카드·설명 추가.
// draw()는 무엇을 보일지(view)를 만들어 창구로 넘기고 그 자리에서 그려 둔다(commit). 그릴 때마다 React가 안을 새로 만든다 — 옛 화면처럼.
// 옛 화면 코드(pageMeeting)에서 그대로 옮겼다. 앱 전체의 것(기록 목록·회의 문서 캐시·알림·라우터 …)은 deps로 받는다.
import { scriptMarkdown, parseScript, speakerStats, type ScriptLine } from '../../../core/script.mts';
import { BUSY, progressOf, statusText, type MeetingItem } from '../../entities/meeting/index.ts';
import { speakerOrder, termMatcher, type Term, type TermMatcher } from '../../entities/minutes/index.ts';
import type { ActionsData } from '../../features/meeting-actions/index.ts';
import { TermCardBody, ExplainAddBody } from '../../features/meeting-terms/index.ts';
import { flowSvgFile, type FlowChatMessage, type FlowData } from '../../features/meeting-flow/index.ts';
import type { Playback } from '../../features/meeting-player/index.ts';
import type { ChatMessage, Fix, Review, ReviewItem } from '../../features/meeting-review/index.ts';
import type { FlowDoc } from '../../entities/flow/index.ts';
import type { RecorderApi } from '../../shared/api/index.ts';
import { clock, createSource, dayLabel, PROVIDER_NAME, sizeLabel, TIME, type Jobs } from '../../shared/lib/index.ts';
import { commit, createIslands, reactPage, type PageHandle } from '../../shared/page-host/index.tsx';
import { el, icon } from './dom.ts';
import type { MeetingMenu, MeetingView, StateCard, TabBody } from './ui.tsx';
import { MeetingPage } from './ui.tsx';

/** 기록 목록의 회의 하나 — 이 페이지가 쓰는 칸까지 */
export type MeetingRecord = MeetingItem & {
  readonly dir: string;
  readonly firstFile?: string | null;
  readonly speakersHint?: number | string | null;
  readonly minutes?: (NonNullable<MeetingItem['minutes']> & { readonly stage?: string; readonly offline?: boolean; readonly updatedAt?: string; readonly timing?: { readonly model?: string }; readonly diarizeError?: string }) | null;
  readonly audio?: (NonNullable<MeetingItem['audio']> & { readonly compressed?: boolean }) | null;
};
/** 회의 폴더에서 읽은 것 (api.readMinutes) */
export interface MeetingDoc {
  minutes?: string;
  transcript?: string;
  scriptClean?: string;
  review?: (Review & { readonly items: readonly ReviewItem[] }) | null;
  glossary?: { readonly terms: readonly Term[] } | null;
  actions?: ActionsData | null;
  flow?: FlowData | null;
  speech?: { readonly missing?: readonly { readonly start: number; readonly end: number }[] } | null;
}
type Toast = (title: string, detail?: string, opts?: { bad?: boolean; ms?: number; action?: string; onAction?: () => void }) => void;
export interface MeetingDeps {
  readonly api: RecorderApi;
  /** 지금 기록 목록 전체 — 회의만 거르지 않는다(옛 화면처럼 주소의 id가 기록에 있으면 연다). 주인은 옛 코드 */
  readonly records: () => readonly MeetingRecord[];
  /** 회의 id → 읽은 문서 (주인은 옛 코드: 파일이 바뀌면 지운다) */
  readonly docs: Map<string, MeetingDoc>;
  readonly toast: Toast;
  readonly confirm: (title: string, text: string, yes: string) => Promise<boolean>;
  readonly loadHistory: () => Promise<void>;
  /** 사전 개수·목록을 다시 그린다 (확인 필요가 사전에 단어를 넣거나 뺐을 때) */
  readonly renderDictSettings: (s: Awaited<ReturnType<RecorderApi['dictSettings']>>) => void;
  readonly replaceRoute: (hash: string) => void;
  readonly canGoBack: () => boolean;
  readonly setCrumbs: (title: string) => void;
  /** 알림의 '확인하기'로 들어오면 확인 필요 탭을 연다 (한 번만) */
  readonly takeOpenReview: (id: string) => boolean;
  readonly playback: Playback;
  readonly jobs: Jobs;
  /** 전체 날짜 (예: 2026년 11월 1일 (일) 23:00) */
  readonly fullDate: (d: Date) => string;
}

interface ReviewChat {
  ids: string[];
  messages: (ChatMessage & { redo?: (ChatMessage['redo'] & { start?: number; end?: number }) | null })[];
  busy: boolean;
  applying: Set<string>;
  redoing?: string | null;
  draft?: string;
}
interface FlowChat {
  flowId: string;
  messages: (FlowChatMessage & { applied?: boolean })[];
  busy: boolean;
  draft: string;
}

const errText = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const speakerLabel = (v: string) => (v ? `${v}명` : '자동');
let audioFor: string | null = null; // 재생기에 지금 올린 회의 (같은 회의로 돌아오면 이어서)

export function meetingPage(id: string, deps: MeetingDeps): PageHandle {
  const { api, docs: docCache, toast, loadHistory, playback, jobs } = deps;
  const audio = playback.audio;
  const islands = createIslands(); // body에 붙는 React 부품 (용어 카드·설명 추가)
  let view: MeetingView | null = null;
  let version = 0;
  const viewSource = createSource(() => view, () => [view]);
  const show = (v: Partial<MeetingView>) => {
    view = { version: ++version, gone: null, head: null, menu: null, speakerBar: null, player: null, compress: null, state: null, tabs: [], tab: null, body: { kind: 'none' }, chat: null, flowChat: null, ...v };
    commit(() => viewSource.changed());
  };
  const rec = () => deps.records().find((m) => m.id === id);
  const recNow = () => rec()!;
  const commands = {
    setTab: (t: string) => queueMicrotask(() => {
      tab = t;
      void draw();
    }),
    copyMinutes: async () => {
      await api.copy(docCache.get(id)?.minutes ?? '');
      toast('회의록을 복사했습니다', '마크다운 형식');
    },
    copyScript: async (clean: boolean) => {
      const d = docCache.get(id) ?? {};
      await api.copy(scriptMarkdown(clean ? d.scriptClean : d.transcript));
      toast(`${clean ? '정리본' : '원본'}을 복사했습니다`, '마크다운 형식');
    },
    copyTranscript: () => {
      api.copy(docCache.get(id)?.transcript);
      toast('원본 스크립트를 복사했습니다');
    },
    makeClean: async () => {
      await api.cleanScript(recNow().dir);
      docCache.delete(id);
      void draw();
    },
    remake: (speakers: string) => remake(recNow(), speakers),
    resume: () => {
      docCache.delete(id);
      api.resumeMinutes(recNow().dir).catch((err: Error) => toast('이어서 쓰지 못했습니다', err.message, { bad: true }));
      setTimeout(loadHistory, 400);
    },
    reveal: () => {
      const r = recNow();
      api.reveal(`${r.dir}/${r.firstFile}`);
    },
    compress: () => void runCompress(recNow()),
    declineCompress: async () => {
      await api.declineCompress(recNow().dir, true);
      toast('원본 그대로 둡니다', '… 메뉴에서 언제든 압축할 수 있습니다');
      await loadHistory();
    },
    trash: async () => {
      if (!(await deps.confirm('이 회의를 휴지통으로 옮길까요?', '녹음 파일과 회의록이 함께 옮겨집니다. Finder 휴지통에서 되살릴 수 있습니다.', '휴지통으로'))) return;
      try {
        audio.pause();
        await api.trashMeeting(recNow().dir);
        toast('휴지통으로 옮겼습니다');
        deps.replaceRoute('#meetings');
        void loadHistory();
      } catch (err) {
        toast('옮기지 못했습니다', (err as Error).message, { bad: true });
      }
    },
    back: () => window.history.back(),
    toMeetings: () => deps.replaceRoute('#meetings'),
    setFindScope: (node: HTMLElement | null) => {
      if (node) findScope = node;
    },
  };
  let tab: string | null = null;
  const reviewSel = new Set<string>(); // 확인 필요에서 고른 항목
  let addDraft = ''; // 확인 필요 › 직접 추가 입력칸 (다시 그려도 남게)
  const guessDraft = new Map<string, string>(); // 항목별로 고쳐 쓴 '고칠 말'
  const redoPick = new Set<string>(); // 구간을 몰라 직접 고르는 중인 항목 (유실·의미 불명)
  let reviewFilter: 'open' | 'done' = 'open';
  let chat: ReviewChat | null = null;
  let flowChat: FlowChat | null = null;
  if (deps.takeOpenReview(id)) tab = 'review';
  let lastKey: string | null = null;
  // 회의록 진행 상태와 확인 필요 숫자(제목 아래 배지)가 바뀌면 다시 그린다. 녹음 압축·그대로 두기도
  const stateKey = (r: MeetingRecord) => JSON.stringify([r.minutes?.status, r.minutes?.progress, r.minutes?.diarizing, r.minutes?.updatedAt, r.minutes?.title, r.review?.open, r.review?.finalized, r.audio?.bytes, r.audio?.declined]);

  const r0 = rec();
  if (!r0) {
    const goneHandle = reactPage(MeetingPage, { source: viewSource, commands });
    show({ gone: { canBack: deps.canGoBack() } });
    setTimeout(() => deps.setCrumbs('삭제된 녹음'));
    return goneHandle;
  }
  const handle = reactPage(MeetingPage, { source: viewSource, commands }, { reload: () => reloadPage(), update: () => updatePage(), leave: () => leavePage() });
  const page = handle.el;

  if (audioFor !== id) {
    audio.pause();
    audio.src = r0.firstFile ? `rec://m/${encodeURIComponent(r0.id)}/${encodeURIComponent(r0.firstFile)}` : '';
    audioFor = id;
  }

  const seek = (sec: number, play = true) => playback.seek(sec, play);
  const seekOf = (r: MeetingRecord) => (r.firstFile ? (sec: number) => seek(sec) : null);

  async function draw() {
    const r = rec();
    if (!r) return;
    const m = r.minutes;
    const s = m?.status;
    lastKey = stateKey(r);
    let doc = docCache.get(id);
    if (!doc && ['done', 'error', 'empty'].includes(s ?? '')) {
      doc = (await api.readMinutes(r.dir)) as MeetingDoc;
      docCache.set(id, doc);
    }
    doc ??= {};
    const raw = parseScript(doc.transcript);
    const order = speakerOrder(raw);
    const color = (who: string) => {
      const i = order.indexOf(who);
      return i >= 0 ? `var(--s${(i % 6) + 1})` : 'var(--line-2)';
    };
    const title = s === 'done' ? m!.title ?? '제목 없는 회의' : `${dayLabel(r.startedAt)} ${TIME.format(new Date(r.startedAt))} 회의`;
    deps.setCrumbs(title);

    const tabs: [string, string, string | null][] = [];
    if (doc.minutes) tabs.push(['minutes', '회의록', null]);
    const reviewOpen = doc.review?.items?.filter((it) => it.status === 'open').length ?? 0;
    // 확인 필요: 회의록이 있으면 늘 (목록이 놓친 것을 직접 추가할 수 있게)
    if (doc.minutes && doc.transcript) tabs.push(['review', '확인 필요', doc.review ? `${reviewOpen}` : null]);
    // 액션: 확인된 할 일·조언이 있을 때만 (대화에 따라 생기고 무조건 생기지 않는다)
    const acts = doc.actions;
    if (acts && (acts.actions?.length || acts.advice?.length)) tabs.push(['actions', '액션', acts.actions.length ? `${acts.actions.filter((a) => !a.done).length}` : null]);
    if (doc.transcript) tabs.push(['clean', '정리본', null], ['raw', '원본', null], ['speakers', '화자', order.length ? `${order.length}명` : null]);
    if (!tabs.some((t) => t[0] === tab)) tab = tabs[0]?.[0] ?? null;

    closeTermCard();
    removeAddBtn();
    const matcher = termMatcher(doc.glossary?.terms);
    let body: TabBody = { kind: 'none' };
    if (tab === 'minutes') body = { kind: 'minutes', props: minutesDoc(r, doc.minutes ?? '', reviewOpen, () => { tab = 'review'; void draw(); }, matcher) };
    else if (tab === 'review') body = { kind: 'review', props: reviewView(r, doc) };
    else if (tab === 'actions') body = { kind: 'actions', props: actionsView(r, doc.actions!) };
    else if (tab === 'clean' || tab === 'raw') {
      const text = tab === 'clean' ? doc.scriptClean : doc.transcript;
      body = { kind: 'script', clean: tab === 'clean', props: text ? scriptView(r, parseScript(text), color, matcher) : null, making: false };
    } else if (tab === 'speakers') body = { kind: 'speakers', props: speakersView(r, raw, color) };

    show({
      head: {
        title,
        when: deps.fullDate(new Date(r.startedAt)),
        length: clock(r.durationSec),
        speakers: m?.speakers || null,
        speakersHint: r.speakersHint ? speakerLabel(String(r.speakersHint)) : null,
        review: s === 'done' && r.review ? { finalized: Boolean(r.review.finalized), open: r.review.open ?? 0 } : null,
        provider: s === 'done' && m!.provider ? PROVIDER_NAME[m!.provider] ?? m!.provider : null,
        model: m?.timing?.model || null,
        audio: (r.audio?.bytes ?? 0) > 0 ? `녹음 ${sizeLabel(r.audio!.bytes)}${r.audio!.compressed ? ' · 압축함' : ''}` : null,
        diarizeError: m?.diarizeError || null,
      },
      menu: meetingMenu(r, doc),
      speakerBar: order.length > 0 ? speakerBar(r, order, color) : null,
      player: r.firstFile ? { playback, raw, color, durationSec: r.durationSec, missing: doc.speech?.missing ?? [] } : null,
      compress: compressNote(r),
      state: s !== 'done' ? stateCard(r) : null,
      tabs,
      tab,
      body,
      chat: chat ? chatDrawer(r, doc) : null,
      flowChat: flowChat ? flowChatDrawer(r, doc) : null,
    });
    if (findBar) runFind({ keep: true }); // 탭을 바꾸거나 다시 그려도 찾던 말을 그대로 표시
  }

  // 스크립트·화자: 이름 바꾸기는 여기서 파일에 (끝나면 다시 그린다)
  const renameTo = (r: MeetingRecord) => (from: string, to: string | null) => queueMicrotask(async () => {
    if (to) {
      await api.renameSpeaker(r.dir, from, to);
      docCache.delete(r.id);
      toast(`'${from}'을 '${to}'(으)로 바꿨습니다`, '회의록과 스크립트에 모두 반영했습니다');
    }
    void draw();
  });

  function scriptView(r: MeetingRecord, lines: ScriptLine[], color: (w: string) => string, matcher: TermMatcher | null) {
    return { lines, color, playback, matcher, openTerm: (anchor: HTMLElement, t: Term) => termCard(anchor, t), rename: renameTo(r) };
  }

  function speakersView(r: MeetingRecord, raw: ScriptLine[], color: (w: string) => string) {
    if (!speakerStats(raw, r.durationSec).length) return null; // '화자 구분 결과가 없습니다'
    return { raw, total: r.durationSec, color, seek: (sec: number) => seek(sec), rename: renameTo(r) };
  }

  // ── 용어 설명 카드: 뿌리(div.term-card)를 body에 붙이고 안은 React(TermCardBody) — 놓을 자리·고치기도 거기서 ──
  let cardEl: HTMLElement | null = null;
  const outsideCard = (e: Event) => {
    const t = e.target as Element;
    if (cardEl && !cardEl.contains(t) && !t.closest?.('.term, .gl-item')) closeTermCard();
  };
  const escCard = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeTermCard();
  };
  function closeTermCard() {
    islands.unmount(cardEl);
    cardEl?.remove();
    cardEl = null;
    document.removeEventListener('mousedown', outsideCard, true);
    document.removeEventListener('keydown', escCard, true);
  }

  async function changeTerm(r: MeetingRecord, termId: string, patch: Record<string, unknown>, done?: string) {
    try {
      await api.updateTerm(r.dir, termId, patch);
      if (done) toast(done);
    } catch (err) {
      toast('바꾸지 못했습니다', (err as Error).message, { bad: true });
    }
    closeTermCard();
    void refreshDoc(r);
  }

  function termCard(anchor: Element, t: Term, editing = false) {
    closeTermCard();
    const r = rec();
    if (!r) return;
    const card = el('div', { class: 'term-card', role: 'dialog', 'aria-label': `${t.term} 설명` });
    cardEl = card;
    document.body.append(card);
    islands.mount(card, TermCardBody, { t, host: card, anchor, editing, reopen: (next: boolean) => setTimeout(() => termCard(anchor, t, next)), seek: seekOf(r), change: (termId, patch, done) => void changeTerm(r, termId, patch, done) });
    setTimeout(() => {
      document.addEventListener('mousedown', outsideCard, true);
      document.addEventListener('keydown', escCard, true);
    });
  }

  // 회의록 아래 용어 칸 (그리기는 features/meeting-terms, 회의록 본문이 같이 그린다)
  function glossaryProps(r: MeetingRecord, g: MeetingDoc['glossary']) {
    return {
      terms: g?.terms ?? [],
      exists: Boolean(g),
      openCard: (anchor: HTMLElement, t: Term) => termCard(anchor, t),
      change: (termId: string, patch: Record<string, unknown>, done?: string) => void changeTerm(r, termId, patch, done),
      make: async () => {
        try {
          await api.makeGlossary(r.dir);
        } catch (err) {
          toast('용어 설명을 만들지 못했습니다', (err as Error).message, { bad: true });
        }
        void refreshDoc(r);
      },
    };
  }

  // ── 액션 (src/actions.js): 할 일(약속·맡은 일·다짐)과 받은 조언·알아 둘 것. 회의록과 따로 actions.json에 ──
  function actionsView(r: MeetingRecord, data: ActionsData) {
    return {
      data,
      seek: seekOf(r),
      jobs,
      jobKey: `${r.dir}|액션`,
      find: () => void findActions(r),
      toggle: async (actionId: string, done: boolean) => {
        const a = data.actions.find((x) => x.id === actionId) as { done: boolean } | undefined;
        if (a) a.done = done; // 저장이 끝나기 전에 다시 그려도 체크가 남게
        await api.toggleAction(r.dir, actionId, done);
        docCache.delete(r.id);
        void loadHistory();
      },
    };
  }

  async function findActions(r: MeetingRecord) {
    const key = `${r.dir}|액션`;
    if (jobs.has(key)) return;
    const run = jobs.run(key, '찾는 중… (1분 안팎)', () => api.makeActions(r.dir) as Promise<ActionsData>);
    try {
      const res = await run;
      toast(res.actions.length || res.advice.length ? '액션을 정리했습니다' : '챙길 할 일이나 조언을 찾지 못했습니다',
        res.actions.length || res.advice.length ? `할 일 ${res.actions.length}개 · ${res.adviceTitle ?? '조언'} ${res.advice.length}개` : '이 대화에는 약속한 일이나 남길 조언이 없었습니다', { ms: 7000 });
      if (res.actions.length || res.advice.length) tab = 'actions';
    } catch (err) {
      toast('액션을 정리하지 못했습니다', errText(err), { bad: true });
    }
    void refreshDoc(r);
  }

  // 회의록 아래 '액션 찾기' (요청할 때만 만든다). 찾아봤는데 없었으면 그렇다고 보여 주고 다시 찾을 수 있게
  function actionsRowProps(r: MeetingRecord, data: ActionsData | null | undefined) {
    return { found: Boolean(data), jobs, jobKey: `${r.dir}|액션`, find: () => void findActions(r) };
  }

  // ── 흐름도 (src/flow.js): 그리기와 자리 계산은 features/meeting-flow · entities/flow. 여기는 파일을 바꾸는 명령과 채팅 상태 ──
  // 그림 놓을 폭 (회의 페이지 본문 폭 − 카드 여백)
  function flowAvail() {
    const v = document.getElementById('view')!.clientWidth;
    return v ? Math.min(v, 1040) - 88 - 36 : null;
  }

  function flowsProps(r: MeetingRecord, data: FlowData) {
    const seekOr = seekOf(r);
    return {
      data,
      seek: seekOr,
      avail: flowAvail(),
      jobs,
      remakeKey: (flowId: string) => `${r.dir}|흐름도 다시|${flowId}`,
      openChat: (flowId: string) => setTimeout(() => openFlowChat(flowId)),
      saveSvg: async (f: FlowDoc) => {
        try {
          const saved = (await api.saveFlowSvg(f.title, flowSvgFile(f, seekOr))) as string | null;
          if (saved) toast('SVG로 저장했습니다', saved.split('/').pop(), { action: 'Finder에서 보기', onAction: () => api.reveal(saved) });
        } catch (err) {
          toast('저장하지 못했습니다', errText(err), { bad: true });
        }
      },
      remake: async (f: FlowDoc) => {
        const key = `${r.dir}|흐름도 다시|${f.id}`;
        if (jobs.has(key)) return;
        try {
          await jobs.run(key, '다시 그리는 중… (1분 안팎)', () => api.remakeFlow(r.dir, f.id) as Promise<unknown>);
          toast('흐름도를 다시 만들었습니다', f.title);
        } catch (err) {
          toast('다시 만들지 못했습니다', errText(err), { bad: true });
        }
        void refreshDoc(r);
      },
      remove: async (f: FlowDoc) => {
        await api.removeFlow(r.dir, f.id);
        toast('흐름도를 지웠습니다', f.title);
        void refreshDoc(r);
      },
    };
  }

  // 흐름도가 없을 때 회의록 아래 줄: 무엇을 그릴지(선택) 적고 만들기. 만들어 봤는데 없었으면 그 이유
  function flowRowProps(r: MeetingRecord, data: FlowData | null | undefined) {
    const key = `${r.dir}|흐름도`;
    return {
      data: data ?? null,
      jobs,
      jobKey: key,
      make: async (focus: string) => {
        if (jobs.has(key)) return;
        try {
          const res = await jobs.run(key, '흐름 정리하는 중… (1분 안팎)', () => api.makeFlow(r.dir, focus) as Promise<FlowData>);
          toast(res.flows.length ? `흐름도 ${res.flows.length}장을 만들었습니다` : '그릴 흐름을 찾지 못했습니다', res.flows.length ? res.flows.map((f) => f.title).join(' · ') : res.reason ?? '', { ms: 7000 });
        } catch (err) {
          toast('흐름도를 만들지 못했습니다', errText(err), { bad: true });
        }
        void refreshDoc(r);
      },
    };
  }

  // 그림마다 채팅: 고친 그림을 제안받아 '이대로 바꾸기'로 반영 (바꾼 그림도 녹취 인용을 다시 확인)
  function openFlowChat(flowId: string) {
    chat = null;
    flowChat = { flowId, messages: [], busy: false, draft: '' };
    void draw();
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chat textarea')?.focus(), 50);
  }

  function flowChatDrawer(r: MeetingRecord, doc: MeetingDoc) {
    const fc = flowChat!;
    const f = doc.flow?.flows?.find((x) => x.id === fc.flowId);
    if (!f) return null;
    return {
      f,
      messages: [...fc.messages],
      busy: fc.busy,
      draft: fc.draft ?? '',
      setDraft: (text: string) => {
        fc.draft = text;
      },
      close: () => setTimeout(() => {
        flowChat = null;
        void draw();
      }),
      send: (text: string) => setTimeout(async () => {
        if (fc.busy) return;
        fc.messages.push({ role: 'user', text });
        fc.draft = '';
        fc.busy = true;
        void draw();
        try {
          const res = await api.chatFlow(r.dir, f.id, fc.messages.map(({ role, text: t }) => ({ role, text: t })));
          fc.messages.push({ role: 'assistant', text: res.text + (res.dropped?.length ? `\n(녹취에서 확인되지 않은 항목 ${res.dropped.length}개는 뺐습니다)` : ''), revision: res.revision });
        } catch (err) {
          fc.messages.push({ role: 'assistant', text: `답을 받지 못했습니다: ${(err as Error).message}` });
        }
        fc.busy = false;
        if (flowChat === fc) void draw();
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chat textarea')?.focus(), 30);
      }),
      apply: async (index: number) => {
        const m = fc.messages[index]!;
        try {
          await api.applyFlow(r.dir, f.id, m.revision);
          m.applied = true;
          toast('흐름도를 고쳤습니다', m.revision!.title);
        } catch (err) {
          toast('반영하지 못했습니다', errText(err), { bad: true });
        }
        void refreshDoc(r);
      },
    };
  }

  // 본문·스크립트에서 단어를 드래그하면 '설명 추가' 버튼을 띄운다
  let addBtn: HTMLElement | null = null;
  const removeAddBtn = () => {
    islands.unmount(addBtn);
    addBtn?.remove();
    addBtn = null;
  };
  function offerExplain() {
    removeAddBtn();
    const sel = window.getSelection();
    const text = sel?.toString().trim().replace(/\s+/g, ' ');
    if (!sel || !text || text.length > 40 || !sel.rangeCount || !page.querySelector('.doc, .script')?.contains(sel.anchorNode)) return;
    const r = recNow();
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const explain = async () => {
      try {
        const t = await api.explainTerm(r.dir, text);
        toast(`'${t.term}' 설명을 더했습니다`, t.note);
      } catch (err) {
        toast('설명을 더하지 못했습니다', errText(err), { bad: true });
      }
      removeAddBtn();
      window.getSelection()?.removeAllRanges();
      void refreshDoc(r);
    };
    // 잘못 들린 말이면 확인 필요로: 입력칸에 고른 말을 넣어 두고 고칠 말·설명을 이어 쓰게 한다
    const cached = docCache.get(id);
    const toReview = cached?.minutes && cached?.transcript ? () => {
      addDraft = `"${text}" `;
      tab = 'review';
      reviewFilter = 'open';
      removeAddBtn();
      window.getSelection()?.removeAllRanges();
      void draw();
      requestAnimationFrame(() => {
        const box = page.querySelector<HTMLTextAreaElement>('.review-add textarea');
        box?.focus();
        box?.setSelectionRange(box.value.length, box.value.length);
      });
    } : null;
    const host = el('div', { class: 'term-add', style: `top:${Math.max(8, rect.top - 38)}px;left:${Math.min(rect.left, innerWidth - 300)}px` });
    addBtn = host;
    document.body.append(host);
    islands.mount(host, ExplainAddBody, { text, explain, toReview });
  }
  page.addEventListener('mouseup', () => setTimeout(offerExplain));
  page.addEventListener('mousedown', (e) => {
    if (!addBtn?.contains(e.target as Node)) removeAddBtn();
  });

  // 회의록 본문: 그리기는 widgets/meeting-minutes (흐름도·액션·용어 부품을 같이). 여기는 파일을 바꾸는 명령과 부품마다의 값
  function minutesDoc(r: MeetingRecord, md: string, reviewOpen: number, openReview: () => void, matcher: TermMatcher | null) {
    const cached = docCache.get(r.id);
    const flowData = cached?.flow;
    const actData = cached?.actions;
    return {
      md,
      seek: seekOf(r),
      matcher,
      openTerm: (anchor: HTMLElement, t: Term) => termCard(anchor, t),
      flows: flowData?.flows?.length ? flowsProps(r, flowData) : null,
      flowRow: flowRowProps(r, flowData),
      actionsRow: !actData?.actions?.length && !actData?.advice?.length ? actionsRowProps(r, actData) : null,
      glossary: glossaryProps(r, cached?.glossary),
      review: /^## 확인 필요/m.test(md) ? { finalized: Boolean(cached?.review?.finalizedAt), open: reviewOpen, go: () => queueMicrotask(openReview) } : null,
      toggleTodo: async (index: number, done: boolean) => {
        const updated = await api.toggleTodo(r.dir, index, done);
        docCache.set(r.id, { ...docCache.get(r.id), minutes: updated });
      },
    };
  }

  // 화자 이름 정하기: 회의록·스크립트의 '화자 N'을 실제 이름으로 바꾼다
  function speakerBar(r: MeetingRecord, order: string[], color: (w: string) => string) {
    return { order, color, rename: renameTo(r) };
  }

  async function refreshDoc(r: MeetingRecord) {
    docCache.set(r.id, (await api.readMinutes(r.dir)) as MeetingDoc);
    void draw();
    void loadHistory(); // 제목 아래 '확인 N개 남음'·목록 카드 숫자도 같이
  }

  async function applyFixes(r: MeetingRecord, fixes: readonly Fix[]): Promise<void> {
    if (!fixes.length) return;
    try {
      const review = await api.applyReview(r.dir, fixes);
      const applied = (review.items as ReviewItem[]).filter((it) => fixes.some((f) => f.id === it.id) && it.status === 'applied');
      const kept = fixes.filter((f) => f.keep).length;
      const resolved = (review.items as ReviewItem[]).filter((it) => fixes.some((f) => f.id === it.id && f.resolve) && it.status === 'resolved');
      for (const f of fixes) reviewSel.delete(f.id);
      if (resolved.length && !applied.length) {
        toast(`${resolved.length}개를 확인됨으로 처리했습니다`, '녹취는 그대로 두고, 확인을 마칠 때 회의록 문장에 반영합니다');
        return await refreshDoc(r);
      }
      const words: string[] = review.addedWords ?? [];
      const skip: { reason: string; heard: string }[] = review.skipped ?? [];
      if (!applied.length && !kept) {
        // 아무것도 바꾸지 못함: 왜 그런지 알린다 (예전엔 "0개를 그대로 두었습니다"로 나와 헷갈렸다)
        const s = skip[0];
        toast('바꿀 곳이 없습니다', s?.reason === 'same' ? `고칠 말이 들린 말('${s.heard}')과 같습니다. 이 표기가 맞다면 '그대로 두기'를 누르세요` : s?.reason === 'notfound' ? `녹취에서 '${s.heard}'를 찾지 못했습니다` : '고칠 말을 넣어 주세요', { bad: true, ms: 7000 });
      } else toast(applied.length ? `${applied.length}개를 고쳤습니다` : `${kept}개를 그대로 두었습니다`,
        applied.length ? `녹취·정리본·회의록에서 ${applied.reduce((n, it) => n + (it.count ?? 0), 0)}곳을 바꿨습니다${words.length ? ` · 사전에 추가: ${words.join(', ')}` : ''}` : '',
        words.length ? { action: '사전 보기', onAction: () => (location.hash = '#dictionary'), ms: 7000 } : {});
      if (words.length) deps.renderDictSettings(await api.dictSettings()); // 사전 개수·목록도 바로
      await refreshDoc(r);
    } catch (err) {
      toast('적용하지 못했습니다', (err as Error).message, { bad: true });
    }
  }

  // 고친 항목 되돌리기: 그 항목이 바꾼 줄만 원래대로, 사전에 자동으로 넣은 단어면 사전에서도 뺀다
  async function revertItem(r: MeetingRecord, it: ReviewItem) {
    try {
      const res = await api.revertReview(r.dir, it.id);
      // 같은 줄을 나중에 고친 항목은 먼저 되돌렸다가 다시 적용한다 (그 항목의 고칠 말이 이제 녹취에 없으면 확인 전으로 연다)
      const again = res.reapplied?.length ? `같은 줄을 나중에 고친 ${res.reapplied.length}개는 다시 적용했습니다` : '';
      const reopened = res.reopened?.length ? `${res.reopened.length}개는 고칠 곳이 없어져 다시 확인 전으로 열었습니다` : '';
      toast('되돌렸습니다', [res.removedWord && `사전에서 '${res.removedWord}'를 뺐습니다`, again, reopened].filter(Boolean).join(' · ') || '항목을 다시 확인 전으로 열었습니다');
      if (res.removedWord) deps.renderDictSettings(await api.dictSettings());
    } catch (err) {
      toast('되돌리지 못했습니다', errText(err), { bad: true });
    }
    void refreshDoc(r);
  }

  // 고친 말을 다른 말로: 되돌린 뒤 새 말로 다시 적용
  async function reapply(r: MeetingRecord, it: ReviewItem, guess: string) {
    try {
      await api.revertReview(r.dir, it.id);
      await applyFixes(r, [{ id: it.id, heard: it.heard, guess }]);
    } catch (err) {
      toast('고치지 못했습니다', errText(err), { bad: true });
      void refreshDoc(r);
    }
  }

  async function keepItems(r: MeetingRecord, ids: readonly string[]) {
    await api.setReviewStatus(r.dir, ids, 'kept');
    ids.forEach((i) => reviewSel.delete(i));
    toast(`${ids.length}개를 그대로 두었습니다`, '나중에 다시 열 수 있습니다');
    void refreshDoc(r);
  }

  async function runRedo(r: MeetingRecord, itemId: string, range: { start: number; end: number }) {
    if (!chat || chat.redoing) return;
    chat.redoing = itemId;
    void draw();
    try {
      const res = await api.redoRange(r.dir, itemId, range.start, range.end);
      const span = `${clock(res.start)}~${clock(res.end)}`;
      chat?.messages.push({
        role: 'assistant',
        text: res.empty
          ? `${span} 구간을 다시 받아써도 알아들을 수 있는 말이 없었습니다. 녹음을 직접 들어 보세요.`
          : `${span} 구간을 다시 받아썼습니다${res.gain > 1.05 ? ` (작은 소리를 ${res.gain}배 키움)` : ''}. 녹취에 반영하면 이 구간 줄만 바뀌고 다른 줄은 그대로입니다.`,
        redo: { id: itemId, ...res },
      });
    } catch (err) {
      chat?.messages.push({ role: 'assistant', text: `다시 받아쓰지 못했습니다: ${errText(err)}` });
    }
    if (chat) chat.redoing = null;
    void draw();
  }

  async function applyRedo(r: MeetingRecord, itemId: string) {
    try {
      const review = await api.applyRedo(r.dir, itemId);
      const it = (review.items as ReviewItem[]).find((x) => x.id === itemId);
      toast('녹취에 반영했습니다', `이 구간 ${it?.count ?? ''}줄만 바꿨습니다 · 확인을 마치면 회의록에도 반영합니다`);
      await refreshDoc(r);
    } catch (err) {
      toast('반영하지 못했습니다', errText(err), { bad: true });
    }
  }

  function openChat(ids: readonly string[]) {
    if (!ids.length) return;
    flowChat = null;
    chat = { ids: [...ids], messages: [], busy: false, applying: new Set() };
    void draw();
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chat textarea')?.focus(), 50);
  }

  // 확인 필요: 그리기는 features/meeting-review. 다시 그리는 명령은 한 박자 뒤에(later) — 누른 부품을 그 처리 중에 다시 만들지 않게
  const later = <A extends unknown[]>(fn: (...a: A) => unknown) => (...a: A) => queueMicrotask(() => void fn(...a));
  function reviewView(r: MeetingRecord, doc: MeetingDoc) {
    const items = doc.review?.items ?? [];
    for (const rid of [...reviewSel]) if (!items.some((it) => it.id === rid && it.status === 'open')) reviewSel.delete(rid);
    const addKey = `${r.dir}|확인추가`;
    return {
      review: doc.review ?? null,
      minutes: doc.minutes ?? '',
      transcript: doc.transcript ?? '',
      filter: reviewFilter,
      selected: new Set(reviewSel),
      guessDraft: new Map(guessDraft),
      redoPick: new Set(redoPick),
      addDraft,
      seek: seekOf(r),
      now: () => audio.currentTime,
      jobs,
      addKey,
      actions: {
        setFilter: later((f: 'open' | 'done') => {
          reviewFilter = f;
          void draw();
        }),
        select: later((rid: string, on: boolean) => {
          if (on) reviewSel.add(rid);
          else reviewSel.delete(rid);
          void draw();
        }),
        selectAll: later((on: boolean) => {
          if (on) items.filter((it) => it.status === 'open').forEach((it) => reviewSel.add(it.id));
          else reviewSel.clear();
          void draw();
        }),
        setGuess: (rid: string, v: string) => void guessDraft.set(rid, v),
        apply: (fixes: readonly Fix[]) => void applyFixes(r, fixes),
        keep: (ids: readonly string[]) => void keepItems(r, ids),
        openChat: later((ids: readonly string[]) => openChat(ids)),
        redo: later((rid: string, range: { start: number; end: number }) => {
          redoPick.delete(rid);
          openChat([rid]);
          void runRedo(r, rid, range);
        }),
        toggleRedoPick: later((rid: string) => {
          if (redoPick.has(rid)) redoPick.delete(rid);
          else redoPick.add(rid);
          void draw();
        }),
        reopen: async (rid: string) => {
          await api.setReviewStatus(r.dir, [rid], 'open');
          void refreshDoc(r);
        },
        revert: (it: ReviewItem) => void revertItem(r, it),
        reapply: (it: ReviewItem, guess: string) => reapply(r, it, guess),
        cancelEdit: later(() => refreshDoc(r)),
        makeReview: async () => {
          try {
            await api.makeReview(r.dir);
            void refreshDoc(r);
            return true;
          } catch (err) {
            toast('정리하지 못했습니다', (err as Error).message, { bad: true });
            return false;
          }
        },
        setAddDraft: (text: string) => {
          addDraft = text;
        },
        add: async (text: string) => {
          if (jobs.has(addKey)) return;
          try {
            const res = await jobs.run(addKey, '녹취에서 찾는 중…', () => api.addReview(r.dir, text) as Promise<{ added: unknown[]; reply?: string }>);
            if (res.added.length) {
              addDraft = '';
              reviewFilter = 'open';
              toast(`확인 필요에 ${res.added.length}개를 더했습니다`, res.reply);
            } else toast('더할 항목을 찾지 못했습니다', res.reply || '녹취에서 그 말을 찾지 못했습니다. 들린 그대로 적어 보세요', { ms: 9000 });
          } catch (err) {
            toast('더하지 못했습니다', errText(err), { bad: true });
          }
          await refreshDoc(r);
          void loadHistory();
        },
        finalize: async () => {
          try {
            const res = await api.finalizeReview(r.dir);
            toast('회의록을 확정했습니다', res.finalize?.rewritten ? '확인 결과에 맞춰 회의록의 해당 부분을 고쳤습니다' : '고친 단어는 이미 반영되어 있어 회의록 문장은 그대로입니다');
            await refreshDoc(r);
            void loadHistory();
            return true;
          } catch (err) {
            toast('확인을 마치지 못했습니다', (err as Error).message, { bad: true });
            return false;
          }
        },
        warn: (title: string) => toast(title, '', { bad: true }),
      },
    };
  }

  function chatDrawer(r: MeetingRecord, doc: MeetingDoc) {
    const c = chat!;
    const items = (doc.review?.items ?? []).filter((it) => c.ids.includes(it.id));
    const apply = async (list: readonly Fix[]) => {
      list.forEach((f) => c.applying.add(f.id));
      void draw();
      await applyFixes(r, list);
      list.forEach((f) => c.applying.delete(f.id));
      void draw();
    };
    return {
      items,
      messages: [...c.messages],
      busy: c.busy,
      redoing: c.redoing ?? null,
      applying: new Set(c.applying),
      draft: c.draft ?? '',
      setDraft: (text: string) => {
        c.draft = text; // 화면을 다시 그려도 쓰던 글이 남게
      },
      close: later(() => {
        chat = null;
        void draw();
      }),
      apply: later(apply),
      applyUnmatched: async (fix: Fix) => {
        await applyFixes(r, [fix]);
        void draw();
      },
      redo: later((rid: string, range: { start: number; end: number }) => runRedo(r, rid, range)),
      applyRedo: (rid: string) => void applyRedo(r, rid),
      send: later(async (text: string) => {
        if (c.busy) return;
        c.messages.push({ role: 'user', text });
        c.draft = '';
        c.busy = true;
        void draw();
        try {
          const res = await api.chatReview(r.dir, c.ids, c.messages.map(({ role, text: t, redo }) => ({ role, text: redo?.text ? `${t}\n${redo.text}` : t })));
          c.messages.push({ role: 'assistant', text: res.text, proposals: res.proposals, unmatched: res.unmatched });
        } catch (err) {
          c.messages.push({ role: 'assistant', text: `답을 받지 못했습니다: ${(err as Error).message}` });
        }
        c.busy = false;
        if (chat === c) void draw();
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('.chat textarea')?.focus(), 30);
      }),
    };
  }

  // 참석 인원 고르기의 처음 값: 지정한 인원, 없으면 회의록이 센 화자 수
  function speakersValue() {
    const r = rec();
    return r?.speakersHint ? String(r.speakersHint) : r?.minutes?.speakers ? String(r.minutes.speakers) : '';
  }

  function remake(r: MeetingRecord, speakers: string) {
    docCache.delete(r.id);
    api.makeMinutes(r.dir, speakers || null);
    toast('회의록을 다시 만듭니다', '녹취·화자 구분·회의록을 처음부터 만듭니다');
    setTimeout(loadHistory, 400);
  }

  // 회의록이 없을 때의 카드: 만드는 중 · 짧은 녹음 · 쓰다가 멈춤(회의록만 다시 쓰기) · 없음/실패/들린 말 없음
  function stateCard(r: MeetingRecord): StateCard {
    const m = r.minutes;
    const s = m?.status;
    if (s !== undefined && BUSY.includes(s)) return { kind: 'busy', text: statusText(m), progress: progressOf(m) };
    if (s === 'short' || r.durationSec < 10) return { kind: 'short' };
    // 회의록 쓰기에서 멈췄으면(인터넷 끊김·앱 종료) 저장된 녹취로 회의록만 다시 쓴다
    if (s === 'error' && m?.stage === 'write') return { kind: 'stalled', offline: Boolean(m.offline), error: m.error ?? '', speakersValue: speakersValue() };
    return { kind: s === 'error' ? 'error' : s === 'empty' ? 'empty' : 'none', error: m?.error ?? '', speakersValue: speakersValue() };
  }

  // 녹음 압축 (AAC 96kbps): 확인을 마친 회의에만 안내한다. 고를 때까지 늘 보이고(모달 아님), '그대로 두기'면 숨기고 … 메뉴에 남긴다.
  // 처음 녹취·회의록·확인은 원본 WAV로 하고, 다 끝난 뒤에만 줄인다 (측정: 96kbps는 받아쓰기 결과가 원본의 흔들림 폭 안)
  function canCompress(r: MeetingRecord) {
    return Boolean(r.minutes?.status === 'done' && r.review?.finalized && r.audio?.wav && r.audio.supported); // 32kHz 미만(가져온 전화 녹음 등)은 압축하지 않는다
  }
  let compressBusy = false;
  async function runCompress(r: MeetingRecord) {
    if (compressBusy) return;
    compressBusy = true;
    void draw();
    const at = audio.currentTime;
    const playing = !audio.paused;
    audio.pause(); // 압축하는 동안 원본을 읽고 있으면 지울 수 없다
    try {
      const res = await api.compressMeeting(r.dir);
      toast('녹음을 압축했습니다', `${sizeLabel(res.before)} → ${sizeLabel(res.after)} · 재생·구간 다시 받아쓰기는 그대로 됩니다`);
      await loadHistory();
      const next = deps.records().find((x) => x.id === r.id);
      if (next?.firstFile) {
        audio.src = `rec://m/${encodeURIComponent(next.id)}/${encodeURIComponent(next.firstFile)}`;
        audio.currentTime = at;
        if (playing) void audio.play();
      }
    } catch (err) {
      toast('압축하지 못했습니다', errText(err), { bad: true, ms: 8000 });
    }
    compressBusy = false;
    void draw();
  }
  function compressNote(r: MeetingRecord) {
    if (!canCompress(r) || r.audio!.declined) return null;
    return { bytes: r.audio!.bytes, estimate: r.audio!.estimate ?? 0, busy: compressBusy };
  }

  // 오른쪽 위 버튼과 메뉴에 무엇을 보일지 (그리기·메뉴 열고 닫기는 pages/meeting)
  function meetingMenu(r: MeetingRecord, doc: MeetingDoc): MeetingMenu {
    const s = r.minutes?.status;
    const busy = s !== undefined && BUSY.includes(s);
    return {
      minutes: Boolean(doc.minutes),
      remake: !busy && Boolean(s) && s !== 'short',
      busy,
      transcript: Boolean(doc.transcript),
      compress: canCompress(r) ? { bytes: r.audio!.bytes, estimate: r.audio!.estimate ?? 0 } : null,
      compressBusy,
      speakersValue: speakersValue(),
    };
  }

  // 창 크기가 바뀌면 흐름도는 가로·세로 배치가 바뀔 수 있어 다시 그린다 (재생 막대는 스스로 다시 칠한다)
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    if (!docCache.get(id)?.flow?.flows?.length) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => void draw(), 250);
  };

  // ── 본문 안 찾기 (⌘F): 지금 보고 있는 탭의 본문만. CSS Highlight로 표시만 하고 글은 고치지 않는다 ──
  let findScope: HTMLElement | null = null; // 그린 탭 본문
  let findBar: HTMLElement | null = null;
  let findHits: Range[] = [];
  let findIdx = -1;
  const canHighlight = typeof Highlight !== 'undefined' && Boolean(CSS.highlights);
  const clearFindMarks = () => {
    if (!canHighlight) return;
    CSS.highlights.delete('find');
    CSS.highlights.delete('find-now');
  };
  function runFind({ keep = false } = {}) {
    if (!findBar) return;
    const q = findBar.querySelector('input')!.value.toLowerCase();
    findHits = [];
    if (q && findScope?.isConnected) {
      // 본문 글자를 이어 붙여 찾는다 (용어 밑줄·시각 칩 경계를 넘는 말도 찾게)
      const nodes: { n: Text; at: number }[] = [];
      let text = '';
      const walker = document.createTreeWalker(findScope, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push({ n: n as Text, at: text.length });
        text += n.nodeValue;
      }
      const hay = text.toLowerCase();
      const nodeAt = (i: number) => {
        let lo = 0;
        let hi = nodes.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (nodes[mid]!.at <= i) lo = mid;
          else hi = mid - 1;
        }
        return nodes[lo]!;
      };
      for (let i = hay.indexOf(q); i !== -1 && findHits.length < 5000; i = hay.indexOf(q, i + q.length)) {
        const a = nodeAt(i);
        const b = nodeAt(i + q.length - 1);
        const range = document.createRange();
        range.setStart(a.n, i - a.at);
        range.setEnd(b.n, i + q.length - b.at);
        findHits.push(range);
      }
    }
    findIdx = !findHits.length ? -1 : keep ? Math.min(Math.max(findIdx, 0), findHits.length - 1) : 0;
    showFind(!keep);
  }
  function stepFind(d: number) {
    if (!findHits.length) return;
    findIdx = (findIdx + d + findHits.length) % findHits.length;
    showFind(true);
  }
  function showFind(scroll: boolean) {
    clearFindMarks();
    const bar = findBar!;
    const q = bar.querySelector('input')!.value;
    bar.querySelector('.find-count')!.textContent = !q ? '' : findHits.length ? `${findIdx + 1}/${findHits.length}` : '없음';
    bar.classList.toggle('none', Boolean(q) && !findHits.length);
    if (!findHits.length || !canHighlight) return;
    CSS.highlights.set('find', new Highlight(...findHits));
    CSS.highlights.set('find-now', new Highlight(findHits[findIdx]!));
    if (!scroll) return;
    const v = document.getElementById('view')!;
    const vr = v.getBoundingClientRect();
    const rr = findHits[findIdx]!.getBoundingClientRect();
    if (rr.top < vr.top + 64 || rr.bottom > vr.bottom - 40) v.scrollTop += rr.top - vr.top - vr.height / 3;
  }
  function openFind() {
    if (!findBar) {
      // 옛 화면도 spellcheck: false를 주려 했지만 h()가 false 값을 건너뛰어 켜져 있었다 — 그대로 (docs/known-issues.md)
      const input = el('input', { type: 'search', placeholder: '이 탭에서 찾기', 'aria-label': '이 탭 본문에서 찾기' }) as HTMLInputElement;
      input.oninput = () => runFind();
      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          stepFind(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      };
      findBar = el('div', { class: 'find-bar', role: 'search' }, icon('i-search') as unknown as Node, input, el('span', { class: 'find-count' }),
        el('button', { class: 'icon-btn find-up', title: '이전 (⇧↩)', 'aria-label': '이전', onclick: () => stepFind(-1) }, icon('i-left') as unknown as Node),
        el('button', { class: 'icon-btn find-down', title: '다음 (↩)', 'aria-label': '다음', onclick: () => stepFind(1) }, icon('i-left') as unknown as Node),
        el('button', { class: 'icon-btn', title: '닫기 (esc)', 'aria-label': '찾기 닫기', onclick: closeFind }, icon('i-x') as unknown as Node));
      document.querySelector('.panel')!.append(findBar);
    }
    const input = findBar.querySelector('input')!;
    input.focus();
    input.select();
    if (input.value) runFind({ keep: true });
  }
  function closeFind() {
    clearFindMarks();
    findBar?.remove();
    findBar = null;
    findHits = [];
    findIdx = -1;
  }
  const onFindKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (e.metaKey && k === 'f') {
      e.preventDefault();
      openFind();
    } else if (e.metaKey && k === 'g' && findBar) {
      e.preventDefault();
      stepFind(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && findBar && !cardEl && !(e.target as Element).closest?.('input, textarea, dialog')) closeFind();
  };
  document.addEventListener('keydown', onFindKey);

  // 스페이스: 재생·멈춤 (입력칸·대화상자·⌘ 조합은 빼고)
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as Element).closest('input, textarea, select, dialog') || e.metaKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      playback.toggle();
    }
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);

  // 파일이 바뀌면 다시 읽기, 진행률·상태·확인 필요 숫자가 바뀐 경우에만 다시 그리기, 떠날 때 치우기
  function reloadPage() {
    docCache.delete(id);
    void draw();
  }
  function updatePage() {
    const r = rec();
    if (!r) return;
    if (stateKey(r) !== lastKey) void draw();
  }
  function leavePage() {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    closeTermCard();
    removeAddBtn();
    islands.clear();
    closeFind();
    document.removeEventListener('keydown', onFindKey);
    api.watchMeeting(null);
  }

  void draw();
  api.watchMeeting(r0.dir); // 이 회의 파일이 바뀌면(앱 밖에서 고쳐도) 다시 읽어 그린다
  return handle;
}
