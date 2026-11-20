// @vitest-environment jsdom
// 설정 창의 칸(역할) 시험: 칸 하나를 작은 가짜 맥락으로. 창 전체의 구독 차례·HTML은 controller.test.ts가 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../../index.html?raw';
import { createIssueStore } from '../../../entities/issue/index.ts';
import type { Settings, SettingsStore } from '../../../entities/settings/index.ts';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { mountReact } from '../../../shared/page-host/index.tsx';
import { createDialog } from './dialog.ts';
import { createMeeting } from './meeting.ts';
import { createPermissions } from './permissions.ts';
import { createSetup } from './setup.ts';
import type { SettingsCtx } from './state.ts';
import { createStatus } from './status.ts';
import { SettingsDialogBody } from './ui.tsx';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const dialog = q<HTMLDialogElement>('#settings');
  dialog.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  dialog.close = function () { this.open = false; };
  mountReact(dialog, SettingsDialogBody, {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const saved = { enabled: true, language: 'ko', meetingLanguage: null, cleanup: true, provider: 'auto', minutes: true, diarize: true, diarizeReady: true, hasHfToken: true, meetingSystemAudio: false, engine: { state: 'ready' } };

function fakeCtx(api: Record<string, unknown> = {}, snapshot: Record<string, unknown> = { saved, providers: null }) {
  const settingsStore = {
    getSnapshot: vi.fn(() => snapshot), refresh: vi.fn().mockResolvedValue(undefined), refreshProviders: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(), connect: vi.fn(),
  };
  const issues = createIssueStore();
  const openSettings = vi.fn();
  const ctx: SettingsCtx = {
    api: api as unknown as RecorderApi, settingsStore: settingsStore as unknown as SettingsStore, issues, toast: vi.fn(),
    dialog: q<HTMLDialogElement>('#settings'), openSettings,
  };
  return { ctx, settingsStore, issues, openSettings };
}

describe('dialog (창 틀)', () => {
  function dialogRole(api: Record<string, unknown> = {}) {
    const { ctx, settingsStore } = fakeCtx({ setupStatus: vi.fn().mockResolvedValue(['목록']), ...api });
    const sections = {
      permissions: { render: vi.fn() }, setup: { render: vi.fn() }, cleanup: { loadUsage: vi.fn() }, accounts: { render: vi.fn() },
    };
    const deps = { closePalette: vi.fn(), rerunOnboarding: vi.fn() };
    return { role: createDialog(ctx, deps, sections), sections, deps, settingsStore, ctx };
  }

  it('열면 ⌘K를 닫고 고른 탭만 보이며, 이미 열려 있으면 다시 띄우지 않는다', () => {
    const { role, deps, ctx } = dialogRole();
    role.open();
    expect(deps.closePalette).toHaveBeenCalledOnce();
    expect(q('.set-tab[data-sec="general"]').getAttribute('aria-current')).toBe('true');
    expect([...document.querySelectorAll<HTMLElement>('.set-sec')].filter((s) => !s.hidden).map((s) => s.dataset.sec)).toEqual(['general']);
    role.open('perms');
    expect(ctx.dialog.showModal).toHaveBeenCalledOnce();
    expect(q('.set-tab[data-sec="general"]').getAttribute('aria-current')).toBe('false');
  });

  it('칸을 열 때 그 칸만 새로 읽는다 — 엔진은 목록을 받은 뒤, 다듬기는 계정을 새로 읽은 뒤 사용량, 계정은 결과 줄을 비우고', async () => {
    const { role, sections, settingsStore } = dialogRole();
    role.open('perms');
    expect(sections.permissions.render).toHaveBeenCalledOnce();
    role.open('engine');
    expect(sections.setup.render).not.toHaveBeenCalled();
    await settle();
    expect(sections.setup.render).toHaveBeenCalledWith(['목록']);
    role.open('cleanup');
    expect(settingsStore.refreshProviders).toHaveBeenCalledWith(true);
    expect(sections.cleanup.loadUsage).not.toHaveBeenCalled();
    await settle();
    expect(sections.cleanup.loadUsage).toHaveBeenCalledOnce();
    q('[data-result]').textContent = '저장했습니다.';
    role.open('accounts');
    expect(q('[data-result]').textContent).toBe('');
    expect(sections.accounts.render).toHaveBeenCalledOnce();
    expect(sections.permissions.render).toHaveBeenCalledOnce();
  });

  it("'다시 보기'는 창을 닫은 뒤 처음 설정을 다시 시작한다", () => {
    const { role, deps, ctx } = dialogRole();
    role.wire();
    role.open();
    deps.rerunOnboarding.mockImplementation(() => expect(ctx.dialog.open).toBe(false));
    q('#rerunOnboarding').click();
    expect(deps.rerunOnboarding).toHaveBeenCalledOnce();
  });
});

describe('meeting (회의 칸의 화자 구분)', () => {
  it.each([
    ['엔진 없음', { diarize: true, diarizeReady: false, hasHfToken: true }, 'bad', '설치 필요', false],
    ['토큰 없음', { diarize: true, diarizeReady: true, hasHfToken: false }, 'bad', '토큰 필요', true],
    ['준비됨', { diarize: true, diarizeReady: true, hasHfToken: true }, 'ok', '준비됨', false],
    ['끔', { diarize: false, diarizeReady: true, hasHfToken: false }, '', '꺼짐', false],
  ])('%s → 왼쪽 아래 표시와 토큰 알림', (_name, over, state, text, issue) => {
    const { ctx, issues, openSettings } = fakeCtx();
    createMeeting(ctx, { render: vi.fn() }).applySaved({ ...saved, ...over } as unknown as Settings);
    expect(q('#engDiarize').className).toBe(`engine ${state}`);
    expect(q('#engDiarize em').textContent).toBe(text);
    expect(Boolean(issues.get('hf'))).toBe(issue);
    if (issue) {
      issues.get('hf')!.onAction!();
      expect(openSettings).toHaveBeenCalledWith('accounts');
    }
  });

  it('화상 회의 소리를 바꾸면 저장을 기다린 뒤 권한 칸을 다시 그린다', async () => {
    const { ctx, settingsStore } = fakeCtx();
    let resolve!: () => void;
    settingsStore.save.mockImplementation(() => new Promise<void>((r) => { resolve = r; }));
    const permissions = { render: vi.fn() };
    createMeeting(ctx, permissions).wire();
    const box = q<HTMLInputElement>('#meetingSystem');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(settingsStore.save).toHaveBeenCalledWith({ meetingSystemAudio: true });
    expect(permissions.render).not.toHaveBeenCalled();
    resolve();
    await settle();
    expect(permissions.render).toHaveBeenCalledOnce();
  });
});

describe('status (왼쪽 아래 다듬기 표시)', () => {
  const providers = { 'claude-code': { installed: true, loggedIn: false }, codex: { installed: true, loggedIn: true }, api: { installed: true, loggedIn: true } };
  it.each([
    ['다듬기 끔', { cleanup: false }, providers, '꺼짐', ''],
    ['고른 계정', { provider: 'api' }, providers, 'API', 'ok'],
    ['자동은 로그인된 첫 계정', {}, providers, 'Codex', 'ok'],
    ['자동인데 로그인된 계정 없음', {}, { ...providers, codex: { installed: true, loggedIn: false }, api: { installed: false, loggedIn: false } }, '계정 없음', 'bad'],
  ])('%s → %s', (_name, over, p, label, state) => {
    const { ctx, issues } = fakeCtx({}, { saved: { ...saved, ...over }, providers: p });
    createStatus(ctx).renderSideCleanup();
    expect(q('#engCleanup em').textContent).toBe(label);
    expect(q('#engCleanup').className).toBe(`engine ${state}`);
    expect(Boolean(issues.get('cleanup'))).toBe(label === '계정 없음');
  });

  it('설정이나 계정을 아직 안 읽었으면 아무것도 바꾸지 않는다', () => {
    const { ctx, issues } = fakeCtx({}, { saved, providers: null });
    const before = q('#engCleanup').outerHTML;
    createStatus(ctx).renderSideCleanup();
    expect(q('#engCleanup').outerHTML).toBe(before);
    expect(issues.get('cleanup')).toBeUndefined();
  });
});

describe('setup (엔진 설치)', () => {
  const comp = (over: object) => ({ id: 'turbo', name: 'Turbo', desc: '', installed: false, size: 10, removable: true, ...over });

  it('설치가 돌다 끝난 그리기에서만 설정을 한 번 다시 읽는다', () => {
    const { ctx, settingsStore } = fakeCtx({ setupInstall: vi.fn(), openExternal: vi.fn() });
    const setup = createSetup(ctx, { confirm: vi.fn() });
    setup.render([comp({})]);
    setup.render([comp({ job: { running: true } })]);
    setup.render([comp({ job: { running: true } })]);
    expect(settingsStore.refresh).not.toHaveBeenCalled();
    setup.render([comp({ installed: true })]);
    expect(settingsStore.refresh).toHaveBeenCalledOnce();
    setup.render([comp({ installed: true })]);
    expect(settingsStore.refresh).toHaveBeenCalledOnce();
  });

  it('설치 알림은 창이 열렸을 때만 목록을 그리고, 같이 듣는 쪽에게는 그린 다음에 준다', () => {
    let onSetup!: (list: unknown[]) => void;
    const { ctx } = fakeCtx({ onSetup: vi.fn((fn) => { onSetup = fn; }), setupInstall: vi.fn(), openExternal: vi.fn() });
    const setup = createSetup(ctx, { confirm: vi.fn() });
    setup.listen();
    const seen = vi.fn(() => q('#compList').children.length);
    setup.setupListeners.add(seen);
    onSetup([comp({})]);
    expect(seen.mock.results[0]!.value).toBe(0);
    expect(q('#engineDot').hidden).toBe(false);
    ctx.dialog.open = true;
    onSetup([comp({})]);
    expect(seen.mock.results[1]!.value).toBe(1);
  });
});

describe('permissions (권한 칸)', () => {
  it('3초 확인은 창이 보일 때만, 본체 알림은 언제나 다시 읽는다', async () => {
    let changed!: () => void;
    const api = { permStatus: vi.fn().mockResolvedValue({ microphone: 'granted', inputMonitoring: 'granted', accessibility: 'granted', systemAudio: 'granted' }), onPermChanged: vi.fn((fn) => { changed = fn; }) };
    const { ctx } = fakeCtx(api);
    const role = createPermissions(ctx);
    expect(vi.getTimerCount()).toBe(0); // 만들 때는 붙이지 않는다
    role.listen();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.permStatus).not.toHaveBeenCalled();
    changed();
    expect(api.permStatus).toHaveBeenCalledOnce();
    visibility.mockReturnValue('visible');
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.permStatus).toHaveBeenCalledTimes(2);
  });

  it('시스템 오디오는 화상 회의 소리를 켰을 때만 알림을 낸다', async () => {
    const status = { microphone: 'granted', inputMonitoring: 'granted', accessibility: 'granted', systemAudio: 'denied' };
    const snapshot = { saved: { ...saved, meetingSystemAudio: false }, providers: null };
    const { ctx, issues } = fakeCtx({ permStatus: vi.fn() }, snapshot);
    const role = createPermissions(ctx);
    await role.render(status);
    expect(issues.get('perm:systemAudio')).toBeUndefined();
    expect(q('#permList').textContent).toContain('화상 회의 녹음을 켤 때만 필요');
    snapshot.saved = { ...saved, meetingSystemAudio: true };
    await role.render(status);
    expect(issues.get('perm:systemAudio')?.sec).toBe('perms');
  });
});
