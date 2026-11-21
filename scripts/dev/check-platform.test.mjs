// scripts/dev/check-platform.js — 운영체제에 묶인 코드는 src/platform에만 (결정 78)
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { check, stripComments, sourceFiles } = createRequire(import.meta.url)('./check-platform.js');

const one = (text, allow = {}) => check([{ file: 'src/x.js', text }], allow);

describe('check-platform', () => {
  it('OS에 묶인 토큰이 없으면 통과', () => {
    expect(one("const { platform } = require('../lib/platform/index.mjs');\nconst cap = platform.systemAudio();")).toEqual([]);
  });

  it.each([
    ["if (process.platform === 'darwin') app.hide();", 'process.platform'],
    ["execFile('/usr/bin/afconvert', args)", 'afconvert'],
    ["const AFINFO = '/usr/bin/afinfo';", 'afinfo'],
    ["spawn('afplay', ['x'])", 'afplay'],
    ["const B = ['/opt/homebrew/bin/brew'];", '/opt/homebrew'],
    ["const B = ['/usr/local/bin/brew'];", '/usr/local/bin'],
    ["shell.openExternal('x-apple.systempreferences:com.apple.Keyboard-Settings.extension')", 'x-apple.'],
    ['const url = `uv-${arch}-apple-darwin.tar.gz`;', 'apple-darwin'],
    ["const [a] = process.getSystemVersion().split('.');", 'getSystemVersion'],
    ["new BrowserWindow({ type: 'panel' })", "type: 'panel'"],
    ["execFileSync('ps', ['-axo', 'pid='])", 'mac command'],
    ["require('child_process').execFileSync('defaults', ['read'])", 'mac command'],
    ['execFile("osascript", ["-e", s])', 'osascript'],
    ["{ label: '종료', accelerator: 'Command+Q' }", 'Command+'],
  ])('%s → %s', (code, name) => {
    const p = one(code);
    expect(p).toEqual(expect.arrayContaining([expect.stringContaining(`'${name}'`)]));
    expect(p[0]).toContain('src/x.js 줄 1');
  });

  it('주석 안의 낱말은 괜찮다 (줄 주석·블록 주석·줄 끝 주석)', () => {
    const code = [
      '// afconvert로 바꾼 WAV 머리를 고쳐 쓴다',
      '/* process.platform을 여기서 보지 않는다',
      '   /opt/homebrew 도 */',
      "const x = 1; // sandbox-exec 없이",
    ].join('\n');
    expect(one(code)).toEqual([]);
  });

  it('문자열 안의 // 는 주석이 아니다 (주소 뒤 토큰을 놓치지 않는다)', () => {
    expect(one("const u = 'https://example.com/a'; const p = process.platform;")).toEqual([expect.stringContaining("'process.platform'")]);
  });

  it('정규식 리터럴 안의 // 도 주석이 아니다', () => {
    expect(one("const re = /a\\/\\/b/; const p = process.platform;")).toEqual([expect.stringContaining("'process.platform'")]);
  });

  it('주석을 지워도 줄 번호는 그대로', () => {
    const s = stripComments('a\n/* b\n c */\nd // e\n');
    expect(s.split('\n')).toHaveLength(5);
    expect(s.split('\n')[3]).toBe('d     ');
  });

  it('ALLOW에 적은 것은 넘어가고, 더는 나오지 않는 ALLOW는 걸린다', () => {
    const allow = { 'src/x.js:afplay': '셀프테스트 소리', 'src/x.js:osascript': '예전 것' };
    const p = one("const SOUND = ['afplay', []];", allow);
    expect(p).toEqual([expect.stringContaining("ALLOW의 'src/x.js:osascript'가 더는 나오지 않는다")]);
  });

  it('src/platform·시험·core/sandbox.mts는 보지 않는다', () => {
    const files = sourceFiles();
    expect(files.some((f) => f.startsWith('src/platform/'))).toBe(false);
    expect(files.some((f) => /\.test\./.test(f))).toBe(false);
    expect(files).not.toContain('src/core/sandbox.mts');
    expect(files).toContain('src/main.js');
    expect(files).toContain('src/meeting/audio.mts');
  });
});
