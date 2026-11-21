// macOS: 엔진·도구 실행 파일을 찾는 자리와 uv 내려받기 주소 (결정 78).
// src/dictation.js(whisper-server)·src/setup.js(Homebrew, uv)·src/llm/providers.mts(Claude Code·Codex)에 있던 목록을 순서까지 그대로 옮겼다.
// 그 목록에서 있는 것을 고르는 일은 부르는 쪽에 남는다.
import os from 'node:os';
import path from 'node:path';
import type { Paths } from '../types.mjs';

export const paths: Paths = {
  whisperServer: [
    '/opt/homebrew/bin/whisper-server', // brew install whisper-cpp
    '/usr/local/bin/whisper-server',
  ],
  brew: ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'],
  cli(id) {
    if (id === 'claude-code') return ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude')];
    return ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(os.homedir(), '.local/bin/codex')];
  },
  uvArchive(arch) {
    return { url: `https://github.com/astral-sh/uv/releases/latest/download/uv-${arch}-apple-darwin.tar.gz`, dir: `uv-${arch}-apple-darwin` };
  },
};
