import { primaryBtn, quietBtn, type StepCtx } from './state.ts';

// ── 7. fn 키 확인: 누르면 키가 색으로 바뀐다 (이 단계에서는 녹음하지 않는다) ──
// 본체의 fn 확인 모드는 들어올 때 켜고 떠날 때 끈다. 12초 안에 누르지 않으면 '건너뛰기'를 보인다.
export function fnkey(ctx: StepCtx) {
  const { api, frame, next, later, onLeave } = ctx;
  const instance = ctx.instance();
  let pressed = false;
  let down = false;
  let quiet = false;
  const draw = () => frame({
    instance,
    title: 'fn 키를 눌러 보세요',
    lead: '키보드 왼쪽 아래의 🌐 fn 키입니다. 누르는 동안 오른쪽 키가 주홍색으로 바뀝니다. 이 단계에서는 녹음하지 않습니다.',
    body: { kind: 'fnkey', pressed, down, quiet, request: () => api.permRequest('inputMonitoring') },
    primary: primaryBtn(pressed ? '계속' : 'fn을 눌러 보세요…', next, !pressed),
    secondary: !pressed && quiet && quietBtn('건너뛰기', next),
  });
  api.onboardingFnTest(true);
  onLeave(() => api.onboardingFnTest(false));
  const onFn = ({ down: d }: { down: boolean }) => {
    if (ctx.stepId() !== 'fnkey') return;
    down = d;
    if (d) pressed = true;
    draw();
  };
  ctx.fnListeners.add(onFn);
  onLeave(() => ctx.fnListeners.delete(onFn));
  draw();
  later(() => {
    quiet = true;
    if (!pressed) draw();
  }, 12000);
}
