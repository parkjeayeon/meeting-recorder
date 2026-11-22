// macOS 구현 (src/platform/darwin, 결정 78). 옮기기 전 코드에 있던 글자(명령·인자·주소·자리 목록)를 기대값으로 그대로 적어
// 옮긴 것이 한 글자도 다르지 않은지 본다. macOS 도구를 실제로 부르는 것은 기존 시험(audio·import-audio·compress)이 한다.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { darwin } from './darwin/index.mjs';
import { pasteResult } from './darwin/paster.mjs';
import { parseOrphans } from './darwin/processes.mjs';
import { platform, platformFor } from './index.mjs';

describe('고르기', () => {
  it('darwin이면 macOS 구현', () => {
    expect(platformFor('darwin')).toBe(darwin);
    if (process.platform === 'darwin') expect(platform).toBe(darwin);
  });
});

describe('processes: ps 출력 읽기', () => {
  // ps -axo pid=,ppid=,command= 의 모양 (pid는 오른쪽 맞춤이라 앞에 빈칸)
  const PS = [
    '    1     0 /sbin/launchd',
    '  412     1 /Users/u/audio/native/fn-listener',
    '  413   412 /Users/u/audio/native/fn-listener',
    ' 9001     1 /opt/homebrew/bin/whisper-server -m /Users/u/Library/Application Support/meeting-recorder/models/ggml.bin --host 127.0.0.1',
    '12345    77 /usr/bin/ssh-agent -l',
    'garbage line',
    '',
    ' 77 1   ',
  ].join('\n');

  it('부모가 1인 줄만, pid는 숫자로, 명령줄은 그대로', () => {
    expect(parseOrphans(PS)).toEqual([
      { pid: 412, command: '/Users/u/audio/native/fn-listener' },
      { pid: 9001, command: '/opt/homebrew/bin/whisper-server -m /Users/u/Library/Application Support/meeting-recorder/models/ggml.bin --host 127.0.0.1' },
      // ' 77 1   '은 줄 앞뒤를 먼저 깎아 ppid 뒤 빈칸이 없어져 맞지 않는다 (예전 정규식 그대로)
    ]);
  });

  it('ppid가 1로 시작하는 다른 수(12, 100)는 아니다', () => {
    expect(parseOrphans('  5    12 a\n  6   100 b\n  7     1 c')).toEqual([{ pid: 7, command: 'c' }]);
  });

  it.runIf(process.platform === 'darwin')('실제 ps: 없는 pid는 null, 이 프로세스는 명령줄', () => {
    const gone = spawnSync('/usr/bin/true').pid; // 이미 끝난 프로세스
    expect(darwin.processes.commandOf(gone)).toBeNull();
    expect(darwin.processes.commandOf(process.pid)).toEqual(expect.stringContaining('node'));
    expect(Array.isArray(darwin.processes.orphans())).toBe(true);
  });
});

describe('paster: 도우미 끝 코드 → 결과 (예전 dictation.js paste)', () => {
  it.each([
    [0, '', 'pasted'],
    [0, 'permission', 'pasted'], // 끝 코드 0이 먼저
    [1, 'error:permission\n', 'no-permission'],
    [1, 'no accessibility permission', 'no-permission'],
    [1, 'Permission', 'failed'], // 대소문자를 가린다 (예전 includes 그대로)
    [1, '', 'failed'],
    [2, 'other', 'failed'],
    [null, '', 'failed'], // 신호로 끝남
  ] as const)('code %s, stdout %j → %s', (code, out, want) => {
    expect(pasteResult(code, out)).toBe(want);
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-platform-paste-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const fake = (name: string, body: string) => {
    const bin = path.join(tmp, name);
    fs.writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return bin;
  };

  it.runIf(process.platform !== 'win32')('가짜 도우미로: 인자 paste를 넘기고, 끝 코드·출력으로 가른다', async () => {
    expect(await darwin.paster.sendPaste(fake('ok', '[ "$1" = paste ] && exit 0; exit 9'))).toBe('pasted');
    expect(await darwin.paster.sendPaste(fake('noperm', 'echo "error:permission"; exit 1'))).toBe('no-permission');
    expect(await darwin.paster.sendPaste(fake('fail', 'echo boom; exit 3'))).toBe('failed');
    // 도우미를 띄우지 못하면(없음·실행할 수 없음) 'exit'가 오지 않는다 → 멈추거나 죽지 않고 실패
    expect(await darwin.paster.sendPaste(path.join(os.tmpdir(), 'mr-no-such-permissions-helper'))).toBe('failed');
  });
});

describe('keyListener', () => {
  it('키 이름은 fn', () => {
    expect(darwin.keyListener.keyName).toBe('fn');
  });
  it.runIf(process.platform === 'darwin')('fn 키 설정 경고는 문자열이거나 null', () => {
    const w = darwin.keyListener.usageWarning();
    expect(w === null || w.startsWith('시스템 설정 › 키보드 › "🌐 키를 누르면"')).toBe(true);
  });
});

describe('permissions', () => {
  it('권한 네 가지', () => {
    expect(darwin.permissions.kinds).toEqual(['microphone', 'inputMonitoring', 'systemAudio', 'accessibility']);
  });
  it('시스템 설정 주소 (예전 src/app/permissions.mts의 글자 그대로)', () => {
    const pane = (p: string) => `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${p}`;
    expect(darwin.permissions.privacyPaneUrl('microphone')).toBe(pane('Privacy_Microphone'));
    expect(darwin.permissions.privacyPaneUrl('inputMonitoring')).toBe(pane('Privacy_ListenEvent'));
    expect(darwin.permissions.privacyPaneUrl('systemAudio')).toBe(pane('Privacy_AudioCapture'));
    expect(darwin.permissions.privacyPaneUrl('accessibility')).toBe(pane('Privacy_Accessibility'));
    expect(darwin.permissions.privacyPaneUrl('files')).toBe(pane('Privacy_FilesAndFolders'));
    expect(darwin.permissions.privacyPaneUrl('nope')).toBe(pane('undefined'));
    expect(darwin.permissions.keyboardSettingsUrl()).toBe('x-apple.systempreferences:com.apple.Keyboard-Settings.extension');
  });
  it.runIf(process.platform !== 'win32')('도우미 실행: 출력의 앞뒤 공백을 빼고, 실패면 null', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-platform-perm-'));
    try {
      const bin = path.join(tmp, 'perm');
      fs.writeFileSync(bin, '#!/bin/sh\n[ "$1" = status ] && { printf \'  {"a":1}\\n\\n\'; exit 0; }\nexit 1\n', { mode: 0o755 });
      expect(await darwin.permissions.runHelper(bin, ['status'])).toBe('{"a":1}');
      expect(await darwin.permissions.runHelper(bin, ['other'])).toBeNull();
      expect(await darwin.permissions.runHelper(path.join(tmp, 'missing'), ['status'])).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('audio: afconvert·afinfo 명령 (옮기기 전 세 곳의 글자 그대로)', () => {
  it('src/meeting/audio.mts decodeTo16k', () => {
    // 예전: execFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', src, tmp], …)
    expect(darwin.audio.convert('/a/in.m4a', '/a/out.wav.af.wav', { format: 'wav', rate: 16000, channels: 1 })).toEqual(['/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', '/a/in.m4a', '/a/out.wav.af.wav']]);
  });
  it('src/meeting/import-audio.mts importAudio (16k·48k)', () => {
    // 예전: run(AFCONVERT, ['-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', '1', file, out], …)
    for (const rate of [16000, 48000]) {
      expect(darwin.audio.convert('/x/rec.mp3', '/t/0.wav', { format: 'wav', rate, channels: 1 })).toEqual(['/usr/bin/afconvert', ['-f', 'WAVE', '-d', `LEI16@${rate}`, '-c', '1', '/x/rec.mp3', '/t/0.wav']]);
    }
  });
  it('src/meeting/compress.mts compressMeeting', () => {
    // 예전: run(AFCONVERT, ['-f', 'm4af', '-d', 'aac', '-b', String(BITRATE), wavPath, tmp]) — BITRATE 96000
    expect(darwin.audio.convert('/m/mic.wav', '/m/.mic.m4a.part', { format: 'm4a', codec: 'aac', bitrate: 96000 })).toEqual(['/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', '/m/mic.wav', '/m/.mic.m4a.part']]);
  });
  it('afinfo (import-audio probe·compress durationOf)', () => {
    expect(darwin.audio.info('/m/mic.wav')).toEqual(['/usr/bin/afinfo', ['/m/mic.wav']]);
  });
});

describe('paths (옮기기 전 목록 그대로, 순서도)', () => {
  it('whisper-server (dictation.js)', () => {
    expect(darwin.paths.whisperServer).toEqual(['/opt/homebrew/bin/whisper-server', '/usr/local/bin/whisper-server']);
  });
  it('Homebrew (setup.js BREW_CANDIDATES)', () => {
    expect(darwin.paths.brew).toEqual(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
  });
  it('Claude Code·Codex (llm/providers.mts)', () => {
    const home = os.homedir();
    expect(darwin.paths.cli('claude-code')).toEqual(['/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude')]);
    expect(darwin.paths.cli('codex')).toEqual(['/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(home, '.local/bin/codex')]);
  });
  it('uv 내려받기 (setup.js installDiarize)', () => {
    for (const arch of ['aarch64', 'x86_64']) {
      expect(darwin.paths.uvArchive(arch)).toEqual({
        url: `https://github.com/astral-sh/uv/releases/latest/download/uv-${arch}-apple-darwin.tar.gz`,
        dir: `uv-${arch}-apple-darwin`,
      });
    }
  });
});

describe('shell (예전 main.js의 darwin 분기)', () => {
  it('macOS에서 하던 것', () => {
    expect(darwin.shell).toEqual({
      selftestSound: ['afplay', ['/System/Library/Sounds/Submarine.aiff']],
      hideAppBeforeRepaste: true,
      overlayWindow: { type: 'panel' },
      devDockIcon: true,
      askMicAtLaunch: true,
      micAccessFromSystem: true,
    });
  });
});

describe('sandbox: core/sandbox.mts 그대로', async () => {
  const core = await import('../core/sandbox.mjs');
  it('같은 함수', () => {
    expect(darwin.sandbox.wrap).toBe(core.wrap);
    expect(darwin.sandbox.profile).toBe(core.profile);
    expect(darwin.sandbox.cacheEnv).toBe(core.cacheEnv);
  });
});
