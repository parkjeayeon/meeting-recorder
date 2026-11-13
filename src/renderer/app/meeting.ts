import type { MeetingDeps, MeetingDoc, MeetingRecord } from '../pages/meeting/index.ts';
import { createPlayback } from '../features/meeting-player/index.ts';
import type { RecorderApi } from '../shared/api/index.ts';
import { clock, createJobs, store, remember } from '../shared/lib/index.ts';
import type { HistoryRow, HistoryStore } from './history.ts';
import type { Router } from './router.ts';
import type { SettingsStore } from '../entities/settings/index.ts';

export interface MeetingAppDeps {
  readonly api: RecorderApi;
  readonly history: HistoryStore;
  readonly settingsStore: SettingsStore;
  readonly router: () => Router;
  readonly toast: MeetingDeps['toast'];
  readonly confirm: MeetingDeps['confirm'];
  readonly fullDate: MeetingDeps['fullDate'];
}

export function createMeeting({ api, history, settingsStore, router, toast, confirm: confirmBox, fullDate }: MeetingAppDeps) {
  const loadHistory = () => history.reload();
  let docCache: Map<string, MeetingDoc>;
  let openReviewNext: string | null;
  let meetingDeps: MeetingDeps;

  api.onMinutes(({ id, status, offline }: { id: string; status: string; offline?: boolean }) => {
    if (status === 'done') {
      docCache.delete(id);
      // 회의록은 바로 쓸 수 있는 초안이다. 확인할 항목이 있으면 같이 알린다
      api.history().then((list: readonly HistoryRow[]) => {
        const r = list.find((m) => m.id === id);
        const open = r?.review?.open ?? 0;
        toast('회의록 초안을 만들었습니다', open ? `확인 필요 ${open}개 · 확인하면 회의록을 확정합니다` : r ? clock(r.durationSec) : '', {
          action: open ? '확인하기' : '열기', ms: 10000,
          onAction: () => {
            if (open) openReviewNext = id;
            location.hash = `#meeting/${encodeURIComponent(id)}`;
          },
        });
      });
    }
    if (status === 'short') toast('회의 녹음을 저장했습니다', '10초 미만이라 회의록은 만들지 않았습니다');
    if (status === 'error') {
      toast(offline ? '인터넷 연결이 없어 회의록을 쓰지 못했습니다' : '회의록을 만들지 못했습니다', offline ? '녹취는 저장했습니다. 연결되면 이어서 씁니다' : '', {
        bad: true, action: '보기', onAction: () => (location.hash = `#meeting/${encodeURIComponent(id)}`),
      });
    }
    loadHistory();
  });

  // 파일이 바뀌면(앱 밖에서 고친 경우 포함) 열려 있는 회의와 목록을 다시 읽는다
  api.onMeetingChanged(({ id }: { id: string }) => {
    docCache.delete(id);
    if (router().route().name === 'meeting' && router().route().arg === id) router().current()?.reload?.();
    loadHistory();
  });
  function initialize() {
    // ── 회의 상세 ───────────────────────────────────────────────────────────
    docCache = new Map(); // 회의 id → { minutes, transcript, scriptClean }

    // 오래 걸리는 LLM 작업(흐름도 만들기·다시 만들기, 액션 찾기)을 회의별로 기억한다.
    // 탭을 옮기거나 화면을 다시 그리면 버튼이 새로 만들어져 '정리하는 중…'이 사라지고, 다시 누르면 같은 작업이 두 번 돌았다.
    const jobs = createJobs(); // `${dir}|흐름도` 같은 키 → { promise, label } (React 부품도 구독해 '… 중'을 그린다)
    const audio = new Audio(); // 문서 밖에 두어 화면을 다시 그려도 재생이 끊기지 않는다
    audio.preload = 'metadata';
    // 재생 상태(시각·멈춤·속도·따라가기)를 재생 막대와 스크립트가 같이 구독한다 (features/meeting-player)
    const playback = createPlayback(audio, { initial: store('follow', true), save: (on) => remember('follow', on) });

    openReviewNext = null; // 알림에서 '확인하기'로 들어오면 확인 필요 탭을 연다

    // 회의 페이지: 그리기는 pages/meeting(MeetingPage), 페이지 상태·명령·⌘F는 같은 곳의 주인(meetingPage). 앱 전체의 것만 여기서 넘긴다
    meetingDeps = {
      api,
      records: () => history.getSnapshot().rows as readonly MeetingRecord[],
      docs: docCache,
      toast,
      confirm: (title, text, yes) => confirmBox(title, text, yes),
      loadHistory: () => loadHistory(),
      refreshSettings: () => settingsStore.refresh(),
      replaceRoute: (hash) => router().replace(hash),
      canGoBack: () => router().canGoBack(),
      setCrumbs: (title) => router().setCrumbs(title),
      takeOpenReview: (mid) => {
        if (openReviewNext !== mid) return false;
        openReviewNext = null;
        return true;
      },
      playback,
      jobs,
      fullDate: (d) => fullDate(d),
    };
    return meetingDeps;
  }

  return {
    initialize,
    get deps() { return meetingDeps; },
    get docs() { return docCache; },
    openReview: (id: string) => { openReviewNext = id; },
  };
}

export type MeetingApp = ReturnType<typeof createMeeting>;
