// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../../index.html?raw';
import { createSettingsStore } from '../../../entities/settings/index.ts';
import { createIssueStore } from '../../../entities/issue/index.ts';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { mountSettings } from '../index.ts';
import * as sharedUi from '../../../shared/ui/index.tsx';
import type { SetupComponent, UsageResult } from './types.ts';
import originalBody from './__fixtures__/dialog.html?raw';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const click = (selector: string) => q(selector).onclick!.call(q(selector), new MouseEvent('click') as PointerEvent);

function resetDocument() {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  localStorage.clear();
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn() } });
  q<HTMLDialogElement>('#settings').showModal = function () { this.open = true; };
  q<HTMLDialogElement>('#settings').close = function () { this.open = false; };
}
beforeEach(() => {
  vi.useFakeTimers();
  resetDocument();
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
  it('마크업을 그대로 두고 구독을 한 번 등록하며 설정 렌더 뒤에 후속 구독자가 돈다', async () => {
    const before = document.body.innerHTML;
    const { api, settings, issues } = mount();
    const original = document.createElement('dialog');
    original.innerHTML = originalBody;
    const normalize = (html: string) => html.replace(/>[ \t]*\n\s*</g, '><');
    expect(normalize(q('#settings').innerHTML)).toBe(normalize(original.innerHTML));
    const outside = document.body.cloneNode(true) as HTMLElement;
    outside.querySelector('#settings')!.replaceChildren();
    expect(outside.innerHTML).toBe(before);
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

  it('설정이 닫혀 있어도 setup으로 엔진 표시점을 갱신하고 열려 있으면 렌더 뒤 알린다', async () => {
    const { ui, api, settings } = mount();
    await settings.refresh();
    const dot = q('#engineDot');
    const setup = api.onSetup.mock.calls[0]![0];
    const list = [{ id: 'turbo', name: '받아쓰기 모델', desc: '설명', installed: false, size: 0, removable: true }];
    const listener = vi.fn(() => q('#compList').innerHTML);
    ui.setupListeners.add(listener);
    expect(q<HTMLDialogElement>('#settings').open).toBe(false);
    expect(dot.hidden).toBe(true);
    setup(list);
    expect(dot.hidden).toBe(false);
    expect(listener.mock.results[0]!.value).toBe('');
    ui.open();
    setup(list);
    expect(dot.hidden).toBe(false);
    expect(listener.mock.results[1]!.value).toBe('<div class="comp"><div class="comp-main"><b>받아쓰기 모델</b><span>설명</span></div><div class="comp-side"><span class="pill ">없음</span>0</div><div class="comp-acts"><button class="btn small primary">받기</button></div></div>');
    setup([{ ...list[0], job: { running: true } }]);
    api.dictSettings.mockClear();
    setup(list);
    expect(api.dictSettings).toHaveBeenCalledOnce();
    q<HTMLDialogElement>('#settings').close();
    setup([{ ...list[0]!, installed: true }]);
    expect(dot.hidden).toBe(true);
    setup(list);
    expect(dot.hidden).toBe(false);
    setup([{ ...list[0]!, id: 'large' }]);
    expect(dot.hidden).toBe(true);
  });

  it('토큰은 공백을 보존해 저장하고 계정 새로 고침은 공용 providers와 사이드바 다듬기 표시를 갱신한다', async () => {
    const { api, settings, providers } = mount();
    await settings.refresh();
    await settings.refreshProviders();
    expect(q('#engCleanup em').textContent).toBe('계정 없음');
    const refreshedProviders = { ...providers, codex: { installed: true, loggedIn: true } };
    api.providers.mockResolvedValue(refreshedProviders);
    const refreshProviders = vi.spyOn(settings, 'refreshProviders');
    await click('#connRefresh');
    expect(refreshProviders).toHaveBeenCalledExactlyOnceWith(true);
    expect(api.providers).toHaveBeenLastCalledWith({ fresh: true });
    expect(settings.getSnapshot().providers).toBe(refreshedProviders);
    expect(q('#connAccounts').textContent).toContain('Codex로그인됨');
    expect(q('#engCleanup em').textContent).toBe('Codex');
    expect(q<HTMLInputElement>('#providers input[value="codex"]').disabled).toBe(false);
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


const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const capture = (selector: string) => q(selector).innerHTML;
type Mounted = ReturnType<typeof mount>;

const setupCases: SetupComponent[] = [
  { id: 'engine', name: '엔진', desc: '설명', installed: false, size: 9000000, removable: false },
  { id: 'zero', name: '빈 모델', desc: '', installed: false, size: 0, removable: true },
  { id: 'null', name: '크기 모름', desc: '', installed: false, size: null, removable: false, partial: true },
  { id: 'large', name: '회의 모델', desc: '설명', installed: true, size: 3100000000, removable: true },
  { id: 'brew', name: '설치 필요', desc: '', installed: false, size: 10, removable: false, blocker: 'brew' },
  { id: 'token', name: '토큰 필요', desc: '', installed: false, size: 1200000000, removable: false, blocker: 'token' },
  { id: 'failed', name: '실패', desc: '', installed: false, size: 20, removable: false, blocker: 'token', job: { error: '실패 & 재시도' } },
  { id: 'running', name: '설치 중', desc: '', installed: false, size: 30, removable: false, job: { running: true, pct: 0.426, text: '받는 중' } },
  { id: 'waiting', name: '기다림', desc: '', installed: true, size: 10, removable: true, job: { running: true } },
];

const scenarios: { name: string; run: (m: Mounted) => Promise<string[]> }[] = [
  { name: 'engine actions', run: async ({ api, settings }) => {
    await settings.refresh();
    const outputs: string[] = [];
    for (const state of ['ready', 'loading', 'stopped', 'no-engine', 'no-model', 'downloading', 'error', 'unknown']) {
      api.onDictEngine.mock.calls[0]![0]({ state, received: 10000000, total: 20000000, error: '실패' });
      outputs.push(capture('#engineActs'));
    }
    return outputs;
  } },
  { name: 'providers', run: async ({ api, settings, providers, saved }) => {
    await settings.refresh();
    const outputs: string[] = [];
    for (const provider of ['auto', 'claude-code', 'codex', 'api']) {
      saved.provider = provider;
      api.providers.mockResolvedValue({ ...providers,
        'claude-code': { installed: true, loggedIn: provider === 'claude-code', account: '<계정>' } as typeof providers['claude-code'],
        codex: { installed: provider !== 'auto', loggedIn: provider === 'codex' },
        api: { installed: provider !== 'codex', loggedIn: provider === 'api' },
      });
      await settings.refreshProviders();
      outputs.push(capture('#providers'));
    }
    return outputs;
  } },
  { name: 'usage', run: async ({ ui, api, settings, providers }) => {
    await settings.refresh();
    api.providers.mockResolvedValue({ ...providers, codex: { installed: true, loggedIn: true } });
    await settings.refreshProviders();
    const outputs = [capture('[data-usage="codex"]')];
    let resolve!: (value: Record<string, UsageResult>) => void;
    api.usage.mockImplementation(() => new Promise((done) => { resolve = done; }));
    ui.open('cleanup');
    await settle();
    outputs.push(capture('[data-usage="codex"]'));
    resolve({ codex: { ok: false, error: '<오류>' } });
    await settle();
    outputs.push(capture('[data-usage="codex"]'));
    q<HTMLButtonElement>('[data-usage="codex"] button').click();
    outputs.push(capture('[data-usage="codex"]'));
    resolve({ codex: { ok: true, fetchedAt: new Date(Date.now() - 120000).toISOString(), credits: '1234.9', via: 'llm', windows: [
      { kind: 'session', model: null, resetsAt: null, usedPercent: 81.4, resetsText: '2시간 뒤' },
      { kind: 'week', model: null, resetsText: null, usedPercent: 80, resetsAt: new Date(Date.now() + 3600000).toISOString() },
      { kind: 'model-week', model: '모델', resetsText: null, usedPercent: 103, resetsAt: new Date(Date.now() + 86400000).toISOString() },
      { kind: 'limit', model: null, resetsText: null, usedPercent: 0, resetsAt: new Date(Date.now() + 3 * 86400000).toISOString() },
    ] } });
    await settle();
    outputs.push(capture('[data-usage="codex"]'));
    q<HTMLButtonElement>('[data-usage="codex"] button').click();
    outputs.push(capture('[data-usage="codex"]'));
    resolve({ codex: { ok: true, fetchedAt: new Date().toISOString(), credits: 'unlimited', windows: [] } });
    await settle();
    outputs.push(capture('[data-usage="codex"]'));
    return outputs;
  } },
  { name: 'permissions', run: async ({ ui, api, settings, saved }) => {
    await settings.refresh();
    const outputs: string[] = [];
    for (const status of ['granted', 'unsupported', 'not-determined', 'unknown', 'denied']) {
      api.permStatus.mockResolvedValue({ microphone: status, inputMonitoring: status, accessibility: status, systemAudio: status });
      for (const required of [false, true]) {
        saved.meetingSystemAudio = required;
        await ui.refreshPermissions();
        outputs.push(capture('#permList'));
      }
    }
    return outputs;
  } },
  { name: 'setup components', run: async ({ ui, api, settings }) => {
    await settings.refresh();
    ui.open();
    const outputs: string[] = [];
    for (const list of [[], setupCases, setupCases.map((c) => ({ ...c, job: null }))]) {
      api.onSetup.mock.calls[0]![0](list);
      outputs.push(capture('#compList'));
    }
    return outputs;
  } },
  { name: 'accounts', run: async ({ api, settings, providers }) => {
    await settings.refresh();
    const outputs: string[] = [];
    for (const info of [{ installed: false, loggedIn: false }, { installed: true, loggedIn: false }, { installed: true, loggedIn: true }, { installed: true, loggedIn: true, account: '<계정>' }]) {
      api.providers.mockResolvedValue({ ...providers, 'claude-code': info, codex: info });
      await click('#connRefresh');
      outputs.push(capture('#connAccounts'));
    }
    return outputs;
  } },
];

describe('settings region DOM characterization', () => {
  it.each(scenarios)('$name', async ({ run }) => {
    vi.setSystemTime(new Date('2026-11-13T03:00:00Z'));
    const builder = vi.spyOn(sharedUi, 'el');
    expect(await run(mount())).toMatchSnapshot();
    expect(builder).not.toHaveBeenCalled();
  });
});

it('recreates every region on rebuild while keeping permission busy mutations on the current button', async () => {
  const { ui, api, settings, providers } = mount();
  await settings.refresh();
  const engine = q('#engineActs button');
  await settings.refresh();
  expect(q('#engineActs button')).not.toBe(engine);
  api.providers.mockResolvedValue({ ...providers, codex: { installed: true, loggedIn: true } });
  await settings.refreshProviders();
  const radio = q<HTMLInputElement>('input[value="codex"]');
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  await settle();
  expect(settings.getSnapshot().saved.provider).toBe('codex');
  await settings.refreshProviders();
  const nextRadio = q<HTMLInputElement>('input[value="codex"]');
  expect(nextRadio).not.toBe(radio);
  expect(nextRadio.checked).toBe(true);
  expect(nextRadio.hasAttribute('checked')).toBe(false);
  const usage = q('[data-usage="codex"] > div');
  ui.open('cleanup');
  await settle();
  expect(q('[data-usage="codex"] > div')).not.toBe(usage);
  await ui.refreshPermissions();
  const permission = q<HTMLButtonElement>('#permList button');
  let resolve!: (status: Record<string, string>) => void;
  api.permRequest.mockImplementation(() => new Promise((done) => { resolve = done; }));
  permission.click();
  expect(q('#permList button')).toBe(permission);
  expect(permission.className).toBe('btn small primary busy');
  expect(permission.textContent).toBe('기다리는 중…');
  expect(permission.disabled).toBe(false);
  expect(api.permRequest).toHaveBeenCalledExactlyOnceWith('microphone');
  resolve({ microphone: 'denied', inputMonitoring: 'granted', accessibility: 'granted', systemAudio: 'denied' });
  await settle();
  expect(q('#permList button')).not.toBe(permission);
  expect(q('#permList button').className).toBe('btn small primary');
  ui.open();
  const setup = api.onSetup.mock.calls[0]![0];
  setup(setupCases);
  const component = q('#compList .comp');
  setup(setupCases);
  expect(q('#compList .comp')).not.toBe(component);
  await click('#connRefresh');
  const account = q('#connAccounts .account');
  await click('#connRefresh');
  expect(q('#connAccounts .account')).not.toBe(account);
});

it('notifies permission issues after each appended row without resetting earlier busy buttons', async () => {
  const { ui, api, settings, issues, saved } = mount();
  await settings.refresh();
  saved.meetingSystemAudio = true;
  api.permStatus.mockResolvedValue({ microphone: 'denied', inputMonitoring: 'denied', accessibility: 'denied', systemAudio: 'denied' });
  api.permRequest.mockImplementation(() => new Promise(() => {}));
  const rowCounts: number[] = [];
  let first: HTMLButtonElement | undefined;
  issues.subscribe(() => {
    rowCounts.push(q('#permList').children.length);
    if (!first) {
      first = q<HTMLButtonElement>('#permList button');
      first.click();
    }
  });
  await ui.refreshPermissions();
  expect(rowCounts).toEqual([1, 2, 3, 4]);
  expect(q('#permList button')).toBe(first);
  expect(first!.textContent).toBe('기다리는 중…');
  expect(first!.className).toBe('btn small primary busy');
});

it('recreates usage children on the same host and ignores refresh while busy', async () => {
  const { api, settings, providers } = mount();
  await settings.refresh();
  api.providers.mockResolvedValue({ ...providers, codex: { installed: true, loggedIn: true } });
  await settings.refreshProviders();
  const host = q('[data-usage="codex"]');
  const first = host.firstChild;
  let resolve!: (value: Record<string, UsageResult>) => void;
  api.usage.mockImplementation(() => new Promise((done) => { resolve = done; }));
  const refresh = q<HTMLButtonElement>('[data-usage="codex"] button');
  refresh.click();
  expect(q('[data-usage="codex"]')).toBe(host);
  expect(host.firstChild).not.toBe(first);
  refresh.click();
  expect(api.usage).toHaveBeenCalledExactlyOnceWith({ force: true });
  resolve({ codex: { ok: true, fetchedAt: new Date().toISOString(), windows: [
    { kind: 'session', model: null, usedPercent: 90, resetsAt: null, resetsText: null },
  ] } });
  await settle();
  const previous = new Set(host.querySelectorAll('*'));
  q<HTMLButtonElement>('[data-usage="codex"] button').click();
  expect(q('[data-usage="codex"]')).toBe(host);
  expect([...host.querySelectorAll('*')].some((node) => previous.has(node))).toBe(false);
  expect(q<HTMLButtonElement>('[data-usage="codex"] button').disabled).toBe(true);
  q<HTMLButtonElement>('[data-usage="codex"] button').click();
  expect(api.usage).toHaveBeenCalledTimes(2);
  resolve({});
  await settle();
});

it('runs native engine and setup button actions with the original awaits and arguments', async () => {
  const { ui, api, settings, deps } = mount();
  await settings.refresh();
  q<HTMLButtonElement>('#engineActs button').click();
  expect(q('.set-tab[data-sec="engine"]').getAttribute('aria-current')).toBe('true');
  await settle();
  const setup = api.onSetup.mock.calls[0]![0];
  setup(setupCases);
  const rows = q('#compList').children;
  (rows[0]!.querySelector('button') as HTMLButtonElement).click();
  expect(api.setupInstall).toHaveBeenCalledExactlyOnceWith('engine');
  (rows[6]!.querySelector('button') as HTMLButtonElement).click();
  expect(api.setupInstall).toHaveBeenLastCalledWith('failed');
  (rows[4]!.querySelector('button') as HTMLButtonElement).click();
  expect(api.openExternal).toHaveBeenCalledExactlyOnceWith('https://brew.sh');
  deps.confirm.mockResolvedValueOnce(false);
  (rows[3]!.querySelector('button') as HTMLButtonElement).click();
  expect(api.setupRemove).not.toHaveBeenCalled();
  await settle();
  expect(api.setupRemove).not.toHaveBeenCalled();
  api.dictSettings.mockClear();
  (rows[3]!.querySelector('button') as HTMLButtonElement).click();
  expect(api.setupRemove).not.toHaveBeenCalled();
  await settle();
  expect(deps.confirm).toHaveBeenLastCalledWith('회의 모델을(를) 지울까요?', '3.1GB를 확보합니다. 필요하면 언제든 다시 받을 수 있습니다.', '지우기');
  expect(api.setupRemove).toHaveBeenCalledExactlyOnceWith('large');
  expect(deps.toast).toHaveBeenCalledWith('회의 모델을(를) 지웠습니다');
  expect(api.dictSettings).toHaveBeenCalledOnce();
  api.setupRemove.mockRejectedValueOnce(new Error('remove failed'));
  (rows[3]!.querySelector('button') as HTMLButtonElement).click();
  await settle();
  expect(deps.toast).toHaveBeenLastCalledWith('지우지 못했습니다', 'remove failed', { bad: true });
  (rows[5]!.querySelector('.link') as HTMLButtonElement).click();
  expect(q('.set-tab[data-sec="accounts"]').getAttribute('aria-current')).toBe('true');
  await settle();
  ui.open('engine');
  await settle();
  setup(setupCases);
  q<HTMLButtonElement>('#compList .comp-note.bad .link').click();
  expect(q('.set-tab[data-sec="accounts"]').getAttribute('aria-current')).toBe('true');
  await settle();
});
