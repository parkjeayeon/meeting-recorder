// macOS가 아닌 OS의 대답 (src/platform/unsupported.mts, 결정 78) — Windows 동작을 지어내지 않고, macOS 도구를 부르지 않는다
import { describe, expect, it } from 'vitest';
import { darwin } from './darwin/index.mjs';
import { platformFor } from './index.mjs';
import { createUnsupported } from './unsupported.mjs';

describe.each(['win32', 'linux'] as const)('%s', (os) => {
  const p = platformFor(os);

  it('macOS 구현이 아니다', () => {
    expect(p).not.toBe(darwin);
    expect(p.os).toBe(os);
  });

  it('고아 프로세스: 찾지 않는다', () => {
    expect(p.processes.orphans()).toEqual([]);
    expect(p.processes.commandOf(process.pid)).toBeNull();
  });

  it('키: 이름은 fn, 설정 경고 없음', () => {
    expect(p.keyListener.keyName).toBe('fn');
    expect(p.keyListener.usageWarning()).toBeNull();
  });

  it('붙여넣기: 도우미를 띄우지 않고 실패', async () => {
    expect(await p.paster.sendPaste('/nonexistent/permissions')).toBe('failed');
  });

  it('권한: 도우미 null, 열 설정 창 없음', async () => {
    expect(p.permissions.kinds).toEqual([]);
    expect(await p.permissions.runHelper('/nonexistent/permissions', ['status'])).toBeNull();
    expect(p.permissions.privacyPaneUrl('microphone')).toBeNull();
    expect(p.permissions.keyboardSettingsUrl()).toBeNull();
  });

  it('소리 변환·정보: 던진다 (부르는 쪽은 명령 실패와 같은 길로 다룬다)', () => {
    expect(() => p.audio.convert('a', 'b', { format: 'wav', rate: 16000, channels: 1 })).toThrow(`이 OS(${os})에서는 지원하지 않습니다`);
    expect(() => p.audio.info('a')).toThrow('지원하지 않습니다');
  });

  it('자리: 아는 곳 없음, uv 내려받기는 던진다', () => {
    expect(p.paths.whisperServer).toEqual([]);
    expect(p.paths.brew).toEqual([]);
    expect(p.paths.cli('claude-code')).toEqual([]);
    expect(p.paths.cli('codex')).toEqual([]);
    expect(() => p.paths.uvArchive('x86_64')).toThrow('지원하지 않습니다');
  });

  it('샌드박스: 감싸지 않고 그대로 (core/sandbox.mts가 darwin이 아니면 그렇게 한다)', () => {
    if (process.platform !== 'darwin') expect(p.sandbox.wrap('/bin/echo', ['hi'], { network: 'none' })).toEqual(['/bin/echo', ['hi']]);
    expect(p.sandbox.wrap).toBe(darwin.sandbox.wrap);
  });

  it('본체 잡일: 하지 않음, 마이크는 granted로', () => {
    expect(p.shell).toEqual({ selftestSound: null, hideAppBeforeRepaste: false, overlayWindow: {}, devDockIcon: false, askMicAtLaunch: false, micAccessFromSystem: false });
  });
});

describe('시스템 소리', () => {
  it('win32만 wasapi_loopback, 나머지는 unsupported', () => {
    expect(createUnsupported('win32').systemAudio()).toBe('wasapi_loopback');
    expect(createUnsupported('linux').systemAudio()).toBe('unsupported');
    expect(createUnsupported('freebsd').systemAudio()).toBe('unsupported');
  });
});
