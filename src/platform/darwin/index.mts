// macOS 구현 — 지금까지 본체·회의 모듈에 흩어져 있던 macOS 코드를 옮긴 것 (결정 78). 고르는 일은 ../index.mts.
import { cacheEnv, profile, wrap } from '../../core/sandbox.mjs';
import { systemAudioFor } from '../system-audio.mjs';
import type { Platform } from '../types.mjs';
import { audio } from './audio.mjs';
import { keyListener } from './key-listener.mjs';
import { paster } from './paster.mjs';
import { paths } from './paths.mjs';
import { permissions } from './permissions.mjs';
import { processes } from './processes.mjs';
import { shell } from './shell.mjs';

// process.getSystemVersion은 Electron이 더하는 것이라 Node 타입에 없다 (시험은 Node로 돌므로 부를 때만 읽는다)
const systemVersion = (): string => (process as unknown as { getSystemVersion(): string }).getSystemVersion();

export const darwin: Platform = {
  os: 'darwin',
  processes,
  keyListener,
  paster,
  permissions,
  audio,
  paths,
  systemAudio: () => systemAudioFor('darwin', systemVersion),
  sandbox: { wrap, profile, cacheEnv },
  shell,
};
