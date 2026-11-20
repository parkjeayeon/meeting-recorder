// 설정 › 계정·토큰 칸: 토큰 묶음(Hugging Face·Anthropic)마다 보기·저장·확인·지우기, 로그인된 계정 줄, 바깥 링크.
// 그릴 때 공용 계정 정보(settingsStore.refreshProviders)도 새로 읽어 다듬기 칸·왼쪽 아래 다듬기 표시가 같이 바뀐다.
import { settingsRegionRenderer, SettingsAccounts } from './regions.tsx';
import type { SettingsCtx } from './state.ts';
import type { TokenKind, TokenSource } from './types.ts';

export interface AccountsRole {
  readonly render: (status?: Record<TokenKind, TokenSource>) => Promise<void>;
  readonly wire: () => void;
}

export function createAccounts(ctx: SettingsCtx): AccountsRole {
  const { api, settingsStore, dialog } = ctx;
  const accountsRegion = settingsRegionRenderer(document.getElementById('connAccounts')!, SettingsAccounts);

  // ── 계정·토큰 ───────────────────────────────────────────────────────────
  const SOURCE_TEXT = {
    hf: (s: TokenSource) => (s.app ? '앱에 저장됨' : s.cli ? '터미널 로그인 토큰 사용 중' : '없음'),
    anthropic: (s: TokenSource) => (s.app ? '앱에 저장됨' : s.env ? '환경 변수 사용 중' : '없음'),
  };

  async function renderConnections(status?: Record<TokenKind, TokenSource>) {
    status ??= await api.tokenStatus();
    for (const block of dialog.querySelectorAll<HTMLElement>('.conn-block[data-kind]')) {
      const kind = block.dataset.kind as TokenKind;
      const s = status![kind];
      const has = s.app || s.cli || s.env;
      const pill = block.querySelector<HTMLElement>('[data-state]')!;
      pill.textContent = SOURCE_TEXT[kind](s);
      pill.className = `pill ${has ? 'ok' : kind === 'hf' && settingsStore.getSnapshot().saved?.diarize ? 'bad' : ''}`;
      block.querySelector<HTMLButtonElement>('[data-clear]')!.disabled = !s.app;
      block.querySelector<HTMLButtonElement>('[data-verify]')!.disabled = !has;
    }
    await settingsStore.refreshProviders(true); // 다듬기 칸·왼쪽 아래 다듬기 표시도 같이 바뀌게
    const p = settingsStore.getSnapshot().providers!;
    accountsRegion.render(([['claude-code', 'Claude Code'], ['codex', 'Codex']] as const).map(([id, name]) => {
      const info = p[id];
      return { name, className: info.loggedIn ? 'ok' : '', text: !info.installed ? '설치 안 됨' : info.loggedIn ? `로그인됨${info.account ? ` · ${info.account}` : ''}` : '로그인 안 됨' };
    }));
  }

  return {
    render: renderConnections,
    wire: () => {
      for (const block of dialog.querySelectorAll<HTMLElement>('.conn-block[data-kind]')) {
        const kind = block.dataset.kind as TokenKind;
        const input = block.querySelector<HTMLInputElement>('[data-input]')!;
        const result = block.querySelector<HTMLElement>('[data-result]')!;
        const show = (ok: boolean, text: string) => {
          result.textContent = text;
          result.className = `result ${ok ? 'ok' : 'bad'}`;
        };
        block.querySelector<HTMLButtonElement>('[data-toggle]')!.onclick = (e) => {
          input.type = input.type === 'password' ? 'text' : 'password';
          (e.target as HTMLElement).textContent = input.type === 'password' ? '보기' : '숨기기';
        };
        const save = async () => {
          if (!input.value.trim()) return input.focus();
          await renderConnections(await api.saveToken(kind, input.value));
          input.value = '';
          input.type = 'password';
          block.querySelector<HTMLButtonElement>('[data-toggle]')!.textContent = '보기';
          show(true, '저장했습니다. 확인 중…');
          const r = await api.verifyToken(kind);
          show(r.ok, r.message);
          await settingsStore.refresh();
          settingsStore.refreshProviders(true);
        };
        block.querySelector<HTMLButtonElement>('[data-save]')!.onclick = save;
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && !e.isComposing) save();
        };
        block.querySelector<HTMLButtonElement>('[data-verify]')!.onclick = async () => {
          show(true, '확인 중…');
          const r = await api.verifyToken(kind);
          show(r.ok, r.message);
        };
        block.querySelector<HTMLButtonElement>('[data-clear]')!.onclick = async () => {
          await renderConnections(await api.clearToken(kind));
          show(true, '지웠습니다.');
          await settingsStore.refresh();
          settingsStore.refreshProviders(true);
        };
      }
      for (const b of dialog.querySelectorAll<HTMLElement>('[data-link]')) b.onclick = () => api.openExternal(b.dataset.link);
      document.getElementById('connRefresh')!.onclick = () => renderConnections();
    },
  };
}
