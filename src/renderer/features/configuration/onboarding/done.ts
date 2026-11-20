import type { SetupComponent } from '../settings/types.ts';
import { primaryBtn, type StepCtx } from './state.ts';

// ── 9. 완료 ────────────────────────────────────────────────────
export async function done(ctx: StepCtx) {
  const { api, uses, frame, finish } = ctx;
  const instance = ctx.instance();
  const list: SetupComponent[] = await api.setupStatus();
  const perms = await api.permStatus();
  const item = (good: boolean | undefined, title: string, text: string) => ({ good, title, text });
  const has = (id: string) => list.find((c) => c.id === id)?.installed;
  frame({
    instance,
    title: '준비됐습니다',
    lead: '빠진 것은 설정에서 언제든 마저 할 수 있습니다.',
    body: {
      kind: 'done',
      items: [
        ...(uses.dictation ? [item(perms.microphone === 'granted' && perms.inputMonitoring === 'granted' && perms.accessibility === 'granted' && has('turbo'), '받아쓰기', 'fn을 꾹 누른 채 말하면 커서 위치에 입력')] : []),
        ...(uses.meetings ? [item(perms.microphone === 'granted' && has('engine'), '회의 녹음', '위쪽 회의 녹음 버튼이나 화면 왼쪽 독으로 시작')] : []),
        ...(uses.meetings ? [item(has('diarize'), '화자 구분', has('diarize') ? '준비됨' : '설정 › 엔진·계정·토큰에서 마저 설치')] : []),
      ],
    },
    primary: primaryBtn('시작하기', finish),
  });
}
