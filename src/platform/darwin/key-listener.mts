// macOS: fn 키 듣기 — Swift 도우미(native/fn-listener)를 띄우고 표준 출력을 줄마다 넘긴다.
// src/main.js startFnListener의 spawn·줄 나누기·exit와 fnUsageWarning을 그대로 옮겼다 (결정 78).
// 한 번만 띄우기(fnProc)·고아 정리·실행 파일 확인·줄의 뜻(handleFnLine)·종료 안내 문장은 본체(src/app/fn-keys.mts)에 있다.
import { execFileSync } from 'node:child_process';
import { startLineHelper } from '../lines.mjs';
import type { KeyListener } from '../types.mjs';

export const keyListener: KeyListener = {
  keyName: 'fn',
  start: startLineHelper,
  usageWarning() {
    // 0: 아무것도 안 함, 1: 입력 소스 변경, 2: 이모지, 3: 받아쓰기
    try {
      const v = execFileSync('defaults', ['read', 'com.apple.HIToolbox', 'AppleFnUsageType']).toString().trim();
      if (v !== '0') return '시스템 설정 › 키보드 › "🌐 키를 누르면"을 "아무것도 안 함"으로 바꾸세요. 지금은 fn을 누를 때 다른 동작도 함께 실행됩니다.';
    } catch {}
    return null;
  },
};
