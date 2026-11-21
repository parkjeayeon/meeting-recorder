// macOS: 붙여넣기 키(⌘V) 보내기 — Swift 도우미 `permissions paste`. src/dictation.js paste()의 도우미 실행 부분을 그대로 옮겼다 (결정 78).
// 클립보드 보관·글 넣기·되돌리기는 dictation.js에 남는다.
import { spawn } from 'node:child_process';
import type { Paster, PasteResult } from '../types.mjs';

// 도우미의 끝 코드와 표준 출력 → 결과. 0이면 붙임, 출력에 'permission'이 있으면 손쉬운 사용 권한 없음, 그 밖은 실패
export function pasteResult(code: number | null, out: string): PasteResult {
  return code === 0 ? 'pasted' : out.includes('permission') ? 'no-permission' : 'failed';
}

export const paster: Paster = {
  sendPaste(helperBin) {
    return new Promise((resolve) => {
      const proc = spawn(helperBin, ['paste'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      proc.stdout!.on('data', (d) => (out += d));
      proc.on('exit', (code) => resolve(pasteResult(code, out)));
    });
  },
};
