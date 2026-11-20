import { primaryBtn, quietBtn, type StepCtx } from './state.ts';
import type { Control } from './view.ts';

const SAMPLE = '음, 내일 회의는 3시에, 아니 4시에 하는 걸로 정리해 주세요.';

// ── 8. 연습: 실제 입력칸에 받아쓰기 ────────────────────────────────
// 톡 누름 안내는 본체가 알리는 톡(ctx.tapListeners)으로. 10초에 입력칸 밖이면 '먼저 클릭' 안내, 15초에 '건너뛰기'.
export function practice(ctx: StepCtx) {
  const { frame, next, later, onLeave } = ctx;
  const instance = ctx.instance();
  let done = false;
  let hint = '';
  let skippable = false;
  const area: Control<HTMLTextAreaElement> = { current: null };
  const onInput = () => {
    if (!done && area.current!.value.trim()) {
      done = true;
      draw();
    }
  };
  const draw = () => {
    const val = area.current?.value ?? '';
    frame({
      instance,
      title: done ? '잘 됩니다!' : '직접 말해 보세요',
      lead: done ? '말한 내용이 다듬어져 들어왔습니다. 다른 앱에서도 똑같이 쓰면 됩니다.' : '입력칸을 클릭하고 fn을 꾹 누른 채 아래 문장을 읽은 다음 떼세요. 군말과 고친 말이 정리되어 들어옵니다.',
      body: { kind: 'practice', area, input: onInput, sample: SAMPLE, done, hint },
      primary: primaryBtn('계속', next, !done),
      secondary: !done && skippable && quietBtn('건너뛰기', next),
    });
    area.current!.value = val;
    if (!done) setTimeout(() => area.current!.focus(), 0);
  };
  draw();
  const onTap = () => {
    if (ctx.stepId() !== 'practice' || done) return;
    hint = '톡 누르지 말고, 꾹 누른 채로 말한 뒤 떼세요.';
    draw();
  };
  ctx.tapListeners.add(onTap);
  onLeave(() => ctx.tapListeners.delete(onTap));
  later(() => {
    if (!done && document.activeElement !== area.current) {
      hint = '입력칸을 먼저 클릭하세요.';
      draw();
    }
  }, 10000);
  later(() => {
    skippable = true;
    if (!done) draw();
  }, 15000);
}
