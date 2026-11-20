import type { ProviderInfo } from '../settings/types.ts';
import { primaryBtn, quietBtn, type StepCtx } from './state.ts';
import type { Control, ResultView } from './view.ts';

// ── 5. 다듬기 계정 ──────────────────────────────────────────────
// '다시 확인'은 단계를 떠나지 않고 이 단계를 새 세대로 다시 그린다 (정리할 타이머·구독이 없다).
export async function account(ctx: StepCtx) {
  const { api, frame, next } = ctx;
  const instance = ctx.instance();
  const p: Record<string, ProviderInfo> = await api.providers({ fresh: true });
  const names = [['claude-code', 'Claude Code'], ['codex', 'Codex']] as const;
  const logged = names.filter(([id]) => p[id]?.loggedIn);
  const keyInput: Control<HTMLInputElement> = { current: null };
  const result: Control<HTMLParagraphElement> = { current: null };
  const initialResult: ResultView = { ref: result, className: 'ob-result', text: '' };
  const saveKey = async () => {
    if (!keyInput.current!.value.trim()) return keyInput.current!.focus();
    await api.saveToken('anthropic', keyInput.current!.value.trim());
    keyInput.current!.value = '';
    result.current!.textContent = '확인 중…';
    const r = await api.verifyToken('anthropic');
    result.current!.className = `ob-result ${r.ok ? 'ok' : 'bad'}`;
    result.current!.textContent = r.message;
  };
  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.isComposing) saveKey();
  };
  frame({
    instance,
    title: '다듬기와 회의록에 쓸 계정',
    lead: '군말을 지우고 문장을 다듬는 일과 회의록 작성은 이미 로그인된 Claude Code·Codex 구독을 그대로 씁니다. 별도 결제가 없습니다.',
    body: {
      kind: 'account',
      items: names.map(([id, name]) => {
        const info = p[id];
        const ok = info?.loggedIn;
        return { good: ok, title: name, text: !info?.installed ? '설치되어 있지 않음' : ok ? `로그인됨${info.account ? ` · ${info.account}` : ''}` : `로그인 필요 · 터미널에서 ${id === 'codex' ? 'codex login' : 'claude'} 실행` };
      }),
      showKey: !logged.length, input: keyInput, result: initialResult, keydown, save: saveKey,
    },
    primary: primaryBtn(logged.length ? '계속' : '계속 (지금은 다듬기 없이)', next),
    secondary: { ...quietBtn('다시 확인', () => account(ctx)), icon: 'i-redo' },
  });
}
