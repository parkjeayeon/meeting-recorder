// 처음 설정이 쓰는 모양과, 단계 모듈들이 같이 받는 맥락(StepCtx).
// 단계마다 자기 상태(권한 상태·설치 목록·마이크 스트림·눌렀는지 …)는 그 단계에 들어올 때 만든 지역 변수에 든다 — 단계를 떠나면 버린다.
// 여러 단계가 같이 쓰는 것만 여기의 이름 붙은 함수로: 지금 단계(stepId — 주인은 flow), 단계 그림의 세대(instance — 주인은 controller),
// 화면 틀 그리기(frame), 다음으로(next)·마치기(finish), 단계를 떠날 때 정리할 것 맡기기(every·later·onLeave — 주인은 flow).
import type { RecorderApi } from '../../../shared/api/index.ts';
import type { createToaster } from '../../../shared/ui/index.tsx';
import type { SetupComponent } from '../settings/types.ts';
import type { Action, Frame, StepId } from './view.ts';

export type Uses = { dictation: boolean; meetings: boolean };
export type SavedOnboarding = { step?: string | number; uses?: Uses; completed?: boolean; completedAt?: string | Date };

export interface OnboardingCtx {
  readonly api: RecorderApi;
  readonly toast: ReturnType<typeof createToaster>;
  readonly setupListeners: Set<(list: SetupComponent[]) => void>;
  readonly fnListeners: Set<(s: { down: boolean }) => void>;
  readonly tapListeners: Set<() => void>;
  readonly getMic: () => string;
  readonly setMic: (id: string) => void;
  readonly onDone: (uses: Uses) => void | Promise<void>;
}

export const STEPS: { id: StepId; section: string; when?: (u: Uses) => boolean }[] = [
  { id: 'welcome', section: '시작' },
  { id: 'permissions', section: '권한' },
  { id: 'token', section: '설치', when: (u) => u.meetings },
  { id: 'engine', section: '설치' },
  { id: 'account', section: '설치' },
  { id: 'mic', section: '확인' },
  { id: 'fnkey', section: '확인', when: (u) => u.dictation },
  { id: 'practice', section: '연습', when: (u) => u.dictation },
  { id: 'done', section: '연습' },
];
export const SECTIONS = ['시작', '권한', '설치', '확인', '연습'];

/** 단계 모듈들이 같이 받는 것. 주인은 controller.ts(startOnboarding) */
export interface StepCtx extends OnboardingCtx {
  /** 받아쓰기와 회의록은 늘 둘 다 쓴다 (고르지 않는다) */
  readonly uses: Uses;
  /** 지금 단계 — 늦게 온 확인·구독이 아직 그 단계인지 본다 */
  readonly stepId: () => StepId;
  /** 단계에 들어올 때 한 번 받는 그림 세대 (같은 세대 안의 다시 그리기는 같은 부품을 고쳐 그린다) */
  readonly instance: () => number;
  /** 화면 틀(진행 표시·뒤로)을 붙여 그린다. 새로 시작한 처음 설정에 밀려났으면 그리지 않는다 */
  readonly frame: (view: Frame) => void;
  readonly next: () => void;
  readonly finish: () => void;
  /** 단계를 떠날 때 멈출 반복 타이머 */
  readonly every: (fn: () => void, ms: number) => void;
  /** 단계를 떠날 때 지울 한 번 타이머 */
  readonly later: (fn: () => void, ms: number) => void;
  /** 단계를 떠날 때 할 일 (구독 끊기·마이크 닫기·fn 확인 모드 끝내기) */
  readonly onLeave: (fn: () => void) => void;
}

export const primaryBtn = (label: string, onclick: () => void, disabled = false): Action => ({ label, onclick, disabled });
export const quietBtn = (label: string, onclick: () => void): Action => ({ label, onclick });
