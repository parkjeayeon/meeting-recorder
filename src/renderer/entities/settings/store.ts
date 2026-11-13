import type { RecorderApi } from '../../shared/api/index.ts';

export type SettingsApi = Pick<RecorderApi, 'dictSettings' | 'dictSaveSettings' | 'providers' | 'onDictSettings' | 'onDictEngine'>;
export type Settings = Awaited<ReturnType<SettingsApi['dictSettings']>>;
export type EngineStatus = Settings['engine'];
export type Providers = Awaited<ReturnType<SettingsApi['providers']>>;
export type SettingsChange = 'settings' | 'engine' | 'providers';

export interface SettingsState {
  readonly saved: Settings | null;
  readonly engine: EngineStatus | null;
  readonly providers: Providers | null;
}

export interface SettingsStore {
  readonly getSnapshot: () => SettingsState;
  readonly subscribe: (fn: (change: SettingsChange) => void) => () => void;
  readonly refresh: () => Promise<void>;
  readonly save: (patch: Parameters<SettingsApi['dictSaveSettings']>[0]) => Promise<void>;
  readonly refreshProviders: (fresh?: boolean) => Promise<void>;
  /** preload는 해제 함수를 주지 않으므로 앱 시작 때 한 번만 */
  readonly connect: () => void;
}

export function createSettingsStore(api: SettingsApi): SettingsStore {
  let state: SettingsState = { saved: null, engine: null, providers: null };
  const subs = new Set<(change: SettingsChange) => void>();
  const emit = (change: SettingsChange) => {
    for (const fn of subs) fn(change);
  };
  const apply = (saved: Settings) => {
    state = { ...state, saved, engine: saved.engine };
    emit('settings');
  };
  const refreshProviders = async (fresh = false): Promise<void> => {
    const providers = await api.providers({ fresh });
    state = { ...state, providers };
    emit('providers');
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    refresh: async () => { apply(await api.dictSettings()); },
    save: async (patch) => {
      apply(await api.dictSaveSettings(patch));
      // 옛 저장처럼 계정 조회는 기다리지 않는다
      if ('apiKey' in patch || 'provider' in patch || 'cleanup' in patch) void refreshProviders();
    },
    refreshProviders,
    connect: () => {
      api.onDictSettings?.((saved: Settings) => apply(saved));
      api.onDictEngine((engine: EngineStatus) => {
        state = { ...state, engine };
        emit('engine');
      });
    },
  };
}
