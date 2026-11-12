// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../../index.html?raw';
import { createSettingsStore } from '../../../entities/settings/index.ts';
import { createIssueStore } from '../../../entities/issue/index.ts';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { mountSettings } from '../index.ts';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const click = (selector: string) => q(selector).onclick!.call(q(selector), new MouseEvent('click') as PointerEvent);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  localStorage.clear();
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn() } });
  q<HTMLDialogElement>('#settings').showModal = function () { this.open = true; };
  q<HTMLDialogElement>('#settings').close = function () { this.open = false; };
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount() {
  const saved = {
    enabled: true, language: 'ko', meetingLanguage: 'en', cleanup: true, provider: 'auto',
    vocabulary: 'Whisper', minutes: true, diarize: true, diarizeReady: true,
    hasHfToken: false, meetingSystemAudio: false, engine: { state: 'ready' },
  };
  const providers = {
    'claude-code': { installed: true, loggedIn: false },
    codex: { installed: true, loggedIn: false },
    api: { installed: true, loggedIn: false },
  };
  const tokens = { hf: { app: true }, anthropic: { app: false } };
  const permissions = { microphone: 'not-determined', inputMonitoring: 'granted', accessibility: 'granted', systemAudio: 'denied' };
  const api = {
    dictSettings: vi.fn().mockResolvedValue(saved),
    dictSaveSettings: vi.fn(async (patch) => Object.assign(saved, patch)),
    onDictSettings: vi.fn(), onDictEngine: vi.fn(), onPermChanged: vi.fn(), onSetup: vi.fn(),
    providers: vi.fn().mockResolvedValue(providers), usage: vi.fn().mockResolvedValue({}),
    permStatus: vi.fn().mockResolvedValue(permissions), permRequest: vi.fn().mockResolvedValue(permissions),
    setupStatus: vi.fn().mockResolvedValue([]), setupRemove: vi.fn(), setupInstall: vi.fn(),
    tokenStatus: vi.fn().mockResolvedValue(tokens), saveToken: vi.fn().mockResolvedValue(tokens),
    verifyToken: vi.fn().mockResolvedValue({ ok: true, message: '확인됨' }), clearToken: vi.fn().mockResolvedValue(tokens),
    openRecordings: vi.fn(), openExternal: vi.fn(),
    chooseRecordings: vi.fn().mockResolvedValue({ dir: '/Users/test/other', total: 0 }),
    resetRecordings: vi.fn().mockResolvedValue({ dir: '/Users/test/default' }),
    info: vi.fn().mockResolvedValue({ defaultRecordingsDir: '/Users/test/default' }),
  };
  const settings = createSettingsStore(api);
  const issues = createIssueStore();
  const deps = { api: api as unknown as RecorderApi, settings, issues, toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true), closePalette: vi.fn(), recordingsChanged: vi.fn(), rerunOnboarding: vi.fn() };
  const ui = mountSettings(deps);
  return { ui, api, settings, issues, deps, saved, providers };
}

describe('mountSettings', () => {
  it('마크업을 그대로 두고 구독을 한 번 등록하며 설정 렌더 뒤에 옛 구독자가 돈다', async () => {
    const before = document.body.innerHTML;
    const { api, settings, issues } = mount();
    expect(document.body.innerHTML).toBe(before);
    const order = [api.onDictSettings, api.onDictEngine, api.onPermChanged, api.onSetup].map((fn) => {
      expect(fn).toHaveBeenCalledOnce();
      return fn.mock.invocationCallOrder[0]!;
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    settings.subscribe((change) => {
      if (change !== 'settings') return;
      expect(q<HTMLInputElement>('#diarizeOn').checked).toBe(true);
      expect(q<HTMLSelectElement>('#meetLanguage').value).toBe('en');
      expect(q('#engAsr em').textContent).toBe('준비됨');
      expect(issues.get('hf')?.sec).toBe('accounts');
    });
    await settings.refresh();
    await settings.refreshProviders();
    expect(q('#engCleanup em').textContent).toBe('계정 없음');
    expect(q('#providers input[value="auto"]').outerHTML).toBe('<input type="radio" name="provider" value="auto">');
    expect(q<HTMLInputElement>('#providers input[value="auto"]').checked).toBe(true);
    expect(q<HTMLInputElement>('#providers input[value="codex"]').disabled).toBe(true);
  });

  it('설정이 닫혀 있으면 setup은 팬아웃만 하고 열려 있을 때 렌더 뒤 알린다', async () => {
    const { ui, api, settings } = mount();
    await settings.refresh();
    const dot = q('#engineDot');
    const setup = api.onSetup.mock.calls[0]![0];
    const list = [{ id: 'turbo', name: '받아쓰기 모델', desc: '설명', installed: false, size: 0, removable: true }];
    const listener = vi.fn(() => q('#compList').innerHTML);
    ui.setupListeners.add(listener);
    setup(list);
    expect(dot.hidden).toBe(true);
    expect(listener.mock.results[0]!.value).toBe('');
    ui.open();
    setup(list);
    expect(dot.hidden).toBe(false);
    expect(listener.mock.results[1]!.value).toBe('<div class="comp"><div class="comp-main"><b>받아쓰기 모델</b><span>설명</span></div><div class="comp-side"><span class="pill ">없음</span>0</div><div class="comp-acts"><button class="btn small primary">받기</button></div></div>');
    setup([{ ...list[0], job: { running: true } }]);
    api.dictSettings.mockClear();
    setup(list);
    expect(api.dictSettings).toHaveBeenCalledOnce();
  });

  it('토큰은 공백을 보존해 저장하고 계정 새로 고침은 공용 providers를 바꾸지 않는다', async () => {
    const { api, settings, providers } = mount();
    await settings.refresh();
    await settings.refreshProviders();
    api.providers.mockResolvedValue({ ...providers, codex: { installed: true, loggedIn: true } });
    await click('#connRefresh');
    expect(settings.getSnapshot().providers).toBe(providers);
    expect(q('#connAccounts').textContent).toContain('Codex로그인됨');
    const input = q<HTMLInputElement>('[data-kind="hf"] [data-input]');
    input.value = '  hf_token  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(api.saveToken).not.toHaveBeenCalled();
    await click('[data-kind="hf"] [data-save]');
    expect(api.saveToken).toHaveBeenCalledWith('hf', '  hf_token  ');
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    expect(api.verifyToken).toHaveBeenCalledWith('hf');
  });

  it('폴더 선택은 설정을 다시 읽고 초기화는 읽지 않으며 온보딩 전에 창을 닫는다', async () => {
    const { ui, api, deps } = mount();
    await click('#chooseDir');
    expect(q('#recDirPath').textContent).toBe('~/other');
    expect(api.dictSettings).toHaveBeenCalledOnce();
    expect(deps.recordingsChanged).toHaveBeenCalledOnce();
    api.dictSettings.mockClear();
    await click('#resetDir');
    expect(q('#recDirPath').textContent).toBe('~/default');
    expect(q('#resetDir').hidden).toBe(true);
    expect(api.dictSettings).not.toHaveBeenCalled();
    expect(deps.recordingsChanged).toHaveBeenCalledTimes(2);
    ui.open();
    deps.rerunOnboarding.mockImplementation(() => expect(q<HTMLDialogElement>('#settings').open).toBe(false));
    await click('#rerunOnboarding');
    expect(deps.rerunOnboarding).toHaveBeenCalledOnce();
  });

  it('선택한 마이크를 유지하고 장치 변경을 같은 함수로 받는다', async () => {
    const { ui } = mount();
    localStorage.setItem('micId', JSON.stringify('bt'));
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: '기본' },
      { kind: 'audioinput', deviceId: 'bt', label: 'AirPods' },
      { kind: 'audioinput', deviceId: 'wired', label: '내장' },
    ] as MediaDeviceInfo[]);
    await ui.loadDevices();
    expect(q<HTMLSelectElement>('#micSelect').value).toBe('bt');
    expect(q('#micHint').classList.contains('bad')).toBe(true);
    expect(navigator.mediaDevices.addEventListener).toHaveBeenCalledWith('devicechange', ui.loadDevices);
    q<HTMLSelectElement>('#micSelect').value = 'wired';
    q('#micSelect').dispatchEvent(new Event('change'));
    expect(localStorage.getItem('micId')).toBe('"wired"');
    expect(q('#micHint').classList.contains('bad')).toBe(false);
  });

  it('보일 때만 3초마다 권한을 읽고 화상 회의 오디오는 선택 사항으로 둔다', async () => {
    const { ui, api, settings, issues } = mount();
    await settings.refresh();
    await ui.refreshPermissions();
    expect(issues.get('perm:microphone')).toBeDefined();
    expect(issues.get('perm:systemAudio')).toBeUndefined();
    expect(q('#permList').textContent).toContain('화상 회의 녹음을 켤 때만 필요');
    api.permStatus.mockClear();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.permStatus).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.permStatus).toHaveBeenCalledOnce();
  });
});
