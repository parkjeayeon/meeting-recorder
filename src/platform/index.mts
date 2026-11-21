// 플랫폼 층의 앞문 (결정 78): 운영체제에 묶인 일은 모두 여기서 고른 구현으로 한다.
// 이 파일이 OS를 보는 유일한 곳이다(darwin/ 안과 core/sandbox.mts 빼고). 다른 곳에서 process.platform·macOS 도구 이름을 쓰면
// scripts/dev/check-platform.js(npm run typecheck)가 막는다.
// 본체(CommonJS)는 require('../lib/platform/index.mjs').platform, .mts 모듈은 import { platform } from '../platform/index.mjs'.
// Electron 객체는 받지 않는다 — 필요한 Electron 호출은 부르는 쪽이 하고, 여기서는 할지 말지·무엇을 넘길지만 돌려준다.
import { darwin } from './darwin/index.mjs';
import type { Platform } from './types.mjs';
import { createUnsupported } from './unsupported.mjs';

// 시험용: OS 이름으로 구현 고르기
export function platformFor(os: NodeJS.Platform): Platform {
  return os === 'darwin' ? darwin : createUnsupported(os);
}

export const platform: Platform = platformFor(process.platform);

export { systemAudioFor } from './system-audio.mjs';
export { splitLines } from './lines.mjs';
export type * from './types.mjs';
