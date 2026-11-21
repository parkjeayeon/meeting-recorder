// 시스템 소리 녹음 방식 고르기 (src/platform/system-audio.mts — 예전 main.js systemAudioCapability, 결정 78)
import { describe, expect, it } from 'vitest';
import { systemAudioFor } from './system-audio.mjs';
import { platformFor } from './index.mjs';

describe('systemAudioFor', () => {
  it.each([
    ['darwin', '12.7', 'unsupported'],
    ['darwin', '13.0', 'screen_capture_kit'],
    ['darwin', '14.3', 'screen_capture_kit'],
    ['darwin', '14.3.1', 'screen_capture_kit'],
    ['darwin', '14', 'screen_capture_kit'], // 부 버전이 없으면 14.0으로 (undefined >= 4는 거짓)
    ['darwin', '14.4', 'process_tap'],
    ['darwin', '14.10', 'process_tap'],
    ['darwin', '15', 'process_tap'],
    ['darwin', '15.0', 'process_tap'],
    ['darwin', '26.1', 'process_tap'],
    ['win32', '10.0.22631', 'wasapi_loopback'],
    ['linux', '6.8.0', 'unsupported'],
    ['freebsd', '14.0', 'unsupported'],
  ])('%s %s → %s', (os, version, want) => {
    expect(systemAudioFor(os, () => version)).toBe(want);
  });

  it('darwin이 아니면 버전을 묻지 않는다 (예전처럼 process.getSystemVersion을 부르지 않음)', () => {
    const asked: string[] = [];
    const v = () => {
      asked.push('v');
      return '15.0';
    };
    systemAudioFor('win32', v);
    systemAudioFor('linux', v);
    expect(asked).toEqual([]);
    systemAudioFor('darwin', v);
    expect(asked).toEqual(['v']);
  });

  it('플랫폼 구현을 거쳐도 같다 (win32·linux는 버전 없이)', () => {
    expect(platformFor('win32').systemAudio()).toBe('wasapi_loopback');
    expect(platformFor('linux').systemAudio()).toBe('unsupported');
  });
});
