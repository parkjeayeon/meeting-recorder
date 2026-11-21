// 시스템 오디오 캡처 경로 (Wispr Flow와 같은 분기). src/main.js systemAudioCapability에 있던 것 그대로 (결정 78).
// macOS 14.4+ : Core Audio Process Tap / 13~14.3 : ScreenCaptureKit / 그 이하 : 미지원. Windows는 WASAPI loopback, 그 밖은 미지원.
// OS 이름과 OS 버전을 받는 순수 함수라 어느 OS에서나 시험한다. 버전은 darwin일 때만 읽는다 (예전처럼 다른 OS에서는 묻지 않는다)
import type { SystemAudioCapability } from './types.mjs';

export function systemAudioFor(os: string, version: () => string): SystemAudioCapability {
  if (os === 'win32') return 'wasapi_loopback';
  if (os !== 'darwin') return 'unsupported';
  const [major, minor] = version().split('.').map(Number) as [number, number];
  if (major < 13) return 'unsupported';
  if (major > 14 || (major === 14 && minor >= 4)) return 'process_tap';
  return 'screen_capture_kit';
}
