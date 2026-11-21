// macOS: 권한 도우미(native/permissions) 실행과 시스템 설정 창 주소. src/main.js runPermissionsHelper와
// src/app/permissions.mts의 주소를 그대로 옮겼다 (결정 78). 권한 처리기(perm:*)와 Electron의 systemPreferences·shell은 그대로다.
import { execFile } from 'node:child_process';
import type { Permissions } from '../types.mjs';

const SETTINGS_PANE = {
  microphone: 'Privacy_Microphone',
  inputMonitoring: 'Privacy_ListenEvent',
  systemAudio: 'Privacy_AudioCapture',
  accessibility: 'Privacy_Accessibility',
  files: 'Privacy_FilesAndFolders',
};
type PaneKind = keyof typeof SETTINGS_PANE;

export const permissions: Permissions = {
  kinds: ['microphone', 'inputMonitoring', 'systemAudio', 'accessibility'],
  runHelper(helperBin, args) {
    return new Promise((resolve) => {
      execFile(helperBin, args, { timeout: 130000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
    });
  },
  // macOS 13부터의 주소. 예전 com.apple.preference.security?… 는 macOS 26에서 아무 창도 열지 않는다.
  // 모르는 kind도 예전처럼 주소를 만든다(끝이 ?undefined) — 처리기 시험이 그 모양을 본다
  privacyPaneUrl(kind) {
    return `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${SETTINGS_PANE[kind as PaneKind]}`;
  },
  keyboardSettingsUrl() {
    return 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension';
  },
};
