// draw(): 기록과 문서를 읽어 무엇을 보일지(view)를 만들어 그린다 — 머리·탭·탭 본문·채팅. 탭 본문과 채팅의 값은 역할마다 만든다.
// 진행 상태·확인 필요 숫자가 바뀐 경우에만 다시 그리기(changed)도 여기
import { parseScript } from '../../../core/script.mts';
import { speakerOrder, termMatcher } from '../../entities/minutes/index.ts';
import { clock, dayLabel, PROVIDER_NAME, sizeLabel, TIME } from '../../shared/lib/index.ts';
import type { ActionsRole } from './actions.ts';
import type { ChatsRole } from './chats.ts';
import type { FlowsRole } from './flows.ts';
import type { MenuRole } from './menu.ts';
import type { MinutesDocRole } from './minutes-doc.ts';
import type { ReviewChatRole } from './review-chat.ts';
import type { ReviewRole } from './review.ts';
import type { ScriptRole } from './script.ts';
import type { MeetingDoc, MeetingRecord, PageCtx } from './state.ts';
import type { TermsRole } from './terms.ts';
import type { MeetingView, TabBody } from './ui.tsx';

const speakerLabel = (v: string) => (v ? `${v}명` : '자동');

export interface ViewParts {
  readonly show: (v: Partial<MeetingView>) => void;
  readonly chats: ChatsRole;
  readonly terms: TermsRole;
  readonly review: ReviewRole;
  readonly reviewChat: ReviewChatRole;
  readonly flows: FlowsRole;
  readonly actions: ActionsRole;
  readonly minutesDoc: MinutesDocRole;
  readonly script: ScriptRole;
  readonly menu: MenuRole;
}

export interface ViewRole {
  readonly draw: () => Promise<void>;
  /** 탭 줄·머리의 확인 상태가 고른 탭 (한 박자 뒤에 그린다) */
  readonly setTab: (t: string) => void;
  /** 기록이 바뀌었을 때 (라우터의 refresh) — 보이는 상태가 바뀐 경우에만 다시 그린다 */
  readonly changed: () => void;
}

// 회의록 진행 상태와 확인 필요 숫자(제목 아래 배지)가 바뀌면 다시 그린다. 녹음 압축·그대로 두기도
const stateKey = (r: MeetingRecord) => JSON.stringify([r.minutes?.status, r.minutes?.progress, r.minutes?.diarizing, r.minutes?.updatedAt, r.minutes?.title, r.review?.open, r.review?.finalized, r.audio?.bytes, r.audio?.declined]);

export function createView(ctx: PageCtx, parts: ViewParts): ViewRole {
  const { api, docs, deps, playback, id } = ctx;
  const { show, chats, terms, review, reviewChat, flows, actions, minutesDoc, script, menu } = parts;
  let lastKey: string | null = null;

  async function draw() {
    const r = ctx.rec();
    if (!r) return;
    const m = r.minutes;
    const s = m?.status;
    lastKey = stateKey(r);
    let doc = docs.get(id);
    if (!doc && ['done', 'error', 'empty'].includes(s ?? '')) {
      doc = (await api.readMinutes(r.dir)) as MeetingDoc;
      docs.set(id, doc);
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
    if (!tabs.some((t) => t[0] === ctx.tab())) ctx.setTab(tabs[0]?.[0] ?? null);
    const tab = ctx.tab();

    terms.closeCard();
    terms.removeAddBtn();
    const matcher = termMatcher(doc.glossary?.terms);
    let body: TabBody = { kind: 'none' };
    if (tab === 'minutes') body = { kind: 'minutes', props: minutesDoc.props(r, doc.minutes ?? '', reviewOpen, () => { ctx.setTab('review'); void draw(); }, matcher) };
    else if (tab === 'review') body = { kind: 'review', props: review.view(r, doc) };
    else if (tab === 'actions') body = { kind: 'actions', props: actions.view(r, doc.actions!) };
    else if (tab === 'clean' || tab === 'raw') {
      const text = tab === 'clean' ? doc.scriptClean : doc.transcript;
      body = { kind: 'script', clean: tab === 'clean', props: text ? script.scriptView(r, parseScript(text), color, matcher) : null, making: false };
    } else if (tab === 'speakers') body = { kind: 'speakers', props: script.speakersView(r, raw, color) };

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
      menu: menu.menu(r, doc),
      speakerBar: order.length > 0 ? script.speakerBar(r, order, color) : null,
      player: r.firstFile ? { playback, raw, color, durationSec: r.durationSec, missing: doc.speech?.missing ?? [] } : null,
      compress: menu.compressNote(r),
      state: s !== 'done' ? menu.stateCard(r) : null,
      tabs,
      tab,
      body,
      chat: chats.review() ? reviewChat.drawer(r, doc) : null,
      flowChat: chats.flow() ? flows.chatDrawer(r, doc) : null,
    });
  }

  return {
    draw,
    setTab: (t) => queueMicrotask(() => {
      // 탭 줄에서 (←/→·누르기) 바꿨으면 새로 고른 탭에 포커스
      const root = ctx.page();
      if (document.activeElement?.getAttribute('role') === 'tab' && root?.contains(document.activeElement)) ctx.wantFocus({ key: `tab:${t}` });
      ctx.setTab(t);
      void draw();
    }),
    changed: () => {
      const r = ctx.rec();
      if (!r) return;
      if (stateKey(r) !== lastKey) void draw();
    },
  };
}
