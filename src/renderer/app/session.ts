import type { MeetFilter } from '../pages/home/index.ts';
import { store } from '../shared/lib/index.ts';

export function createSession() {
  let freshId: string | null = null;
  let meetFilterPending: MeetFilter | null;
  let openRaw: Set<string>;
  let showMarks: boolean;
  let meetFilter: string;
  let askPending: string | null;

  return {
    get freshId() { return freshId; },
    set freshId(id: string | null) { freshId = id; },
    get meetFilterPending() { return meetFilterPending; },
    set meetFilterPending(filter: MeetFilter | null) { meetFilterPending = filter; },
    get openRaw() { return openRaw; },
    set openRaw(raw: Set<string>) { openRaw = raw; },
    get showMarks() { return showMarks; },
    set showMarks(on: boolean) { showMarks = on; },
    get meetFilter() { return meetFilter; },
    set meetFilter(filter: string) { meetFilter = filter; },
    get askPending() { return askPending; },
    set askPending(id: string | null) { askPending = id; },
    initializeHome() {
      meetFilterPending = null; // 홈에서 회의 화면으로 가면서 고를 갈래
    },
    initializeDictations() {
      openRaw = new Set(); // 바꿀 땐 새 Set으로 (창구가 바뀐 줄 안다)
      showMarks = store('showMarks', true);
    },
    initializeMeetings() {
      meetFilter = 'all';
    },
    initializeAsk() {
      askPending = null; // 회의 화면으로 가면서 열 질문 탭
    },
  };
}

export type Session = ReturnType<typeof createSession>;
