// 회의 녹취·회의록이 바깥(Electron·본체의 CommonJS 모듈)에서 받아 쓰는 것. 본체는 src/minutes.js가 configure()로 한 번에 넘긴다 (결정 70).
// 여기서 Electron이나 설정 파일을 읽지 않는다 → 단위 시험은 가짜를 넘겨 바로 돌린다.
// 옛 minutes.js가 부를 때마다 읽던 값(앱 데이터 폴더·지금 설정 등)은 값이 아니라 함수로 받아 부를 때 읽는다.
import type { CompleteOptions } from '../llm/call.mjs';
import type { MeetingVad } from '../core/vad.mjs';
import type { Segment } from './transcript.mjs';

// 설정 중 여기서 읽는 부분 (dictation.getSettings)
export interface MeetingSettings {
  provider: CompleteOptions['choice'];
  language?: string;
  meetingLanguage?: string;
  vocabulary?: string;
  diarize?: boolean;
  [k: string]: unknown;
}

// 회의용 Whisper 서버 (dictation.startDedicatedServer)
export interface DedicatedServer {
  port: number;
  stop(): void;
  onProgress(cb: ((p: number) => void) | null): void;
}

export interface MeetingDeps {
  userData: () => string; // app.getPath('userData')
  isPackaged: () => boolean; // app.isPackaged
  resourcesPath: () => string; // process.resourcesPath (설치본에서 diarize.py 자리)
  isOnline: () => boolean; // net.isOnline()
  getSettings: () => MeetingSettings;
  apiKey: () => string | null;
  transcribeSegments: (wavPath: string, asr: MeetingSettings, port?: number | null, opts?: { noContext?: boolean }) => Promise<Segment[]>;
  startDedicatedServer: (modelFile: string, opts?: { vad?: MeetingVad | null }) => Promise<DedicatedServer | null>;
  complete: (opts: CompleteOptions) => Promise<{ text: string; provider: string }>;
  makeGlossary: (dir: string) => Promise<unknown>;
  sandboxWrap: (cmd: string, args: string[], opts: { network: 'none' | 'local' }) => [string, string[]];
  sandboxCacheEnv: (dir: string) => Record<string, string>;
}

let deps: Partial<MeetingDeps> = {};

// 넘긴 것만 바꾼다 (시험이 일부만 바꿔 끼울 수 있게)
export function configure(opts: Partial<MeetingDeps>): void {
  deps = { ...deps, ...opts };
}

// 이어지지 않은 채 쓰면 조용히 넘어가지 않고 바로 실패한다
function need<K extends keyof MeetingDeps>(name: K): MeetingDeps[K] {
  const f = deps[name];
  if (!f) throw new Error(`회의 모듈에 ${name}이(가) 이어지지 않았습니다 (meeting.configure)`);
  return f as MeetingDeps[K];
}

export const userData = (): string => need('userData')();
export const isPackaged = (): boolean => need('isPackaged')();
export const resourcesPath = (): string => need('resourcesPath')();
export const isOnline = (): boolean => need('isOnline')();
export const getSettings = (): MeetingSettings => need('getSettings')();
export const apiKey = (): string | null => need('apiKey')();
export const transcribeSegments: MeetingDeps['transcribeSegments'] = (...args) => need('transcribeSegments')(...args);
export const startDedicatedServer: MeetingDeps['startDedicatedServer'] = (...args) => need('startDedicatedServer')(...args);
export const complete: MeetingDeps['complete'] = (opts) => need('complete')(opts);
export const makeGlossary: MeetingDeps['makeGlossary'] = (dir) => need('makeGlossary')(dir);
export const sandboxWrap: MeetingDeps['sandboxWrap'] = (cmd, args, opts) => need('sandboxWrap')(cmd, args, opts);
export const sandboxCacheEnv: MeetingDeps['sandboxCacheEnv'] = (dir) => need('sandboxCacheEnv')(dir);
