import { createVocabularyModel, type VocabularyModel } from '../entities/vocabulary/index.ts';
import type { DictRecord } from '../entities/dictation/index.ts';
import type { MeetingItem } from '../entities/meeting/index.ts';
import type { IssueStore } from '../entities/issue/index.ts';
import type { SettingsStore } from '../entities/settings/index.ts';
import { DictionaryPage } from '../pages/dictionary/index.ts';
import { StatsPage } from '../pages/stats/index.ts';
import { HomePage, type HomeActions, type HomeInput, type MeetFilter } from '../pages/home/index.ts';
import { DictationsPage, type DictationsActions, type DictationsInput } from '../pages/dictations/index.ts';
import { MeetingsPage, type MeetingsActions, type MeetingsInput, type Stray } from '../pages/meetings/index.ts';
import { meetingPage, type MeetingDeps } from '../pages/meeting/index.ts';
import { createAskStore, type AskStore, type AskWidgetDeps } from '../features/ask/index.ts';
import type { RecordingHandle } from '../features/recording/index.ts';
import type { ImportMeetingHandle } from '../features/import-meeting/index.ts';
import type { RecorderApi } from '../shared/api/index.ts';
import { clock, sizeLabel, createSource, store, remember, type Source } from '../shared/lib/index.ts'; // 숫자·시간 표시는 한 벌 (React 화면과 같이 씀)
import { reactPage } from '../shared/page-host/index.tsx'; // React 화면을 라우터에 연결한다 (docs/renderer-architecture.md)
import { el } from '../shared/ui/index.tsx';
import type { HistoryStore } from './history.ts';
import type { Router, RouteTable } from './router.ts';
import type { Session } from './session.ts';
import type { MeetingApp } from './meeting.ts';

export interface PagesDeps {
  readonly api: RecorderApi;
  readonly history: HistoryStore;
  readonly issues: IssueStore;
  readonly settingsStore: SettingsStore;
  readonly session: Session;
  readonly router: () => Router;
  readonly meeting: MeetingApp;
  readonly recording: Pick<RecordingHandle, 'openStart'>;
  readonly openSettings: (sec: string) => void;
  readonly importMeeting: ImportMeetingHandle['open'];
  readonly toast: MeetingDeps['toast'];
  readonly confirm: MeetingDeps['confirm'];
  readonly dictations: () => readonly DictRecord[];
  readonly meetings: () => readonly MeetingItem[];
}

export function createPages({ api, history, issues, settingsStore, session, router, meeting, recording, openSettings, importMeeting, toast, confirm: confirmBox, dictations, meetings }: PagesDeps) {
  const loadHistory = () => history.reload();
  let statsSource: Source<Pick<HomeInput, 'dictations' | 'totals' | 'meetings'>>;
  let homeSource: Source<HomeInput>;
  let homeActions: HomeActions;
  let dictationsSource: Source<DictationsInput>;
  let dictationsActions: DictationsActions;
  let meetingsSource: Source<MeetingsInput>;
  let meetingsActions: MeetingsActions;
  let askStore: AskStore;
  let vocabulary: VocabularyModel;

  const routes: RouteTable = {
    home: { title: '홈', mount: () => reactPage(HomePage, { source: homeSource, actions: homeActions }) },
    dictations: { title: '받아쓰기', mount: () => reactPage(DictationsPage, { source: dictationsSource, actions: dictationsActions }) },
    meetings: { title: '회의', mount: openMeetingsPage },
    meeting: { title: '회의', mount: (mid) => meetingPage(mid!, meeting.deps) },
    dictionary: { title: '사전', mount: () => reactPage(DictionaryPage, { model: vocabulary }) },
    stats: { title: '통계', mount: () => reactPage(StatsPage, { source: statsSource }) },
  };

  function createHome() {
    // ── 홈 ───────────────────────────────────────────────────────────────
    // 통계 화면(React)이 읽는 창구: 주인은 app/history(rows·totals), 둘이 바뀌는 history 구독에서 changed()
    statsSource = createSource(() => ({ dictations: dictations(), totals: history.getSnapshot().totals, meetings: meetings() }), () => [history.getSnapshot().rows, history.getSnapshot().totals]);
    // 받아쓰기 요약 (계산은 entities/dictation — 통계 화면과 한 벌). 본체 전체 통계(totals)가 있으면 그것으로

    // 홈: 왼쪽은 할 일(만드는 중 → 챙길 일 → 최근 회의), 오른쪽은 살펴볼 것(시작하기 → 녹음 공간 → 최근 받아쓰기).
    // 처음 만들 땐 회의가 없어 안내 카드뿐이었다 — 이제는 쌓인 회의에서 손이 갈 곳을 먼저 보인다
    session.initializeHome();
    function openMeetings(filter: MeetFilter) {
      session.meetFilterPending = filter;
      location.hash = '#meetings';
    }
    // 홈 화면(React)이 읽는 창구와 명령. 기록(rows·totals·strays)은 history 구독, 문제는 issues 구독에서 changed().
    // freshId·showMarks·openRaw는 바뀐 뒤 router.refresh()가 다시 그려 deps로 알아챈다 (openRaw는 바꿀 때 새 Set)
    homeSource = createSource(
      () => ({ meetings: meetings(), dictations: dictations(), totals: history.getSnapshot().totals, issues: issues.getSnapshot().entries, strayCount: history.getSnapshot().strays.length, freshId: session.freshId, showMarks: session.showMarks, openRaw: session.openRaw }),
      () => [history.getSnapshot().rows, history.getSnapshot().totals, history.getSnapshot().strays, issues.getSnapshot().revision, session.freshId, session.showMarks, session.openRaw],
    );
    homeActions = {
      openSettings: (sec) => openSettings(sec),
      openMeetingStart: () => recording.openStart(),
      openMeetings,
      dismissIssue: (key) => issues.set(key, null),
      copy: (text) => api.copy(text),
      repaste: async (text) => {
        const status = await api.repaste(text);
        if (status !== 'pasted') toast('클립보드에 복사했습니다', '⌘V로 붙여 넣으세요');
      },
    };

    return { statsSource, homeSource, homeActions };
  }

  async function trashMeetings(list: readonly MeetingItem[]) {
    const total = list.reduce((n, m) => n + m.durationSec, 0);
    const title = list.length > 1 ? `녹음 ${list.length}개를 휴지통으로 옮길까요?` : '이 녹음을 휴지통으로 옮길까요?';
    if (!(await confirmBox(title, `녹음 폴더째(총 ${clock(total)}) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.`, '휴지통으로'))) return;
    let failed = 0;
    for (const m of list) await api.trashMeeting(m.dir).catch(() => failed++);
    toast(failed ? `${list.length - failed}개를 옮기고 ${failed}개는 옮기지 못했습니다` : `${list.length}개를 휴지통으로 옮겼습니다`, failed ? '회의록을 만드는 중인 녹음은 옮길 수 없습니다' : '', { bad: Boolean(failed) });
    loadHistory();
  }


  async function trashStrays(list: readonly Stray[]) {
    const bytes = list.reduce((n, f) => n + f.bytes, 0);
    const title = list.length > 1 ? `폴더 ${list.length}개를 휴지통으로 옮길까요?` : `'${list[0]!.id}' 폴더를 휴지통으로 옮길까요?`;
    if (!(await confirmBox(title, `폴더째(총 ${sizeLabel(bytes)}) 휴지통으로 옮깁니다. Finder 휴지통에서 되살릴 수 있습니다.`, '휴지통으로'))) return;
    let failed = 0;
    for (const f of list) await api.trashMeeting(f.dir).catch(() => failed++);
    toast(failed ? `${list.length - failed}개를 옮기고 ${failed}개는 옮기지 못했습니다` : `${list.length}개를 휴지통으로 옮겼습니다`, '', { bad: Boolean(failed) });
    loadHistory();
  }


  function createDictations() {
    // ── 받아쓰기 ────────────────────────────────────────────────────────────
    session.initializeDictations();


    // 받아쓰기 기록 화면(React)이 읽는 창구와 명령. 목록은 화면이 본체(dictPage)에서 이어 받고, 기록(rows)이 바뀌면 다시 받는다.
    // 고친 곳 표시(showMarks)·원문 펼침(openRaw)·녹음 폴더 문제는 주인인 여기 — 바꾸면 changed()
    dictationsSource = createSource(
      () => ({ version: history.getSnapshot().rows, folder: issues.get('folder') ?? null, freshId: session.freshId, showMarks: session.showMarks, openRaw: session.openRaw }),
      () => [history.getSnapshot().rows, issues.getSnapshot().revision, session.freshId, session.showMarks, session.openRaw],
    );
    dictationsActions = {
      loadPage: (query) => api.dictPage(query),
      copy: (text) => api.copy(text),
      repaste: async (text) => {
        const status = await api.repaste(text);
        if (status !== 'pasted') toast('클립보드에 복사했습니다', '⌘V로 붙여 넣으세요');
      },
      toggleRaw: (id) => {
        session.openRaw = new Set(session.openRaw);
        session.openRaw.has(id) ? session.openRaw.delete(id) : session.openRaw.add(id);
        dictationsSource.changed();
      },
      remove: async (id) => {
        if (!(await confirmBox('이 받아쓰기를 지울까요?', '기록과 통계에서 빠집니다. 되돌릴 수 없습니다.', '지우기'))) return;
        await api.deleteDictation(id);
        toast('받아쓰기를 지웠습니다');
        loadHistory();
      },
      setShowMarks: (on) => {
        session.showMarks = on;
        remember('showMarks', session.showMarks);
        dictationsSource.changed();
      },
    };

    return { dictationsSource, dictationsActions };
  }

  // 닫은(없어진)·막힌 질문 탭이면 전체로
  function currentMeetFilter() {
    if (session.meetFilter.startsWith('ask:')) {
      const t = askStore.get(session.meetFilter.slice(4));
      if (!t || t.status === 'blocked') session.meetFilter = 'all';
    }
    return session.meetFilter;
  }
  function setMeetFilter(id: string) {
    session.meetFilter = id;
    document.getElementById('view')!.scrollTop = 0;
    meetingsSource.changed();
  }
  function openMeetingsPage() {
    // 둥근 버튼의 알림·채팅에서 '보기'로 들어오면 그 질문 탭, 홈의 챙길 일에서 오면 그 갈래, 아니면 전체
    session.meetFilter = session.askPending ? `ask:${session.askPending}` : session.meetFilterPending ?? 'all';
    session.askPending = null;
    session.meetFilterPending = null;
    return reactPage(MeetingsPage, { source: meetingsSource, ask: askStore, actions: meetingsActions });
  }


  function createMeetings() {
    // ── 회의 목록 ────────────────────────────────────────────────────────────
    const goMeeting = (r: MeetingItem, review = false) => {
      if (review) meeting.openReview(r.id);
      location.hash = `#meeting/${encodeURIComponent(r.id)}`;
    };
    // 회의 목록 화면(React)이 읽는 창구와 명령. 갈래(meetFilter)는 주인인 여기 — 질문으로 찾기가 탭을 열고 홈이 갈래를 골라 들어온다.
    // 질문 탭은 질문으로 찾기 store를 읽는다 (질문이 바뀌면 store가 알린다)
    session.initializeMeetings();
    meetingsSource = createSource(
      () => ({ meetings: meetings(), strays: history.getSnapshot().strays, folder: issues.get('folder') ?? null, filter: currentMeetFilter(), asks: askStore.getSnapshot().jobs.filter((t) => t.status !== 'blocked') }),
      () => [history.getSnapshot().rows, history.getSnapshot().strays, issues.getSnapshot().revision, session.meetFilter, askStore.getSnapshot().jobs],
    );
    meetingsActions = {
      setFilter: setMeetFilter,
      openMeeting: (r) => goMeeting(r),
      openReview: (r) => goMeeting(r, true),
      trash: (list) => trashMeetings(list),
      trashStrays: (list) => trashStrays(list),
      reveal: (dir) => api.reveal(dir),
      importMeeting: (paths) => importMeeting(paths ?? null),
      openMeetingStart: () => recording.openStart(),
      filePath: (f) => api.filePath(f),
    };
    return { meetingsSource, meetingsActions };
  }

  function createAsk() {
    // ── 질문으로 찾기 (결정 51) ── 찾기는 메인 프로세스(src/ask.js)에서 돌고, 상태 주인은 features/ask의 store.
    // 여기는 화면 이동(회의 화면의 그 질문 탭)과 설정 같은 바깥 일만 넘긴다. 둥근 버튼·질문 창·알림은 React(AskWidget)
    session.initializeAsk();
    askStore = createAskStore({
      api,
      viewing: (id) => router().route().name === 'meetings' && currentMeetFilter() === `ask:${id}`,
      openTab: (id) => {
        if (router().route().name === 'meetings') setMeetFilter(`ask:${id}`);
        else {
          session.askPending = id;
          location.hash = '#meetings';
        }
      },
      notifyError: (title, detail) => toast(title, detail, { bad: true }),
    });
    askStore.connect();
    askStore.subscribe(() => meetingsSource.changed());
    const askRoot = el('div', { class: 'ask-root' });
    document.body.append(askRoot);
    // 이 기능이 실제로 쓸 계정 (메인 프로세스와 같은 규칙: Claude Code에 로그인돼 있으면 그것, 아니면 다듬기 계정)
    const askUsesCodex = (): boolean | null | undefined => {
      const { saved: settings, providers }: {
        saved: { provider?: string } | null;
        providers: Readonly<Record<string, { loggedIn?: boolean } | undefined>> | null;
      } = settingsStore.getSnapshot();
      return providers && !providers['claude-code']?.loggedIn && (settings?.provider === 'codex' || (settings?.provider === 'auto' && providers.codex?.loggedIn));
    };
    const askWidgetDeps: AskWidgetDeps = {
      onMeetings: () => router().route().name === 'meetings',
      usesCodex: () => Boolean(askUsesCodex()),
      noteClosed: () => store('askNoteClosed', false),
      closeNote: () => remember('askNoteClosed', true),
      openSettings: (sec) => openSettings(sec),
    };

    return { askStore, askRoot, askUsesCodex, askWidgetDeps };
  }

  function createDictionary() {
    // ── 사전 ────────────────────────────────────────────────────────────────
    // 사전은 저장된 설정을 읽고, 설정을 그린 끝에서 changed()로 다시 알린다
    vocabulary = createVocabularyModel({ read: () => settingsStore.getSnapshot().saved?.vocabulary ?? '', save: (v) => settingsStore.save({ vocabulary: v }) });
    const vocabWords = () => vocabulary.getSnapshot();

    return { vocabulary, vocabWords };
  }

  return { routes, createHome, createDictations, createMeetings, createAsk, createDictionary };
}
