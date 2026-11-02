// 앱이 띄우는 외부 프로그램(설치 도구·화자 구분·Whisper 서버)을 macOS 샌드박스(Seatbelt, sandbox-exec)로 감싼다.
// Codex·Claude Code와 같은 방식: 읽기는 넓게 두고, 쓰기는 지정한 폴더만, 네트워크는 필요한 만큼만 연다.
// 내려받은 패키지에 무엇이 섞여 있어도 녹음 폴더·문서에 쓰거나 녹음을 밖으로 보내지 못하게 하는 것이 목적이다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

// SBPL 문자열 안에 넣을 경로 (따옴표·역슬래시 이스케이프, 심볼릭 링크는 실제 경로로)
function sbPath(p) {
  let real = p;
  try {
    real = fs.realpathSync(p);
  } catch {}
  return `"${real.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * @param {object} opts
 * @param {string[]} opts.write 쓸 수 있는 폴더 (임시 폴더는 항상 포함)
 * @param {'none'|'local'|'all'} opts.network none: 차단, local: 이 컴퓨터 안(127.0.0.1)만, all: 허용
 */
function profile({ write = [], network = 'none' }) {
  const writable = [...write, os.tmpdir(), '/private/tmp', '/private/var/folders'].map((p) => `(subpath ${sbPath(p)})`);
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* ${writable.join(' ')} (subpath "/dev"))`,
  ];
  if (network !== 'all') {
    lines.push('(deny network*)');
    // 프로세스 사이 통신용 유닉스 소켓은 막지 않는다
    lines.push('(allow network* (local unix-socket) (remote unix-socket))');
  }
  if (network === 'local') {
    lines.push('(allow network-bind network-inbound (local ip "localhost:*"))');
    lines.push('(allow network-outbound (remote ip "localhost:*"))');
  }
  return lines.join('\n');
}

// spawn에 넘길 [명령, 인자]. sandbox-exec이 없으면(다른 OS) 그대로 실행한다
function wrap(cmd, args, opts) {
  if (process.platform !== 'darwin' || !fs.existsSync(SANDBOX_EXEC)) return [cmd, args];
  return [SANDBOX_EXEC, ['-p', profile(opts), cmd, ...args]];
}

// 샌드박스 안 파이썬·torch가 홈 폴더 캐시(~/.cache 등)에 쓰려다 막히지 않도록 쓰기 가능한 곳으로 돌린다
function cacheEnv(dir) {
  return {
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    TORCH_HOME: path.join(dir, 'cache', 'torch'),
    MPLCONFIGDIR: path.join(dir, 'cache', 'matplotlib'),
    PYTHONPYCACHEPREFIX: path.join(dir, 'cache', 'pycache'),
  };
}

module.exports = { wrap, profile, cacheEnv };
