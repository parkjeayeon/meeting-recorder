import { describe, expect, it, vi } from 'vitest';
import { createSettingsStore, type SettingsApi, type Settings, type Providers, type SettingsChange } from './store.ts';

function fakeApi() {
  const saved: Settings = {
    enabled: true, language: 'ko', meetingLanguage: 'ko', cleanup: true, provider: 'auto',
    vocabulary: 'PJY, Whisper', minutes: true, diarize: true, diarizeReady: true,
    hasHfToken: true, meetingSystemAudio: false, engine: { state: 'ready' },
  };
  const providers: Providers = {
    'claude-code': { installed: true, loggedIn: true, account: 'me@example.com' },
    codex: { installed: true, loggedIn: true, account: 'me@example.com' },
    api: { installed: true, loggedIn: false },
  };
  const api = {
    dictSettings: vi.fn<SettingsApi['dictSettings']>().mockResolvedValue(saved),
    dictSaveSettings: vi.fn<SettingsApi['dictSaveSettings']>().mockImplementation(async (patch) => ({ ...saved, ...patch })),
    providers: vi.fn<SettingsApi['providers']>().mockResolvedValue(providers),
    onDictSettings: vi.fn<SettingsApi['onDictSettings']>(),
    onDictEngine: vi.fn<SettingsApi['onDictEngine']>(),
  };
  return { api, saved, providers };
}

describe('createSettingsStore', () => {
  it('refresh는 새 스냅샷을 적용한 자리에서 settings를 알린다', async () => {
    const { api, saved } = fakeApi();
    const store = createSettingsStore(api);
    const before = store.getSnapshot();
    expect(before).toEqual({ saved: null, engine: null, providers: null });
    const changes: SettingsChange[] = [];
    store.subscribe((change) => {
      changes.push(change);
      expect(store.getSnapshot().saved).toBe(saved);
      expect(store.getSnapshot().engine).toBe(saved.engine);
    });
    await store.refresh();
    expect(changes).toEqual(['settings']);
    expect(store.getSnapshot()).not.toBe(before);
    expect(before.saved).toBeNull();
    const after = store.getSnapshot();
    await store.refresh();
    expect(store.getSnapshot()).not.toBe(after);
    expect(changes).toEqual(['settings', 'settings']);
  });

  it.each([{ cleanup: false }, { provider: 'codex' }, { apiKey: '' }])('save(%j)는 settings를 먼저 알리고 계정 조회를 기다리지 않는다', async (patch) => {
    const { api, providers } = fakeApi();
    const pending = Promise.withResolvers<Providers>();
    api.providers.mockReturnValue(pending.promise);
    const store = createSettingsStore(api);
    const order: string[] = [];
    store.subscribe((change) => order.push(change));
    await store.save(patch);
    order.push('saved');
    expect(api.dictSaveSettings).toHaveBeenCalledWith(patch);
    expect(store.getSnapshot().saved).toMatchObject(patch);
    expect(api.providers).toHaveBeenCalledWith({ fresh: false });
    expect(order).toEqual(['settings', 'saved']);
    expect(store.getSnapshot().providers).toBeNull();
    const before = store.getSnapshot();
    pending.resolve(providers);
    await pending.promise;
    expect(order).toEqual(['settings', 'saved', 'providers']);
    expect(store.getSnapshot().providers).toBe(providers);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().saved).toBe(before.saved);
    expect(store.getSnapshot().engine).toBe(before.engine);
  });

  it('그 밖의 설정 저장은 계정을 다시 읽지 않는다', async () => {
    const { api } = fakeApi();
    const store = createSettingsStore(api);
    const changes: SettingsChange[] = [];
    store.subscribe((change) => changes.push(change));
    await store.save({ vocabulary: 'Whisper', language: 'en' });
    expect(changes).toEqual(['settings']);
    expect(store.getSnapshot().saved).toMatchObject({ vocabulary: 'Whisper', language: 'en' });
    expect(api.providers).not.toHaveBeenCalled();
  });

  it('계정 새로 고침은 fresh를 넘기고 providers만 알린다', async () => {
    const { api, providers } = fakeApi();
    const store = createSettingsStore(api);
    const changes: SettingsChange[] = [];
    store.subscribe((change) => changes.push(change));
    await store.refreshProviders(true);
    expect(api.providers).toHaveBeenCalledWith({ fresh: true });
    expect(changes).toEqual(['providers']);
    expect(store.getSnapshot()).toEqual({ saved: null, engine: null, providers });
  });

  it('connect에서 한 번 구독하고 IPC를 같은 틱에 알리며 저장된 엔진은 그대로 둔다', () => {
    const { api, saved } = fakeApi();
    const store = createSettingsStore(api);
    const changes: SettingsChange[] = [];
    const unsubscribe = store.subscribe((change) => changes.push(change));
    expect(api.onDictSettings).not.toHaveBeenCalled();
    expect(api.onDictEngine).not.toHaveBeenCalled();
    store.connect();
    expect(api.onDictSettings).toHaveBeenCalledTimes(1);
    expect(api.onDictEngine).toHaveBeenCalledTimes(1);
    expect(api.onDictSettings.mock.invocationCallOrder[0]).toBeLessThan(api.onDictEngine.mock.invocationCallOrder[0]!);
    api.onDictSettings.mock.calls[0]![0](saved);
    expect(changes).toEqual(['settings']);
    expect(store.getSnapshot().saved).toBe(saved);
    const before = store.getSnapshot();
    const engine = { state: 'loading' };
    api.onDictEngine.mock.calls[0]![0](engine);
    expect(changes).toEqual(['settings', 'engine']);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().engine).toBe(engine);
    expect(store.getSnapshot().saved).toBe(saved);
    expect(saved.engine).toEqual({ state: 'ready' });
    expect(before.engine).toBe(saved.engine);
    api.onDictSettings.mock.calls[0]![0](saved);
    expect(changes).toEqual(['settings', 'engine', 'settings']);
    expect(store.getSnapshot().engine).toBe(saved.engine);
    unsubscribe();
    api.onDictEngine.mock.calls[0]![0](engine);
    expect(changes).toEqual(['settings', 'engine', 'settings']);
    expect(store.getSnapshot().engine).toBe(engine);
  });
});
