// 처음 설정(온보딩): 앱을 처음 열면 본 화면 대신 이 화면이 뜨고, 필요한 설정을 모두 마친 뒤 본 화면으로 넘어간다.
// 흐름은 Wispr Flow를 따랐다: 한 단계씩, 권한은 카드 하나씩(1초마다 다시 확인, 돌아오면 바로 확인),
// 마이크 레벨 확인, fn 키 확인, 실제 입력칸에서 연습. 어디까지 했는지 저장해 두고 다시 열면 이어서 한다.
//
// 이 파일은 엮기만 한다: 단계 이동·저장·정리는 flow.ts, 단계마다 한 파일(welcome·permissions·token·engine·account·mic·fnkey·practice·done).
// 단계 모듈은 단계에 들어올 때 불리는 함수다 — 그 단계의 상태는 그 호출 안 지역 변수에 들고, 타이머·구독·마이크는 flow에 맡겨 떠날 때 정리한다.
// 여러 단계가 같이 쓰는 것은 state.ts의 StepCtx로만 (docs/renderer-architecture.md)
import { account } from './account.ts';
import { done } from './done.ts';
import { engine } from './engine.ts';
import { createFlow } from './flow.ts';
import { fnkey } from './fnkey.ts';
import { mic } from './mic.ts';
import { permissions } from './permissions.ts';
import { practice } from './practice.ts';
import { STEPS, type OnboardingCtx, type SavedOnboarding, type StepCtx } from './state.ts';
import { token } from './token.ts';
import { onboardingRenderer } from './ui.tsx';
import type { StepId } from './view.ts';
import { welcome } from './welcome.ts';

export type { OnboardingCtx } from './state.ts';

// 둘 다 startOnboarding 한 번보다 오래 산다 — 설정에서 '다시 하기'로 새로 시작해도 이어져야 해서 모듈에 둔다
let stepInstance = 0; // 단계 그림의 세대: 단계에 들어올 때마다 하나씩 (ui.tsx가 key로 써서 새 단계는 새 부품)
let stopRunning: (() => void) | null = null; // 하던 처음 설정 — 설정에서 '다시 하기'로 새로 시작하면 앞의 타이머·마이크·구독을 먼저 정리한다

const VIEWS: Record<StepId, (ctx: StepCtx) => void | Promise<void>> = { welcome, permissions, token, engine, account, mic, fnkey, practice, done };

export function startOnboarding(ctx: OnboardingCtx, saved: SavedOnboarding) {
  const { api } = ctx;
  const root = document.getElementById('onboard')!;
  const show = onboardingRenderer(root);
  const uses = { dictation: true, meetings: true }; // 받아쓰기와 회의록은 늘 둘 다 쓴다 (고르지 않는다)
  const first: StepId = saved.step && STEPS.some((s) => s.id === saved.step) ? saved.step as StepId : 'welcome';
  const flow = createFlow({ api, uses, show, first, enter: (id) => void VIEWS[id](steps) });

  stopRunning?.();
  stopRunning = flow.stop;

  function finish() {
    flow.leave();
    stopRunning = null;
    api.onboardingSet({ completed: true, step: 'done', uses, completedAt: new Date() });
    root.hidden = true;
    document.querySelector<HTMLElement>('.shell')!.hidden = false;
    ctx.onDone(uses);
  }

  const steps: StepCtx = {
    ...ctx,
    uses,
    stepId: flow.stepId,
    instance: () => ++stepInstance,
    frame: flow.frame,
    next: flow.next,
    finish,
    every: flow.every,
    later: flow.later,
    onLeave: flow.onLeave,
  };

  document.querySelector<HTMLElement>('.shell')!.hidden = true;
  root.hidden = false;
  api.onboardingSet({ step: flow.stepId(), uses, completed: false });
  flow.render();
}
