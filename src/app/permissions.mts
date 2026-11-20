// ── 권한 확인 / 요청 ─────────────────────────────────────────────────────
// src/main.js에서 옮김 (결정 70). 권한 상태 읽기(permissionStatus)와 권한 도우미 실행(runPermissionsHelper)은 녹음 시작·창 띄우기도
// 쓰므로 본체에 남고 ctx로 받는다. 시스템 설정 창 열기는 여기서만 써서 같이 옮겼다.
// perm:request·perm:openSettings는 예전 main.js에서 처음 설정(온보딩) 구역 사이에 있었지만 권한 일이라 여기로.
import type { Ipc } from './ipc.mjs';

const SETTINGS_PANE = {
  microphone: 'Privacy_Microphone',
  inputMonitoring: 'Privacy_ListenEvent',
  systemAudio: 'Privacy_AudioCapture',
  accessibility: 'Privacy_Accessibility',
  files: 'Privacy_FilesAndFolders',
};
type PaneKind = keyof typeof SETTINGS_PANE;

// granted | denied | not-determined | restricted | unknown | unsupported
export interface PermissionStatus {
  microphone: string;
  inputMonitoring: string;
  systemAudio: string;
  accessibility: string;
}

export interface PermissionsContext {
  permissionStatus: () => Promise<PermissionStatus>; // 입력 모니터링이 허용돼 있으면 fn 감지도 시작한다
  runPermissionsHelper: (args: string[]) => Promise<string | null>;
  fnUsageWarning: () => string | null;
  systemPreferences: { askForMediaAccess(mediaType: 'microphone'): Promise<boolean> };
  shell: { openExternal(url: string): unknown };
}

export function registerPermissions(ipc: Ipc, ctx: PermissionsContext): void {
  function openPrivacySettings(kind: unknown) {
    // macOS 13부터의 주소. 예전 com.apple.preference.security?… 는 macOS 26에서 아무 창도 열지 않는다
    ctx.shell.openExternal(`x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${SETTINGS_PANE[kind as PaneKind]}`);
  }

  ipc.handle('perm:status', ctx.permissionStatus);
  // 🌐(fn) 키가 다른 동작(입력 소스 변경·이모지·받아쓰기)과 겹치는지
  ipc.handle('perm:fnKey', () => ctx.fnUsageWarning());
  ipc.on('perm:openKeyboard', () => ctx.shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension'));
  ipc.handle('perm:request', async (_e, kind) => {
    const before = (await ctx.permissionStatus())[kind as keyof PermissionStatus];
    if (kind === 'microphone' && before === 'not-determined') await ctx.systemPreferences.askForMediaAccess('microphone');
    else if (kind === 'inputMonitoring' && before !== 'granted') {
      await ctx.runPermissionsHelper(['request', 'input']); // 시스템 설정 목록에 앱을 추가
      openPrivacySettings(kind); // 입력 모니터링은 사용자가 직접 켜야 한다
    } else if (kind === 'accessibility' && before !== 'granted') {
      await ctx.runPermissionsHelper(['request', 'accessibility']); // 시스템 설정 목록에 앱을 추가
      openPrivacySettings(kind);
    } else if (kind === 'systemAudio' && before === 'unknown') await ctx.runPermissionsHelper(['request', 'audio']);
    else if (before !== 'granted') openPrivacySettings(kind);
    return ctx.permissionStatus();
  });
  ipc.on('perm:openSettings', (_e, kind) => openPrivacySettings(kind));
}
