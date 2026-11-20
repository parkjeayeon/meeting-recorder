import { primaryBtn, quietBtn, type StepCtx } from './state.ts';
import type { Control, ResultView } from './view.ts';

// ── 3. (회의록) Hugging Face 토큰 ─────────────────────────────────
// 입력칸·결과 줄은 다시 그려도 같은 요소라(ui.tsx의 useRetainedRef) 확인 중에 고친 글·결과를 직접 쓴다.
export async function token(ctx: StepCtx) {
  const { api, toast, frame, next } = ctx;
  const instance = ctx.instance();
  const status = await api.tokenStatus();
  let ready = Boolean(status.hf.app || status.hf.cli);
  let message = ready ? (status.hf.app ? '앱에 저장된 토큰이 있습니다.' : '터미널에서 로그인한 토큰이 있습니다.') : '';
  let ok = ready;
  const input: Control<HTMLInputElement> = { current: null };
  const result: Control<HTMLParagraphElement> = { current: null };
  const initialResult: ResultView = { ref: result, className: `ob-result${ok ? ' ok' : ''}`, text: message };
  const verify = async () => {
    result.current!.className = 'ob-result';
    result.current!.textContent = '확인 중…';
    const r = await api.verifyToken('hf');
    ok = r.ok;
    result.current!.className = `ob-result ${r.ok ? 'ok' : 'bad'}`;
    result.current!.textContent = r.message;
    draw();
  };
  const save = async () => {
    if (!input.current!.value.trim()) return input.current!.focus();
    await api.saveToken('hf', input.current!.value.trim());
    ready = true; // 저장했으니 이제 토큰이 있다 — 확인에 실패하면 '다시 확인'을 보인다
    input.current!.value = '';
    verify();
  };
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.isComposing) save();
  };
  const draw = () => frame({
    instance,
    title: '화자 구분 준비',
    lead: '누가 말했는지 나누는 pyannote 모델은 Hugging Face에서 약관에 동의한 계정만 받을 수 있습니다. 토큰은 키체인으로 암호화해 저장합니다.',
    body: {
      kind: 'token', input, result: initialResult, keydown, save, verify, check: ready && !ok,
      openModel: () => api.openExternal('https://huggingface.co/pyannote/speaker-diarization-community-1'),
      openTokens: () => api.openExternal('https://huggingface.co/settings/tokens'),
    },
    primary: primaryBtn('계속', next, !ok),
    secondary: !ok && quietBtn('나중에 하기', () => {
      toast('화자 구분 없이 계속합니다', '회의록은 만들어지지만 누가 말했는지는 나뉘지 않습니다. 설정 › 계정·토큰에서 넣을 수 있습니다.');
      next();
    }),
  });
  draw();
}
