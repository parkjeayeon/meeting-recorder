import { primaryBtn, type StepCtx } from './state.ts';

// ── 1. 환영: 무엇에 쓸지 고른다 ─────────────────────────────────────
export function welcome(ctx: StepCtx) {
  const { frame, next } = ctx;
  const instance = ctx.instance();
  frame({
    instance,
    title: 'Meeting Recorder를 시작합니다',
    lead: '두 가지를 합니다. 몇 단계만 설정하면 바로 쓸 수 있습니다.',
    body: { kind: 'welcome' },
    primary: primaryBtn('시작하기', next),
    canBack: false,
  });
}
