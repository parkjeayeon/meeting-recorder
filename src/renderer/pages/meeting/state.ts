// 회의 페이지가 쓰는 모양과, 역할 모듈들이 같이 받는 맥락(PageCtx).
// 역할마다 자기 상태는 자기 안에 든다. 여러 역할이 같이 쓰는 것만 여기의 이름 붙은 함수로 읽고 바꾼다:
// 보일 탭(tab·setTab), 다음 그리기의 포커스(wantFocus — 주인은 paint), 쓰던 글(drafts), 다시 그리기(draw), 다시 읽기(refreshDoc).
import type { Term } from '../../entities/minutes/index.ts';
import type { MeetingItem } from '../../entities/meeting/index.ts';
import type { ActionsData } from '../../features/meeting-actions/index.ts';
import type { FlowChatMessage, FlowData } from '../../features/meeting-flow/index.ts';
import type { Playback } from '../../features/meeting-player/index.ts';
import type { ChatMessage, Review, ReviewItem } from '../../features/meeting-review/index.ts';
import type { RecorderApi } from '../../shared/api/index.ts';
import type { Jobs } from '../../shared/lib/index.ts';
import type { createIslands } from '../../shared/page-host/index.tsx';
import type { FocusWant } from '../../shared/ui/index.tsx';

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
  /** 지금 기록 목록 전체 — 회의만 거르지 않는다(옛 화면처럼 주소의 id가 기록에 있으면 연다). 주인은 app/history */
  readonly records: () => readonly MeetingRecord[];
  /** 회의 id → 읽은 문서 (주인은 app/meeting: 파일이 바뀌면 지운다) */
  readonly docs: Map<string, MeetingDoc>;
  readonly toast: Toast;
  readonly confirm: (title: string, text: string, yes: string) => Promise<boolean>;
  readonly loadHistory: () => Promise<void>;
  /** 사전 개수·목록을 다시 그린다 (확인 필요가 사전에 단어를 넣거나 뺐을 때) */
  readonly refreshSettings: () => Promise<void>;
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

/** 확인 필요 채팅 (주인은 chats.ts — 열고 닫기, 안의 메시지·쓰던 글은 review-chat.ts가 바꾼다) */
export interface ReviewChat {
  ids: string[];
  messages: (ChatMessage & { redo?: (ChatMessage['redo'] & { start?: number; end?: number }) | null })[];
  busy: boolean;
  applying: Set<string>;
  redoing?: string | null;
  draft?: string;
}
/** 흐름도 채팅 (주인은 chats.ts — 열고 닫기, 안은 flows.ts가 바꾼다) */
export interface FlowChat {
  flowId: string;
  messages: (FlowChatMessage & { applied?: boolean })[];
  busy: boolean;
  /** '이대로 바꾸기'를 반영하는 중인 수 */
  applying?: number;
  draft: string;
}

/** 입력칸에 쓰던 글 (다시 그려도 남게). 열쇠는 data-focus와 같다: resolve:r3, redo-start:r6, flow-focus, unmatched:… */
export interface Drafts {
  get(key: string): string | undefined;
  set(key: string, text: string): void;
  /** 지금 것의 사본 (그리는 부품에 넘긴다) */
  copy(): Map<string, string>;
  /** 이 말로 시작하는 열쇠를 모두 지운다 (앞 채팅의 제안 칸) */
  dropPrefix(prefix: string): void;
}
export function createDrafts(): Drafts {
  const m = new Map<string, string>();
  return {
    get: (key) => m.get(key),
    set: (key, text) => void m.set(key, text),
    copy: () => new Map(m),
    dropPrefix: (prefix) => {
      for (const k of [...m.keys()]) if (k.startsWith(prefix)) m.delete(k);
    },
  };
}

export type Islands = ReturnType<typeof createIslands>;

/** 역할 모듈들이 같이 받는 것. 주인은 controller.ts(meetingPage) */
export interface PageCtx {
  readonly id: string;
  readonly deps: MeetingDeps;
  readonly api: RecorderApi;
  readonly docs: Map<string, MeetingDoc>;
  readonly toast: Toast;
  readonly loadHistory: () => Promise<void>;
  readonly playback: Playback;
  readonly audio: HTMLAudioElement;
  readonly jobs: Jobs;
  /** body에 붙는 React 부품 (용어 카드·설명 추가) */
  readonly islands: Islands;
  /** 그린 페이지 (지워진 회의 화면에는 없다 — 그때는 역할의 명령이 불리지 않는다) */
  readonly page: () => HTMLElement;
  readonly rec: () => MeetingRecord | undefined;
  readonly recNow: () => MeetingRecord;
  readonly seek: (sec: number, play?: boolean) => void;
  /** 녹음이 있으면 시각을 눌러 그 자리부터 */
  readonly seekOf: (r: MeetingRecord) => ((sec: number) => void) | null;
  /** 보일 탭 (draw가 없는 탭이면 첫 탭으로 바로잡는다) */
  readonly tab: () => string | null;
  /** 다음 그리기에서 보일 탭 — 그리지는 않는다 */
  readonly setTab: (tab: string | null) => void;
  /** 이번 그리기 뒤에 포커스를 줄 곳 (그리기 전 자리보다 먼저) */
  readonly wantFocus: (want: FocusWant) => void;
  readonly drafts: Drafts;
  readonly draw: () => Promise<void>;
  /** 문서를 다시 읽고 그린다. 제목 아래 '확인 N개 남음'·목록 카드 숫자도 같이 */
  readonly refreshDoc: (r: MeetingRecord) => Promise<void>;
}

export const errText = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// 다시 그리는 명령은 한 박자 뒤에(later) — 누른 부품을 그 처리 중에 다시 만들지 않게
export const later = <A extends unknown[]>(fn: (...a: A) => unknown) => (...a: A) => queueMicrotask(() => void fn(...a));
