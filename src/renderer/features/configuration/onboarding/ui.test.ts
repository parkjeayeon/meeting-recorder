// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { startOnboarding, type OnboardingCtx } from '../index.ts';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const flush = () => vi.advanceTimersByTimeAsync(0);
const html = () => q('#onboard').innerHTML;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="shell"></div><div id="onboard" hidden></div>';
  vi.stubGlobal('navigator', { mediaDevices: {
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: '기본' },
      { kind: 'audioinput', deviceId: 'wired', label: '내장' },
      { kind: 'audioinput', deviceId: 'bt', label: 'AirPods' },
    ]),
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  } });
  vi.stubGlobal('AudioContext', class {
    close = vi.fn();
    createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: vi.fn() }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(step: string, initialMic = '') {
  const api = {
    onboardingSet: vi.fn(), onboardingFnTest: vi.fn(), focusApp: vi.fn(),
    permStatus: vi.fn().mockResolvedValue({ microphone: 'denied', inputMonitoring: 'denied', accessibility: 'denied' }),
    permRequest: vi.fn().mockResolvedValue({ microphone: 'granted', inputMonitoring: 'denied', accessibility: 'denied' }),
    fnKeyWarning: vi.fn().mockResolvedValue(true), openKeyboardSettings: vi.fn(), openExternal: vi.fn(),
    setupStatus: vi.fn().mockResolvedValue([
      { id: 'engine', name: '엔진', desc: '설명', installed: true, size: null, removable: false },
      { id: 'turbo', name: 'Turbo', desc: '받아쓰기', installed: false, size: 900000000, removable: true, job: { running: true, pct: 0.42, text: '받는 중' } },
      { id: 'large', name: 'Large', desc: '회의', installed: false, size: 3100000000, removable: true, job: { running: true } },
      { id: 'diarize', name: '화자 구분', desc: '화자', installed: false, size: 1200000000, removable: true, blocker: 'token' },
    ]), setupInstall: vi.fn(),
    tokenStatus: vi.fn().mockResolvedValue({ hf: { app: true, cli: false } }),
    saveToken: vi.fn().mockResolvedValue({}),
    verifyToken: vi.fn().mockResolvedValue({ ok: false, message: '확인 실패' }),
    providers: vi.fn().mockResolvedValue({ 'claude-code': { installed: true, loggedIn: false }, codex: { installed: false, loggedIn: false } }),
  };
  const ctx: OnboardingCtx = {
    api: api as unknown as RecorderApi, toast: vi.fn(), setupListeners: new Set(), fnListeners: new Set(), tapListeners: new Set(),
    getMic: () => initialMic, setMic: vi.fn(), onDone: vi.fn(),
  };
  startOnboarding(ctx, { step });
  return { api, ctx };
}

describe('onboarding HTML characterization', () => {
  for (const step of ['welcome', 'permissions', 'token', 'engine', 'account', 'mic', 'fnkey', 'practice', 'done']) {
    it(step === 'mic' ? '마이크 장치를 실제 옵션으로 표시한다' : step, async () => {
      mount(step);
      await flush();
      expect(html()).toMatchSnapshot();
      expect(document.querySelector('[spellcheck]')).toBeNull();
    });
  }

  it('permission request redraw', async () => {
    mount('permissions');
    await flush();
    q<HTMLButtonElement>('.ob-perm.active button').click();
    await flush();
    expect(html()).toMatchSnapshot();
  });

  it('token verification preserves input and result through redraw', async () => {
    const { api } = mount('token');
    await flush();
    let resolve!: (r: { ok: boolean; message: string }) => void;
    api.verifyToken.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const input = q<HTMLInputElement>('input');
    const result = q('.ob-result');
    input.value = 'hf_saved';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(api.saveToken).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    input.value = 'unfinished draft';
    input.focus();
    input.setSelectionRange(2, 7);
    q('.ob-main').scrollTop = 83;
    expect(result.textContent).toBe('확인 중…');
    expect(document.activeElement).toBe(input);
    expect(q('.ob-main').scrollTop).toBe(83);
    resolve({ ok: false, message: '확인 실패' });
    await flush();
    expect(q('input')).toBe(input);
    expect(q('.ob-result')).toBe(result);
    expect(input.value).toBe('unfinished draft');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 7]);
    expect(document.activeElement).not.toBe(input);
    expect(q('.ob-main').scrollTop).toBe(0);
    expect(html()).toMatchSnapshot();
  });

  it('practice completion preserves value and blurs synchronously', async () => {
    mount('practice');
    await flush();
    const area = q<HTMLTextAreaElement>('textarea');
    area.focus();
    area.value = '말한 내용';
    q('.ob-main').scrollTop = 91;
    area.dispatchEvent(new Event('input'));
    expect(q('textarea')).toBe(area);
    expect(area.value).toBe('말한 내용');
    expect(document.activeElement).not.toBe(area);
    expect(q('.ob-main').scrollTop).toBe(0);
    expect(html()).toMatchSnapshot();
  });
});

describe('onboarding control lifetime', () => {
  it('account verification mutates the result without draw effects; recheck starts a new activation', async () => {
    const { api } = mount('account');
    await flush();
    let resolve!: (r: { ok: boolean; message: string }) => void;
    api.verifyToken.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const input = q<HTMLInputElement>('input');
    const result = q('.ob-result');
    input.value = 'sk-ant-key';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }));
    expect(api.saveToken).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    input.value = 'next key';
    input.focus();
    input.setSelectionRange(2, 5);
    q('.ob-main').scrollTop = 72;
    resolve({ ok: true, message: '확인됨' });
    await flush();
    expect(result.textContent).toBe('확인됨');
    expect(q('input')).toBe(input);
    expect(q('.ob-result')).toBe(result);
    expect(input.value).toBe('next key');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(document.activeElement).toBe(input);
    expect(q('.ob-main').scrollTop).toBe(72);
    q<HTMLButtonElement>('.ob-actions .ghost').click();
    await flush();
    expect(q('input')).not.toBe(input);
    expect(q<HTMLInputElement>('input').value).toBe('');
    expect(q('.ob-result').textContent).toBe('');
  });

  it('저장된 마이크 선택값을 복원하고 변경·다시 그리기 뒤에도 컨트롤과 선택값을 유지한다', async () => {
    const { ctx } = mount('mic', 'wired');
    await flush();
    const select = q<HTMLSelectElement>('select');
    const bars = q('.ob-meter');
    const note = q('.ob-result');
    expect(select.innerHTML).toBe('<option value="">시스템 기본값</option><option value="wired">내장</option><option value="bt">AirPods</option>');
    expect(select.value).toBe('wired');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'wired' } } });
    select.value = 'bt';
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(ctx.setMic).toHaveBeenCalledWith('bt');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'bt' } } });
    select.focus();
    q('.ob-main').scrollTop = 63;
    const tick = vi.mocked(requestAnimationFrame).mock.calls[0]![0];
    tick(0);
    expect(document.activeElement).toBe(select);
    expect(q('.ob-main').scrollTop).toBe(63);
    await vi.advanceTimersByTimeAsync(20000);
    expect(q('select')).toBe(select);
    expect(q('.ob-meter')).toBe(bars);
    expect(q('.ob-content .ob-result:last-child')).toBe(note);
    expect(note.textContent).toContain('소리가 들리지 않습니다');
    expect(select.value).toBe('bt');
    expect(select.selectedOptions[0]!.textContent).toBe('AirPods');
    expect(q('.ob-main').scrollTop).toBe(0);
    expect(document.activeElement).not.toBe(select);
  });

  it('마이크 장치가 없으면 빈 텍스트 노드 없이 시스템 기본값 옵션만 표시한다', async () => {
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValue([]);
    mount('mic');
    await flush();
    const select = q<HTMLSelectElement>('select');
    expect(select.innerHTML).toBe('<option value="">시스템 기본값</option>');
    expect(select.childNodes).toHaveLength(1);
    expect(select.options).toHaveLength(1);
    expect(select.value).toBe('');
    await vi.advanceTimersByTimeAsync(20000);
    expect(q('select')).toBe(select);
    expect(select.childNodes).toHaveLength(1);
    expect(select.value).toBe('');
  });

  it('blur and scroll reset apply to non-input controls on fn redraw', () => {
    const { ctx } = mount('fnkey');
    const back = q<HTMLButtonElement>('.ob-back');
    back.focus();
    q('.ob-main').scrollTop = 39;
    ctx.fnListeners.forEach((listener) => listener({ down: true }));
    expect(document.activeElement).not.toBe(back);
    expect(q('.ob-main').scrollTop).toBe(0);
    expect(q('.ob-key.fn').className).toBe('ob-key fn down ok');
  });

  it('다시 시작한 뒤 이전 토큰 확인 응답이 늦게 와도 현재 화면을 다시 그리지 않는다', async () => {
    const { api, ctx } = mount('token');
    await flush();
    let resolve!: (r: { ok: boolean; message: string }) => void;
    api.verifyToken.mockImplementation(() => new Promise((r) => { resolve = r; }));
    q<HTMLInputElement>('input').value = 'hf_token';
    q<HTMLButtonElement>('.key-row button').click();
    await flush();
    q<HTMLInputElement>('input').value = 'draft';
    startOnboarding(ctx, { step: 'fnkey' });
    expect(q('h1').textContent).toBe('fn 키를 눌러 보세요');
    const currentTitle = q('h1');
    const currentHtml = html();
    const back = q<HTMLButtonElement>('.ob-back');
    back.focus();
    q('.ob-main').scrollTop = 45;
    resolve({ ok: false, message: '이전 확인 완료' });
    await flush();
    expect(q('h1')).toBe(currentTitle);
    expect(html()).toBe(currentHtml);
    expect(document.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(back);
    expect(q('.ob-main').scrollTop).toBe(45);
    ctx.fnListeners.forEach((listener) => listener({ down: true }));
    expect(q('h1').textContent).toBe('fn 키를 눌러 보세요');
    expect(q('.ob-key.fn').className).toBe('ob-key fn down ok');
  });

  it('다시 시작하면 이전 마이크와 타이머를 정리하고 늦은 프레임도 화면을 그리지 않는다', async () => {
    const stop = vi.fn();
    const close = vi.fn();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    vi.stubGlobal('AudioContext', class {
      close = close;
      createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: vi.fn() }; }
      createMediaStreamSource() { return { connect: vi.fn() }; }
    });
    const { ctx } = mount('mic');
    await flush();
    const tick = vi.mocked(requestAnimationFrame).mock.calls[0]![0];
    expect(vi.getTimerCount()).toBe(1);
    startOnboarding(ctx, { step: 'welcome' });
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const currentTitle = q('h1');
    const currentHtml = html();
    vi.mocked(requestAnimationFrame).mockClear();
    tick(0);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(q('h1').textContent).toBe('Meeting Recorder를 시작합니다');
    await vi.advanceTimersByTimeAsync(20000);
    expect(q('h1')).toBe(currentTitle);
    expect(html()).toBe(currentHtml);
    expect(document.querySelector('select')).toBeNull();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
