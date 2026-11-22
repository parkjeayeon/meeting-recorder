// 한 줄씩 말하는 도우미 띄우기 (OS와 상관없는 부분). src/main.js startFnListener에 있던 것 그대로 (결정 78).
import { spawn } from 'node:child_process';
import type { KeyListenerEvents, KeyListenerHandle } from './types.mjs';

// 받은 조각을 이어 붙이고, 줄바꿈이 나올 때마다 앞뒤 공백을 뺀 줄을 넘긴다. 줄바꿈이 오지 않은 끝 조각은 다음 조각을 기다린다.
export function splitLines(onLine: (line: string) => void): (data: { toString(): string }) => void {
  let buf = '';
  return (data) => {
    buf += data.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      onLine(buf.slice(0, idx).trim());
      buf = buf.slice(idx + 1);
    }
  };
}

// 도우미를 인자 없이 띄워 표준 출력을 줄마다, 끝나면 끝 코드를 넘긴다. 표준 입력은 닫고 표준 오류는 앱의 것으로 흘린다
export function startLineHelper(bin: string, on: KeyListenerEvents): KeyListenerHandle {
  const proc = spawn(bin, [], { stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout!.on('data', splitLines((line) => on.line(line)));
  // 띄우지 못하면(실행할 수 없음 등) 'exit' 없이 'error'만 온다 → 끝 코드 없이(null) 끝났다고 한 번만 알린다
  let ended = false;
  const end = (code: number | null) => {
    if (ended) return;
    ended = true;
    on.exit(code);
  };
  proc.on('exit', (code) => end(code));
  proc.on('error', () => end(null));
  return proc;
}
