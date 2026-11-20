import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cacheEnv, profile, wrap } from './sandbox.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-sandbox-test-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const real = (p: string) => fs.realpathSync(p);
const WRITE_TAIL = `(subpath "${real(os.tmpdir())}") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))`;

describe('profile (샌드박스 규칙 글)', () => {
  it('network none: 쓰기는 지정한 폴더·임시 폴더만, 네트워크는 유닉스 소켓만', () => {
    expect(profile({ write: [tmp], network: 'none' })).toBe([
      '(version 1)',
      '(allow default)',
      '(deny file-write*)',
      `(allow file-write* (subpath "${real(tmp)}") ${WRITE_TAIL}`,
      '(deny network*)',
      '(allow network* (local unix-socket) (remote unix-socket))',
    ].join('\n'));
  });

  it('network local: 이 컴퓨터 안(localhost)만 더 연다', () => {
    const lines = profile({ network: 'local' }).split('\n');
    expect(lines.slice(3)).toEqual([
      `(allow file-write* ${WRITE_TAIL}`,
      '(deny network*)',
      '(allow network* (local unix-socket) (remote unix-socket))',
      '(allow network-bind network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    ]);
  });

  it('network all: 네트워크 줄이 없다, 기본값은 none', () => {
    expect(profile({ network: 'all' }).split('\n')).toHaveLength(4);
    expect(profile({})).toBe(profile({ network: 'none' }));
  });

  it('경로의 따옴표·역슬래시는 이스케이프, 없는 경로는 그대로', () => {
    const odd = path.join(tmp, '없는 "폴더"\\x');
    expect(profile({ write: [odd] })).toContain(`(subpath "${odd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`);
  });

  it('심볼릭 링크는 실제 경로로', () => {
    const target = fs.mkdtempSync(path.join(tmp, 'target-'));
    const link = path.join(tmp, 'link');
    fs.symlinkSync(target, link);
    expect(profile({ write: [link] })).toContain(`(subpath "${real(target)}")`);
  });
});

describe('wrap · cacheEnv', () => {
  it.runIf(process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec'))('macOS: sandbox-exec -p 규칙 명령 인자', () => {
    const [bin, argv] = wrap('/bin/echo', ['a', 'b'], { write: [tmp], network: 'local' });
    expect(bin).toBe('/usr/bin/sandbox-exec');
    expect(argv).toEqual(['-p', profile({ write: [tmp], network: 'local' }), '/bin/echo', 'a', 'b']);
  });

  it('캐시는 쓸 수 있는 폴더 아래로', () => {
    expect(cacheEnv('/x')).toEqual({ XDG_CACHE_HOME: '/x/cache', TORCH_HOME: '/x/cache/torch', MPLCONFIGDIR: '/x/cache/matplotlib', PYTHONPYCACHEPREFIX: '/x/cache/pycache' });
  });
});
