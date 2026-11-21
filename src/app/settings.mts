// ── 받아쓰기 설정·음성 인식 설치·다듬기 계정·앱 정보, 떠 있는 막대의 버튼 ─────────────────────
// src/main.js에서 옮김 (결정 70). 설정을 저장하면 녹음 폴더의 설정 백업(folders.mts)과 막대의 언어 표시도 바꾼다(saveDictSettings).
// 상태는 갖지 않는다 — 받아쓰기·엔진 설치·사용량(CommonJS 연결 파일), 녹음 폴더, 창·막대, fn 상태 머신은 본체가 넘긴다.
import type { Dictation, DictationSettings, SettingsPatch } from '../dictation/index.mjs';
import type { SystemAudioCapability } from '../platform/index.mjs';
import { PORTABLE_KEYS } from './folders.mjs';
import type { MinutesModule, Setup, UsageModule } from './connectors.mjs';
import type { Ipc } from './ipc.mjs';

// 받아쓰기 언어 바꾸기 (떠 있는 막대의 언어 버튼): 한국어 → English → 日本語 → 자동 → 한국어
export const LANG_CYCLE = ['ko', 'en', 'ja', 'auto'];

export interface SettingsContext {
  dictation: Pick<Dictation, 'getSettings' | 'saveSettings' | 'engineStatus' | 'startServer' | 'cleanupProviders' | 'downloadModel'>;
  minutes: Pick<MinutesModule, 'diarizeAvailable'>;
  setup: Setup;
  usage: Pick<UsageModule, 'usage'>;
  writePortableSettings: () => void;
  recordingsDir: () => string;
  defaultRecordingsDir: string;
  capability: SystemAudioCapability;
  fnUsageWarning: () => string | null;
  micAccess: () => string; // app:info의 마이크 권한
  selftest: boolean;
  log: (...args: unknown[]) => void; // console.log
  send: (channel: string, payload?: unknown) => void; // 메인 창으로
  sendOverlayState: () => void;
  showWindow: () => void;
  uiToggle: (mode: string | undefined) => void;
  showItemInFolder: (p: string) => void; // shell.showItemInFolder
}

export function registerSettings(ipc: Ipc, ctx: SettingsContext): void {
  const { dictation, minutes, setup } = ctx;

  function saveDictSettings(patch: SettingsPatch): DictationSettings {
    const settings = dictation.saveSettings(patch);
    if (PORTABLE_KEYS.some((k) => k in patch)) ctx.writePortableSettings();
    if ('language' in patch) ctx.sendOverlayState(); // 막대의 언어 표시도
    return settings;
  }

  ipc.handle('dict:providers', (_e, opts) => dictation.cleanupProviders(opts as { fresh?: boolean } | undefined));
  ipc.handle('usage:get', (_e, opts) => ctx.usage.usage(opts as { force?: boolean } | undefined));

  // ── 받아쓰기 설정·음성 인식 설치·앱 정보 ───────────────────────────────────
  ipc.handle('dict:settings', () => ({ ...dictation.getSettings(), engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() }));
  ipc.handle('dict:saveSettings', (_e, patch) => {
    const settings = saveDictSettings(patch as SettingsPatch);
    if (settings.enabled) dictation.startServer();
    return { ...settings, engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() };
  });
  ipc.handle('setup:status', () => setup.status());
  ipc.handle('setup:install', (_e, id) => {
    setup.install(id as string); // 오래 걸리므로 기다리지 않고, 진행 상황은 setup:status로 보낸다
  });
  ipc.handle('setup:remove', (_e, id) => setup.remove(id as string));
  ipc.handle('dict:download', () => dictation.downloadModel().catch((err: Error) => ctx.send('dict:engine', { state: 'error', error: err.message })));

  ipc.handle('app:info', async () => ({
    capability: ctx.capability,
    fnWarning: ctx.fnUsageWarning(),
    micAccess: ctx.micAccess(),
    recordingsDir: ctx.recordingsDir(),
    defaultRecordingsDir: ctx.defaultRecordingsDir,
    selftest: ctx.selftest,
  }));
  ipc.on('app:reveal', (_e, p) => ctx.showItemInFolder(p as string));
  ipc.on('app:log', (_e, msg) => {
    if (ctx.selftest) ctx.log('SELFTEST alert', msg);
  });

  ipc.on('overlay:action', (_e, name) => {
    if (name === 'open') ctx.showWindow();
    else if (name === 'lang-next') {
      const now = dictation.getSettings().language;
      const settings = saveDictSettings({ language: LANG_CYCLE[(LANG_CYCLE.indexOf(now) + 1) % LANG_CYCLE.length] });
      ctx.send('dict:settingsChanged', { ...settings, engine: dictation.engineStatus(), diarizeReady: minutes.diarizeAvailable() }); // 메인 창의 왼쪽 아래·설정도
    } else ctx.uiToggle(name as string | undefined);
  });
}
