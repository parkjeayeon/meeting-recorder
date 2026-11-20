// 회의 페이지의 주인: 맥락(PageCtx) 하나를 만들고 역할 모듈을 엮어 그리기·수명을 잇는다.
// 역할마다 한 파일 — paint(그리기·포커스·한글 조합), view(draw), review·review-chat·chats(확인 필요와 채팅), flows, terms, actions,
// minutes-doc, script, menu, find(⌘F), keys(문서 키). 여러 역할이 같이 쓰는 상태는 state.ts의 PageCtx로만 (docs/renderer-architecture.md)
// 앱 전체의 것(기록 목록·회의 문서 캐시·알림·라우터 …)은 deps로 받는다.
import { createIslands, reactPage, type PageHandle } from '../../shared/page-host/index.tsx';
import { createActions } from './actions.ts';
import { createChats } from './chats.ts';
import { createFind } from './find.ts';
import { createFlows } from './flows.ts';
import { createKeys } from './keys.ts';
import { createMenu } from './menu.ts';
import { createMinutesDoc } from './minutes-doc.ts';
import { createPaint } from './paint.ts';
import { createReviewChat } from './review-chat.ts';
import { createReview } from './review.ts';
import { createScript } from './script.ts';
import { createDrafts, type MeetingDeps, type MeetingDoc, type MeetingRecord, type PageCtx } from './state.ts';
import { createTerms } from './terms.ts';
import { MeetingPage, type MeetingCommands } from './ui.tsx';
import { createView } from './view.ts';

export type { MeetingDeps, MeetingDoc, MeetingRecord } from './state.ts';

let audioFor: string | null = null; // 재생기에 지금 올린 회의 (같은 회의로 돌아오면 이어서) — 페이지보다 오래 살아 모듈에 둔다

export function meetingPage(id: string, deps: MeetingDeps): PageHandle {
  const { api, docs: docCache, toast, loadHistory, playback, jobs } = deps;
  const audio = playback.audio;
  const islands = createIslands(); // body에 붙는 React 부품 (용어 카드·설명 추가)
  const find = createFind();
  const paint = createPaint({ afterPaint: find.refresh });
  let tab: string | null = null; // 보일 탭 — 여러 역할이 ctx.setTab으로 바꾸고, 없는 탭이면 draw가 첫 탭으로 바로잡는다
  const rec = () => deps.records().find((m) => m.id === id);
  const seek = (sec: number, play = true) => playback.seek(sec, play);
  const ctx: PageCtx = {
    id, deps, api, docs: docCache, toast, loadHistory, playback, audio, jobs, islands,
    page: () => paint.root()!,
    rec,
    recNow: () => rec()!,
    seek,
    seekOf: (r: MeetingRecord) => (r.firstFile ? (sec: number) => seek(sec) : null),
    tab: () => tab,
    setTab: (t) => {
      tab = t;
    },
    wantFocus: paint.want,
    drafts: createDrafts(),
    draw: () => view.draw(),
    refreshDoc: async (r) => {
      docCache.set(r.id, (await api.readMinutes(r.dir)) as MeetingDoc);
      void ctx.draw();
      void loadHistory(); // 제목 아래 '확인 N개 남음'·목록 카드 숫자도 같이
    },
  };

  // 역할들 — 만들 때는 아무것도 하지 않는다 (문서·창에 붙이는 것은 아래 수명 차례에서). 서로 부르는 것은 고른 명령만 넘긴다
  const chats = createChats(ctx);
  const review = createReview(ctx, { open: (ids) => reviewChat.open(ids), runRedo: (r, itemId, range) => reviewChat.runRedo(r, itemId, range) });
  const reviewChat = createReviewChat(ctx, chats, review);
  const terms = createTerms(ctx, review);
  const flows = createFlows(ctx, chats);
  const actions = createActions(ctx);
  const minutesDoc = createMinutesDoc(ctx, { flows, actions, terms });
  const script = createScript(ctx, terms);
  const menu = createMenu(ctx);
  const keys = createKeys({ page: ctx.page, find, terms, chats, playback });
  const view = createView(ctx, { show: paint.show, chats, terms, review, reviewChat, flows, actions, minutesDoc, script, menu });

  const commands: MeetingCommands = {
    setTab: view.setTab,
    ...menu.commands,
    copyScript: script.copyScript,
    makeClean: script.makeClean,
    back: () => window.history.back(),
    toMeetings: () => deps.replaceRoute('#meetings'),
    setFindScope: find.setScope,
  };
  if (deps.takeOpenReview(id)) tab = 'review';

  const r0 = rec();
  if (!r0) {
    const goneHandle = reactPage(MeetingPage, { source: paint.source, commands });
    paint.show({ gone: { canBack: deps.canGoBack() } });
    setTimeout(() => deps.setCrumbs('삭제된 녹음'));
    return goneHandle;
  }
  const handle = reactPage(MeetingPage, { source: paint.source, commands }, { reload: () => reloadPage(), update: () => view.changed(), leave: () => leavePage() });
  paint.attach(handle.el, () => void ctx.draw());

  if (audioFor !== id) {
    audio.pause();
    audio.src = r0.firstFile ? `rec://m/${encodeURIComponent(r0.id)}/${encodeURIComponent(r0.firstFile)}` : '';
    audioFor = id;
  }
  terms.listen(handle.el);

  // 문서 키는 이 차례로 붙인다 (거품 단계): 찾기 막대 → 채팅 Escape → 스페이스. 용어 카드의 Escape는 카드를 열 때 붙잡기 단계로 (terms.ts)
  document.addEventListener('keydown', keys.onFindKey);
  document.addEventListener('keydown', keys.onEscChat);
  window.addEventListener('resize', flows.onResize);
  document.addEventListener('keydown', keys.onKey);

  // 파일이 바뀌면 다시 읽기, 진행률·상태·확인 필요 숫자가 바뀐 경우에만 다시 그리기(view.changed), 떠날 때 치우기
  function reloadPage() {
    docCache.delete(id);
    void ctx.draw();
  }
  function leavePage() {
    window.removeEventListener('resize', flows.onResize);
    document.removeEventListener('keydown', keys.onKey);
    terms.closeCard();
    terms.removeAddBtn();
    islands.clear();
    find.close();
    document.removeEventListener('keydown', keys.onFindKey);
    document.removeEventListener('keydown', keys.onEscChat);
    api.watchMeeting(null);
  }

  void ctx.draw();
  api.watchMeeting(r0.dir); // 이 회의 파일이 바뀌면(앱 밖에서 고쳐도) 다시 읽어 그린다
  return handle;
}
