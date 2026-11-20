// 설정 창 틀: 탭 고르기·열기·닫기, 칸을 열 때 그 칸을 새로 읽기, '처음 설정 다시 보기'.
// 열 때 새로 읽는 일은 그 칸 역할의 명령으로만 부른다 (권한 그리기, 엔진 목록 그리기, 사용량 읽기, 계정·토큰 그리기).
import type { AccountsRole } from './accounts.ts';
import type { CleanupRole } from './cleanup.ts';
import type { PermissionsRole } from './permissions.ts';
import type { SetupRole } from './setup.ts';
import type { SettingsCtx, SettingsDeps } from './state.ts';

export interface DialogRole {
  readonly open: (sec?: string) => void;
  /** 탭·닫기·바깥 누르기·여는 버튼·'다시 보기'를 붙인다 */
  readonly wire: () => void;
}

export function createDialog(
  ctx: SettingsCtx,
  { closePalette, rerunOnboarding }: Pick<SettingsDeps, 'closePalette' | 'rerunOnboarding'>,
  sections: { permissions: Pick<PermissionsRole, 'render'>; setup: Pick<SetupRole, 'render'>; cleanup: Pick<CleanupRole, 'loadUsage'>; accounts: Pick<AccountsRole, 'render'> },
): DialogRole {
  const { api, settingsStore, issues, dialog } = ctx;
  const renderPerms = () => sections.permissions.render();
  const renderSetup = sections.setup.render;
  const loadUsage = () => sections.cleanup.loadUsage();
  const renderConnections = () => sections.accounts.render();

  // ── 설정 ────────────────────────────────────────────────────────────────
  function openSettings(sec = 'general') {
    closePalette();
    for (const tab of document.querySelectorAll<HTMLElement>('.set-tab')) tab.setAttribute('aria-current', String(tab.dataset.sec === sec));
    for (const s of document.querySelectorAll<HTMLElement>('.set-sec')) s.hidden = s.dataset.sec !== sec;
    if (!dialog.open) {
      dialog.showModal();
      (document.activeElement as HTMLElement | null)?.blur(); // 열자마자 첫 탭에 포커스 테두리가 그려지지 않게
    }
    if (sec === 'perms') renderPerms();
    if (sec === 'engine') api.setupStatus().then(renderSetup);
    if (sec === 'cleanup') settingsStore.refreshProviders(true).then(() => loadUsage());
    if (sec === 'accounts') {
      for (const r of dialog.querySelectorAll<HTMLElement>('[data-result]')) r.textContent = '';
      renderConnections();
    }
  }

  return {
    open: openSettings,
    wire: () => {
      for (const tab of document.querySelectorAll<HTMLElement>('.set-tab')) tab.onclick = () => openSettings(tab.dataset.sec);
      document.getElementById('settingsClose')!.onclick = () => dialog.close();
      dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
      document.getElementById('openSettings')!.onclick = () => openSettings();
      document.getElementById('enginesBtn')!.onclick = () => {
        const bad = issues.getSnapshot().entries.map(([, i]) => i).find((i) => i.sec);
        openSettings(bad?.sec ?? 'engine');
      };
      document.getElementById('rerunOnboarding')!.onclick = () => {
        dialog.close();
        return rerunOnboarding();
      };
    },
  };
}
