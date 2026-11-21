// ── 시스템 오디오 캡처 경로와 권한 상태 읽기 ──────────────────────────────────
// src/main.js에서 옮김 (결정 70). 시스템 소리 방식(capability)은 본체가 시작할 때 한 번 고르고(src/platform/system-audio.mts),
// 여기서는 그 방식에 맞는 Chromium 스위치·화면 공유 처리기와 권한 상태 읽기를 한다. Electron은 타입만 — 객체는 본체가 넘긴다.
import type * as Electron from 'electron';
import { platform, type SystemAudioCapability } from '../platform/index.mjs';
import type { PermissionStatus } from './permissions.mjs';

// macOS 14.4+ : Core Audio Process Tap / 13~14.3 : ScreenCaptureKit / 그 이하 : 미지원 (Wispr Flow와 같은 분기)
// 앱이 준비되기 전(불러올 때)에 붙여야 한다
export function appendCaptureSwitches(commandLine: Pick<Electron.CommandLine, 'appendSwitch'>, capability: SystemAudioCapability): void {
  if (capability === 'process_tap') {
    commandLine.appendSwitch('enable-features', 'MacCatapSystemAudioLoopbackCapture,MacLoopbackAudioForScreenShare');
  } else if (capability === 'screen_capture_kit') {
    commandLine.appendSwitch('enable-features', 'MacSckSystemAudioLoopbackOverride,MacLoopbackAudioForScreenShare');
  }
}

// 창의 getDisplayMedia가 시스템 소리를 받게 한다
export function installDisplayMediaHandler(
  session: Pick<Electron.Session, 'setDisplayMediaRequestHandler'>,
  desktopCapturer: Pick<typeof Electron.desktopCapturer, 'getSources'>,
  capability: SystemAudioCapability,
): void {
  session.setDisplayMediaRequestHandler((_request, callback) => {
    if (capability === 'wasapi_loopback') {
      callback({ audio: 'loopback' });
      return;
    }
    if (capability === 'process_tap') {
      // Wispr Flow와 동일: Core Audio Tap으로 모든 출력 장치의 소리를 받는다
      // Electron 타입의 audio는 'loopback' · 'loopbackWithMute' · WebFrameMain뿐이지만 Chromium은 장치 객체({ id, name })도 받는다
      const allDevices = { id: process.env.LOOPBACK_ID || 'loopbackAllDevices', name: 'All loopback devices' };
      callback({ audio: allDevices as unknown as Electron.WebFrameMain });
      return;
    }
    if (capability === 'screen_capture_kit') {
      desktopCapturer.getSources({ types: ['screen'] })
        .then((sources) => callback(sources.length ? { video: sources[0], audio: 'loopback' } : {}))
        .catch(() => callback({}));
      return;
    }
    callback({});
  });
}

export interface PermissionStatusContext {
  helperBin: () => string; // native/permissions (설치본은 resources)
  getMediaAccessStatus: (mediaType: 'microphone') => string; // systemPreferences
  capability: SystemAudioCapability;
  selftest: boolean;
  startFnListener: () => void;
}

export interface PermissionHelpers {
  runPermissionsHelper(args: string[]): Promise<string | null>;
  permissionStatus(): Promise<PermissionStatus>;
}

// 권한 상태 읽기와 권한 도우미는 녹음 시작(rec:start)·창 띄우기(init)·권한 처리기(permissions.mts)가 같이 쓴다
export function createPermissionHelpers(ctx: PermissionStatusContext): PermissionHelpers {
  function runPermissionsHelper(args: string[]): Promise<string | null> {
    return platform.permissions.runHelper(ctx.helperBin(), args);
  }

  async function permissionStatus(): Promise<PermissionStatus> {
    const native = JSON.parse((await runPermissionsHelper(['status'])) ?? '{}') as Partial<PermissionStatus>;
    const status = {
      microphone: ctx.getMediaAccessStatus('microphone'), // granted | denied | not-determined | restricted
      inputMonitoring: native.inputMonitoring ?? 'unknown',
      systemAudio: ctx.capability === 'unsupported' ? 'unsupported' : native.systemAudio ?? 'unknown',
      accessibility: native.accessibility ?? 'unknown',
    };
    // 입력 모니터링이 방금 허용됐으면 앱 재시작 없이 fn 감지를 시작
    if (status.inputMonitoring === 'granted' && !ctx.selftest) ctx.startFnListener();
    return status;
  }

  return { runPermissionsHelper, permissionStatus };
}
