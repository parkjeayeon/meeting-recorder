// macOS가 아닌 OS (결정 78). Windows 구현은 아직 없다 — 여기서 새 동작을 지어내지 않는다.
// 규칙: 예전 코드가 그 OS에서 macOS 도구·도우미가 없어 실패하던 곳은, 그 도구를 부르지 않고 부르는 쪽이 이미 다루는 실패 값
// (빈 목록·null·'failed'·던지기)으로 답한다. 예전에도 그 OS에서 정해진 답이 있던 것(시스템 소리의 win32 → wasapi_loopback,
// 샌드박스는 감싸지 않고 그대로 실행, 마이크 권한 'granted')은 그 답 그대로다.
// 이 앱은 macOS 밖에서 실행해 본 적이 없다.
import { cacheEnv, profile, wrap } from '../core/sandbox.mjs';
import { startLineHelper } from './lines.mjs';
import { systemAudioFor } from './system-audio.mjs';
import type { Platform } from './types.mjs';

function unsupported(what: string, os: string): Error {
  return new Error(`${what}: 이 OS(${os})에서는 지원하지 않습니다`);
}

export function createUnsupported(os: NodeJS.Platform): Platform {
  return {
    os,
    // 예전: ps가 없으면 던지고 try/catch가 삼켜 아무것도 끄지 않았다
    processes: { orphans: () => [], commandOf: () => null },
    keyListener: {
      keyName: 'fn',
      // 도우미가 있는지는 main.js가 먼저 보고 없으면 예전처럼 "바이너리가 없습니다"를 알린다. 있으면 띄우는 것까지는 OS와 상관없는 일이다
      start: startLineHelper,
      usageWarning: () => null, // 예전: defaults가 없으면 던지고 null
    },
    // 예전: 도우미가 없으면 spawn 'error'를 아무도 받지 않았다(멈추거나 죽음). 여기서는 부르는 쪽이 이미 다루는 실패로
    paster: { sendPaste: async () => 'failed' },
    permissions: {
      kinds: [],
      runHelper: async () => null, // 예전: execFile 오류 → null
      privacyPaneUrl: () => null,
      keyboardSettingsUrl: () => null,
    },
    audio: {
      convert: () => {
        throw unsupported('소리 변환', os);
      },
      info: () => {
        throw unsupported('소리 정보 읽기', os);
      },
    },
    paths: {
      whisperServer: [],
      brew: [],
      cli: () => [],
      uvArchive: () => {
        throw unsupported('uv 내려받기', os);
      },
    },
    systemAudio: () => systemAudioFor(os, () => ''),
    sandbox: { wrap, profile, cacheEnv }, // core/sandbox.mts가 darwin이 아니면 감싸지 않고 그대로 돌려준다
    shell: {
      selftestSound: null,
      hideAppBeforeRepaste: false,
      overlayWindow: {},
      devDockIcon: false,
      askMicAtLaunch: false,
      micAccessFromSystem: false,
    },
  };
}
