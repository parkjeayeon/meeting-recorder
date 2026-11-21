// macOS: ps로 고아 프로세스 찾기. src/main.js killOrphanFnListeners·src/dictation.js killOrphanServers·killStaleServer에 있던
// ps 호출과 줄 읽기를 그대로 옮겼다 (결정 78). 어느 것을 끌지(명령줄 비교)와 process.kill은 부르는 쪽에 남는다.
import { execFileSync } from 'node:child_process';
import type { ProcessEntry, Processes } from '../types.mjs';

// `ps -axo pid=,ppid=,command=` 출력에서 부모가 1인 줄만
export function parseOrphans(out: string): ProcessEntry[] {
  const found: ProcessEntry[] = [];
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m && m[2] === '1') found.push({ pid: Number(m[1]), command: m[3]! });
  }
  return found;
}

export const processes: Processes = {
  orphans() {
    try {
      return parseOrphans(execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString());
    } catch {
      return [];
    }
  },
  commandOf(pid) {
    try {
      return execFileSync('ps', ['-o', 'command=', '-p', String(pid)]).toString();
    } catch {
      return null;
    }
  },
};
