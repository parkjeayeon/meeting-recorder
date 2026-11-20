// 단계 이동·저장·정리·화면 틀: 지금 단계(stepId)와 떠날 때 정리할 것(cleanup)의 주인.
// 다음·뒤로는 떠날 단계의 타이머·구독을 먼저 정리하고, 단계를 저장하고(기다리지 않는다), 새 단계를 그린다.
// 새로 시작한 처음 설정에 밀려나면(stop) 정리하고 그 뒤로 늦게 온 응답은 그리지 않는다.
import type { RecorderApi } from '../../../shared/api/index.ts';
import { SECTIONS, STEPS, type Uses } from './state.ts';
import type { Frame, OnboardingView, StepId } from './view.ts';

export interface FlowDeps {
  readonly api: Pick<RecorderApi, 'onboardingSet'>;
  readonly uses: Uses;
  readonly show: (view: OnboardingView) => void;
  /** 처음 단계 (저장된 것 — 없는 단계면 controller가 이미 'welcome'으로) */
  readonly first: StepId;
  /** 이 단계의 화면을 그린다 (단계 모듈 표는 controller) */
  readonly enter: (id: StepId) => void;
}

export interface FlowRole {
  readonly stepId: () => StepId;
  /** 지금 쓰는 것에 맞는 단계 목록 */
  readonly steps: () => typeof STEPS;
  readonly leave: () => void;
  /** 새 처음 설정에 밀려남 — 정리하고, 그 뒤 frame은 그리지 않는다 */
  readonly stop: () => void;
  readonly go: (id: StepId) => void;
  readonly next: () => void;
  readonly back: () => void;
  readonly every: (fn: () => void, ms: number) => void;
  readonly later: (fn: () => void, ms: number) => void;
  readonly onLeave: (fn: () => void) => void;
  readonly frame: (view: Frame) => void;
  /** 지금 단계를 그린다 (쓰지 않는 단계면 처음으로) */
  readonly render: () => void;
}

export function createFlow({ api, uses, show, first, enter }: FlowDeps): FlowRole {
  let stepId: StepId = first;
  let cleanup: (() => void)[] = []; // 단계를 떠날 때 정리할 것 (타이머, 마이크, fn 확인 모드)

  const steps = () => STEPS.filter((s) => !s.when || s.when(uses));
  const leave = () => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
  };
  let stopped = false; // 새로 시작한 처음 설정에 밀려났으면 늦게 온 응답으로 그리지 않는다
  const go = (id: StepId) => {
    leave();
    stepId = id;
    api.onboardingSet({ step: id, uses });
    render();
  };
  const next = () => {
    const list = steps();
    const i = list.findIndex((s) => s.id === stepId);
    if (list[i + 1]) go(list[i + 1]!.id);
  };
  const back = () => {
    const list = steps();
    const i = list.findIndex((s) => s.id === stepId);
    if (i > 0) go(list[i - 1]!.id);
  };
  const every = (fn: () => void, ms: number) => {
    const t = setInterval(fn, ms);
    cleanup.push(() => clearInterval(t));
  };
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    cleanup.push(() => clearTimeout(t));
  };

  // 화면 틀: 위 진행 표시 · 왼쪽 설명과 버튼 · 오른쪽 그림 패널
  function frame(view: Frame) {
    if (stopped) return;
    const current = steps().find((s) => s.id === stepId)!;
    show({ ...view, sections: SECTIONS, at: SECTIONS.indexOf(current.section), back: view.canBack !== false && stepId !== 'welcome' ? back : null });
  }

  function render() {
    if (!steps().some((s) => s.id === stepId)) stepId = 'welcome';
    enter(stepId);
  }

  return {
    stepId: () => stepId,
    steps,
    leave,
    stop: () => {
      stopped = true;
      leave();
    },
    go,
    next,
    back,
    every,
    later,
    onLeave: (fn) => void cleanup.push(fn),
    frame,
    render,
  };
}
