// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { startOnboarding, type OnboardingCtx } from '../index.ts';

const q = <E extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<E>(selector)!;
const uses = { dictation: true, meetings: true };
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="shell"></div><div id="onboard" hidden></div>';
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(step: string) {
  const api = {
    onboardingSet: vi.fn(() => new Promise(() => {})),
    onboardingFnTest: vi.fn(),
    permStatus: vi.fn().mockResolvedValue({ microphone: 'granted', inputMonitoring: 'granted', accessibility: 'granted' }),
    fnKeyWarning: vi.fn().mockResolvedValue(false),
    focusApp: vi.fn(),
    setupStatus: vi.fn().mockResolvedValue([]),
    setupInstall: vi.fn(),
    tokenStatus: vi.fn().mockResolvedValue({ hf: { app: false, cli: false } }),
    saveToken: vi.fn().mockResolvedValue({ hf: { app: true } }),
    verifyToken: vi.fn().mockResolvedValue({ ok: false, message: '확인 실패' }),
    providers: vi.fn().mockResolvedValue({}),
  };
  const ctx: OnboardingCtx = {
    api: api as unknown as RecorderApi, toast: vi.fn(),
    setupListeners: new Set(), fnListeners: new Set(), tapListeners: new Set(),
    getMic: () => '', setMic: vi.fn(), onDone: vi.fn(),
  };
  startOnboarding(ctx, { step, uses: { dictation: false, meetings: false } });
  return { api, ctx };
}

describe('startOnboarding', () => {
  it('저장된 단계부터 시작하되 저장된 uses는 무시하고 잘못된 단계는 처음으로 돌아간다', async () => {
    const { api, ctx } = mount('token');
    await flush();
    expect(q('h1').textContent).toBe('화자 구분 준비');
    expect(q('.shell').hidden).toBe(true);
    expect(q('#onboard').hidden).toBe(false);
    expect(api.onboardingSet).toHaveBeenCalledWith({ step: 'token', uses, completed: false });
    expect(q('input').hasAttribute('spellcheck')).toBe(false);
    startOnboarding(ctx, { step: 'unknown' });
    expect(q('h1').textContent).toBe('Meeting Recorder를 시작합니다');
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'welcome', uses, completed: false });
  });

  it('다음·뒤로는 기다리지 않고 단계를 저장하며 권한 폴링과 focus 처리기를 정리한다', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const { api } = mount('permissions');
    await flush();
    const check = added.mock.calls.find(([event]) => event === 'focus')![1];
    await vi.advanceTimersByTimeAsync(999);
    expect(api.permStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.permStatus).toHaveBeenCalledTimes(2);
    q<HTMLButtonElement>('.ob-next').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'token', uses });
    expect(removed).toHaveBeenCalledWith('focus', check);
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event('focus'));
    expect(api.permStatus).toHaveBeenCalledTimes(2);
    q<HTMLButtonElement>('.ob-back').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'permissions', uses });
    await flush();
    q<HTMLButtonElement>('.ob-back').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'welcome', uses });
    expect(vi.getTimerCount()).toBe(0);
    expect(removed.mock.calls.filter(([event]) => event === 'focus')).toHaveLength(2);
  });

  it('엔진·fn·연습 구독은 떠날 때 지우고 fn 확인 모드도 끝낸다', async () => {
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const { api, ctx } = mount('engine');
    await flush();
    expect(ctx.setupListeners.size).toBe(1);
    ctx.setupListeners.forEach((listener) => listener([
      { id: 'engine', name: '엔진', desc: '설명', installed: true, size: null, removable: false },
    ]));
    expect(q('.ob-comps').textContent).toContain('엔진');
    q<HTMLButtonElement>('.ob-next').click();
    expect(ctx.setupListeners.size).toBe(0);
    await flush();
    startOnboarding(ctx, { step: 'fnkey' });
    expect(ctx.fnListeners.size).toBe(1);
    expect(api.onboardingFnTest).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(11999);
    expect(document.querySelector('.ob-result.bad')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(q('.ob-result.bad').textContent).toContain('키를 알아채지 못했습니다');
    ctx.fnListeners.forEach((listener) => listener({ down: true }));
    expect(q('.ob-key.fn').classList.contains('down')).toBe(true);
    q<HTMLButtonElement>('.ob-next').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'practice', uses });
    expect(api.onboardingFnTest).toHaveBeenLastCalledWith(false);
    expect(ctx.fnListeners.size).toBe(0);
    expect(ctx.tapListeners.size).toBe(1);
    await flush();
    ctx.tapListeners.forEach((listener) => listener());
    expect(q('.ob-result.bad').textContent).toContain('톡 누르지 말고');
    await flush();
    q<HTMLButtonElement>('.ob-back').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'fnkey', uses });
    expect(ctx.tapListeners.size).toBe(0);
    for (const ms of [12000, 10000, 15000]) {
      const index = scheduled.mock.calls.findIndex(([, delay]) => delay === ms);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(cleared).toHaveBeenCalledWith(scheduled.mock.results[index]!.value);
    }
  });

  it('완료 payload를 저장한 뒤 본 화면을 즉시 보여 주고 onDone을 부른다', async () => {
    const now = new Date('2026-11-13T00:00:00Z');
    vi.setSystemTime(now);
    const { api, ctx } = mount('done');
    await flush();
    vi.mocked(ctx.onDone).mockImplementation(() => {
      expect(q('#onboard').hidden).toBe(true);
      expect(q('.shell').hidden).toBe(false);
    });
    q<HTMLButtonElement>('.ob-next').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ completed: true, step: 'done', uses, completedAt: now });
    expect(ctx.onDone).toHaveBeenCalledExactlyOnceWith(uses);
  });

  it('마이크 옵션 배열은 글자로 붙고 20초 뒤 계속할 수 있으며 떠나면 마이크를 닫는다', async () => {
    const stop = vi.fn();
    const close = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
    vi.stubGlobal('navigator', { mediaDevices: {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: '기본' },
        { kind: 'audioinput', deviceId: 'wired', label: '내장' },
        { kind: 'audioinput', deviceId: 'bt', label: 'AirPods' },
        { kind: 'audiooutput', deviceId: 'out', label: '스피커' },
      ]), getUserMedia,
    } });
    vi.stubGlobal('AudioContext', class {
      close = close;
      createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: vi.fn() }; }
      createMediaStreamSource() { return { connect: vi.fn() }; }
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    const { ctx } = mount('mic');
    await flush();
    const select = q<HTMLSelectElement>('select');
    expect(select.innerHTML).toBe('<option value="">시스템 기본값</option>[object HTMLOptionElement],[object HTMLOptionElement]');
    expect(select.options).toHaveLength(1);
    expect(select.childNodes[1]!.nodeType).toBe(Node.TEXT_NODE);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await vi.advanceTimersByTimeAsync(19999);
    expect(q<HTMLButtonElement>('.ob-next').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(q<HTMLButtonElement>('.ob-next').disabled).toBe(false);
    expect(q('.ob-result').textContent).toContain('소리가 들리지 않습니다');
    expect(q('select')).toBe(select);
    select.dispatchEvent(new Event('change'));
    await flush();
    expect(ctx.setMic).toHaveBeenCalledWith('');
    expect(stop).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>('.ob-next').click();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('연습은 공백이 아닌 입력이면 성공하고 같은 입력칸과 값을 유지한다', async () => {
    const { api, ctx } = mount('practice');
    await flush();
    const area = q<HTMLTextAreaElement>('textarea');
    area.value = ' \n ';
    area.dispatchEvent(new Event('input'));
    expect(q<HTMLButtonElement>('.ob-next').disabled).toBe(true);
    area.blur();
    await vi.advanceTimersByTimeAsync(10000);
    expect(q('.ob-result.bad').textContent).toBe('입력칸을 먼저 클릭하세요.');
    await vi.advanceTimersByTimeAsync(5000);
    expect(q('.ob-actions .ghost').textContent).toBe('건너뛰기');
    area.value = '  직접 입력한 글  ';
    area.dispatchEvent(new Event('input'));
    expect(q('h1').textContent).toBe('잘 됩니다!');
    expect(q('textarea')).toBe(area);
    expect(area.value).toBe('  직접 입력한 글  ');
    expect(q<HTMLButtonElement>('.ob-next').disabled).toBe(false);
    q<HTMLButtonElement>('.ob-next').click();
    expect(api.onboardingSet).toHaveBeenLastCalledWith({ step: 'done', uses });
    expect(ctx.tapListeners.size).toBe(0);
    await flush();
    expect(q('h1').textContent).toBe('준비됐습니다');
  });

  it('HF 저장 뒤에도 ready는 바뀌지 않고 실행 중 다시 시작하면 구독이 하나 더 생긴다', async () => {
    const { api, ctx } = mount('token');
    await flush();
    q<HTMLInputElement>('input').value = '  hf_token  ';
    q<HTMLButtonElement>('.key-row button').click();
    await flush();
    expect(api.saveToken).toHaveBeenCalledWith('hf', 'hf_token');
    expect(q('.ob-result').textContent).toBe('확인 실패');
    expect(q('#onboard').textContent).not.toContain('지금 토큰 확인');
    startOnboarding(ctx, { step: 'fnkey' });
    startOnboarding(ctx, { step: 'fnkey' });
    expect(ctx.fnListeners.size).toBe(2);
    expect(vi.getTimerCount()).toBe(2);
  });
});
