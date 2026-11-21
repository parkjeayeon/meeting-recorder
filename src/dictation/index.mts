// 받아쓰기: fn 꾹 누르기로 녹음한 음성 → 로컬 Whisper → (선택) 다듬기 → 커서 위치에 붙여 넣기
// 구현은 TypeScript로 옮겼다 (결정 70): 설정·토큰(settings.mts), Whisper 서버·모델·엔진 상태(server.mts), 받아쓰기(transcribe.mts),
// 붙여 넣기(paste.mts), 전체 흐름(dictate.mts). 여기서는 그것들을 엮어 예전 src/dictation.js가 내보내던 이름 19개를 돌려준다.
// Electron을 가져오지 않는다 — 앱 데이터 폴더·safeStorage·클립보드·ClipboardItem과 본체의 CommonJS 모듈(샌드박스·다듬기)은
// src/dictation.js가 넘기고, 불러올 때 한 번 만든다. whisper-server 자리(WHISPER_SERVER·플랫폼 층)와 끝날 때 서버를 내리는 처리도 만들 때 한 번.
import os from 'node:os';
import type { CleanupResult } from '../llm/cleanup.mjs';
import type { Choice } from '../llm/call.mjs';
import type { ProviderStatus } from '../llm/providers.mjs';
import { platform as realPlatform, type PasteResult, type Platform } from '../platform/index.mjs';
import { createDictate, type DictateOptions, type DictateResult } from './dictate.mjs';
import { createPaste, type ClipboardItemCtor, type ClipboardPort } from './paste.mjs';
import { createServer, type DedicatedServer, type EngineStatus, type SandboxWrap } from './server.mjs';
import { createSettings, type DictationSettings, type SettingsPatch, type StoredSettings, type TokenSources } from './settings.mjs';
import { createTranscriber, isHallucination, type AsrSettings, type Segment, type TranscribeResult } from './transcribe.mjs';
import type { MeetingVad } from '../core/vad.mjs';

export type { DictationSettings, SettingsPatch, StoredSettings, StoredFile, TokenSources } from './settings.mjs';
export { DEFAULT_SETTINGS } from './settings.mjs';
export type { EngineStatus, DedicatedServer, SandboxWrap } from './server.mjs';
export { MODEL_FILE } from './server.mjs';
export type { AsrSettings, Segment, TranscribeResult, WhisperResponse, WhisperSegment } from './transcribe.mjs';
export { isHallucination } from './transcribe.mjs';
export type { ClipboardEntry, ClipboardItemCtor, ClipboardPort } from './paste.mjs';
export type { DictateOptions, DictateResult, DictateStage, DictateTiming } from './dictate.mjs';

export type DictationPlatform = Pick<Platform, 'paths' | 'processes' | 'paster'>;

export interface DictationDeps {
  userData: () => string; // app.getPath('userData'), 부를 때 읽는다
  encrypt: (plain: string) => Buffer; // safeStorage.encryptString
  decrypt: (encrypted: Buffer) => string; // safeStorage.decryptString
  clipboard: ClipboardPort; // Electron clipboard
  ClipboardItem: ClipboardItemCtor; // Electron ClipboardItem
  sandboxWrap: SandboxWrap; // sandbox.wrap
  // cleanup.js의 것 — scripts/dev 시험이 그 모듈 객체의 함수를 바꿔 끼우므로 부를 때 찾는 함수로 넘긴다
  cleanup: (raw: string, opts: { provider: Choice; apiKey?: string | null }) => Promise<CleanupResult>;
  providerStatus: (q: { hasApiKey: boolean }, opts?: { fresh?: boolean }) => Promise<ProviderStatus>;
  // 시험용 (안 주면 진짜): 플랫폼 층, 환경 변수, 홈 폴더, 끝날 때 부를 것 붙이기
  platform?: DictationPlatform;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  onExit?: (fn: () => void) => void;
}

export interface Dictation {
  init(opts: { onEngineStatus: (s: EngineStatus) => void }): void;
  engineInstalled(): string | null;
  storedSettings(): StoredSettings;
  dictate(wavPath: string, opts: DictateOptions): Promise<DictateResult>;
  paste(text: string, helperBin: string): Promise<PasteResult>;
  transcribe(wavPath: string, settings: AsrSettings, opts?: { voicedMs?: number; port?: number | null }): Promise<TranscribeResult>;
  transcribeSegments(wavPath: string, settings: AsrSettings, port?: number | null, opts?: { noContext?: boolean }): Promise<Segment[]>;
  startDedicatedServer(modelFile: string, opts?: { vad?: MeetingVad | null }): Promise<DedicatedServer | null>;
  apiKey(): string | null;
  hfToken(): string | null;
  hfCliToken(): string | null;
  tokenSources(): TokenSources;
  cleanupProviders(opts?: { fresh?: boolean }): Promise<ProviderStatus>;
  downloadModel(): Promise<void>;
  engineStatus(): EngineStatus;
  startServer(): Promise<number> | null;
  stopServer(): void;
  getSettings(): DictationSettings;
  saveSettings(patch: SettingsPatch): DictationSettings;
}

export function createDictation(deps: DictationDeps): Dictation {
  const platform = deps.platform ?? realPlatform;
  const env = deps.env ?? process.env;
  const settings = createSettings({
    userData: deps.userData,
    encrypt: deps.encrypt,
    decrypt: deps.decrypt,
    env,
    homedir: deps.homedir ?? (() => os.homedir()),
  });
  // whisper-server 자리와 끝날 때 처리는 만들 때 한 번 (예전에 불러올 때 한 번 정하던 것과 같다)
  const server = createServer({
    userData: deps.userData,
    sandboxWrap: deps.sandboxWrap,
    platform,
    candidates: [
      env.WHISPER_SERVER,
      ...platform.paths.whisperServer, // brew install whisper-cpp
    ].filter((p): p is string => Boolean(p)),
    onExit: deps.onExit ?? ((fn) => process.on('exit', fn)),
  });
  const { transcribe, transcribeSegments } = createTranscriber(server);
  const paste = createPaste({ clipboard: deps.clipboard, ClipboardItem: deps.ClipboardItem, platform });
  const { getSettings, saveSettings, storedSettings, apiKey, hfToken, hfCliToken, tokenSources } = settings;
  const dictate = createDictate({ getSettings, transcribe, isHallucination, cleanup: deps.cleanup, apiKey, paste });

  function init({ onEngineStatus }: { onEngineStatus: (s: EngineStatus) => void }): void {
    server.setOnStatus(onEngineStatus);
    server.killStaleServer();
    server.killOrphanServers();

    if (getSettings().enabled) server.startServer()?.catch(() => {}); // 실패는 engineStatus로 화면에 표시된다
  }

  function cleanupProviders(opts?: { fresh?: boolean }): Promise<ProviderStatus> {
    return deps.providerStatus({ hasApiKey: getSettings().hasApiKey }, opts);
  }

  const engineInstalled = () => server.whisperServerBin();

  return {
    init,
    engineInstalled,
    storedSettings,
    dictate,
    paste,
    transcribe,
    transcribeSegments,
    startDedicatedServer: server.startDedicatedServer,
    apiKey,
    hfToken,
    hfCliToken,
    tokenSources,
    cleanupProviders,
    downloadModel: server.downloadModel,
    engineStatus: server.engineStatus,
    startServer: server.startServer,
    stopServer: server.stopServer,
    getSettings,
    saveSettings,
  };
}
