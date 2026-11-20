// @vitest-environment jsdom
// 처음 설정의 역할 시험: 단계 이동·저장(flow)과 단계 모듈을 작은 가짜 맥락으로. 화면 전체는 controller.test.ts·ui.test.ts가 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderApi } from '../../../shared/api/index.ts';
import { startOnboarding } from '../index.ts';
import { engine } from './engine.ts';
import { createFlow } from './flow.ts';
import { fnkey } from './fnkey.ts';
import { mic } from './mic.ts';
import { permissions } from './permissions.ts';
import { practice } from './practice.ts';
import type { StepCtx, Uses } from './state.ts';
import type { Frame, StepId } from './view.ts';

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 단계 하나를 띄울 가짜 맥락: 그린 틀을 모으고, 타이머·정리는 진짜 flow처럼 떠날 때 지운다 */
function fakeStep(api: Record<string, unknown>, step: StepId) {
  let current: StepId = step;
  let cleanup: (() => void)[] = [];
  const frames: Frame[] = [];
  let instance = 0;
  const ctx: StepCtx = {
    api: api as unknown as RecorderApi, toast: vi.fn(),
    setupListeners: new Set(), fnListeners: new Set(), tapListeners: new Set(),
    getMic: () => '', setMic: vi.fn(), onDone: vi.fn(),
    uses: { dictation: true, meetings: true },
    stepId: () => current,
    instance: () => ++instance,
    frame: (view) => void frames.push(view),
    next: vi.fn(),
    finish: vi.fn(),
    every: (fn, ms) => {
      const t = setInterval(fn, ms);
      cleanup.push(() => clearInterval(t));
    },
    later: (fn, ms) => {
      const t = setTimeout(fn, ms);
      cleanup.push(() => clearTimeout(t));
    },
    onLeave: (fn) => void cleanup.push(fn),
  };
  const leave = (to: StepId) => {
    cleanup.forEach((fn) => fn());
    cleanup = [];
    current = to;
  };
  return { ctx, frames, leave, last: () => frames.at(-1)! };
}

describe('flow (단계 이동·저장·정리)', () => {
  function flow(uses: Uses, first: StepId = 'welcome') {
    const order: string[] = [];
    const api = { onboardingSet: vi.fn((v: { step: string }) => void order.push(`save:${v.step}`)) };
    const show = vi.fn();
    const enter = vi.fn((id: StepId) => void order.push(`enter:${id}`));
    return { f: createFlow({ api: api as unknown as RecorderApi, uses, show, first, enter }), api, show, enter, order };
  }

  it('이동은 앞 단계를 정리하고, 단계를 저장한 뒤에 새 단계를 그린다', () => {
    const { f, order } = flow({ dictation: true, meetings: true });
    f.onLeave(() => order.push('leave'));
    f.go('mic');
    expect(order).toEqual(['leave', 'save:mic', 'enter:mic']);
    expect(f.stepId()).toBe('mic');
  });

  it('다음·뒤로는 쓰지 않는 단계를 건너뛰고 끝에서는 멈춘다', () => {
    const { f, api } = flow({ dictation: false, meetings: false }, 'permissions');
    f.next();
    expect(f.stepId()).toBe('engine'); // 토큰(회의록용)을 건너뜀
    f.go('mic');
    f.next();
    expect(f.stepId()).toBe('done'); // fn 확인·연습(받아쓰기용)을 건너뜀
    api.onboardingSet.mockClear();
    f.next();
    expect(api.onboardingSet).not.toHaveBeenCalled();
    f.back();
    expect(f.stepId()).toBe('mic');
    f.go('welcome');
    api.onboardingSet.mockClear();
    f.back();
    expect(api.onboardingSet).not.toHaveBeenCalled();
  });

  it('쓰지 않는 단계에서 그리면 처음으로 돌아간다', () => {
    const { f, enter } = flow({ dictation: false, meetings: true }, 'practice');
    f.render();
    expect(f.stepId()).toBe('welcome');
    expect(enter).toHaveBeenLastCalledWith('welcome');
  });

  it('떠나면 반복·한 번 타이머를 모두 지우고, 밀려난 뒤에는 늦게 온 그리기를 하지 않는다', () => {
    const { f, show } = flow({ dictation: true, meetings: true }, 'engine');
    const tick = vi.fn();
    f.every(tick, 1000);
    f.later(tick, 5000);
    expect(vi.getTimerCount()).toBe(2);
    f.frame({ instance: 1, title: '', lead: '', body: { kind: 'welcome' }, primary: { label: '', onclick: () => {} } });
    expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0]![0]).toMatchObject({ at: 2, sections: ['시작', '권한', '설치', '확인', '연습'] });
    f.stop();
    expect(vi.getTimerCount()).toBe(0);
    f.frame({ instance: 1, title: '', lead: '', body: { kind: 'welcome' }, primary: { label: '', onclick: () => {} } });
    expect(show).toHaveBeenCalledOnce();
    expect(tick).not.toHaveBeenCalled();
  });

  it('처음 단계(welcome)와 canBack: false에는 뒤로가 없다', () => {
    const { f, show } = flow({ dictation: true, meetings: true }, 'welcome');
    const view = { instance: 1, title: '', lead: '', body: { kind: 'welcome' as const }, primary: { label: '', onclick: () => {} } };
    f.frame(view);
    expect(show.mock.calls[0]![0].back).toBeNull();
    f.go('mic');
    f.frame(view);
    expect(show.mock.calls[1]![0].back).toBe(f.back);
    f.frame({ ...view, canBack: false });
    expect(show.mock.calls[2]![0].back).toBeNull();
  });
});

describe('startOnboarding — 늦게 온 응답', () => {
  it('새로 시작한 처음 설정에 밀려난 단계의 늦은 응답은 그리지 않는다', async () => {
    document.body.innerHTML = '<div class="shell"></div><div id="onboard" hidden></div>';
    let resolve!: (v: unknown) => void;
    const api = {
      onboardingSet: vi.fn(), tokenStatus: vi.fn(() => new Promise((r) => { resolve = r; })),
    };
    const ctx = {
      api: api as unknown as RecorderApi, toast: vi.fn(), setupListeners: new Set(), fnListeners: new Set(), tapListeners: new Set(),
      getMic: () => '', setMic: vi.fn(), onDone: vi.fn(),
    } as Parameters<typeof startOnboarding>[0];
    startOnboarding(ctx, { step: 'token' });
    startOnboarding(ctx, { step: 'welcome' });
    expect(document.querySelector('h1')!.textContent).toBe('Meeting Recorder를 시작합니다');
    resolve({ hf: { app: true, cli: false } });
    await flush();
    expect(document.querySelector('h1')!.textContent).toBe('Meeting Recorder를 시작합니다');
  });
});

describe('permissions (권한 확인 반복)', () => {
  const granted = { microphone: 'granted', inputMonitoring: 'granted', accessibility: 'granted' };
  const denied = { microphone: 'denied', inputMonitoring: 'denied', accessibility: 'denied' };

  it('첫 그리기 뒤에 1초 확인과 focus를 붙이고, 새로 허용되면 창을 앞으로, 떠나면 둘 다 뗀다', async () => {
    const api = { permStatus: vi.fn().mockResolvedValue(denied), fnKeyWarning: vi.fn().mockResolvedValue(false), focusApp: vi.fn(), openKeyboardSettings: vi.fn() };
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const { ctx, frames, leave, last } = fakeStep(api, 'permissions');
    const entered = permissions(ctx);
    expect(vi.getTimerCount()).toBe(0); // 상태를 읽기 전에는 아무것도 붙이지 않는다
    await entered;
    expect(frames).toHaveLength(1);
    expect(last().primary.disabled).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    const check = added.mock.calls.find(([event]) => event === 'focus')![1];
    api.permStatus.mockResolvedValue(granted);
    await vi.advanceTimersByTimeAsync(999);
    expect(api.focusApp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.focusApp).toHaveBeenCalledOnce();
    expect(last().title).toBe('권한을 모두 허용했습니다');
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(api.focusApp).toHaveBeenCalledOnce(); // 이미 허용된 것은 다시 앞으로 부르지 않는다
    expect(frames).toHaveLength(3);
    leave('token');
    expect(removed).toHaveBeenCalledWith('focus', check);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('확인이 늦게 돌아와 단계가 바뀌었으면 다시 그리지 않는다', async () => {
    let resolve!: (v: unknown) => void;
    const api = { permStatus: vi.fn().mockResolvedValue(denied), fnKeyWarning: vi.fn().mockResolvedValue(false), focusApp: vi.fn(), openKeyboardSettings: vi.fn() };
    const { ctx, frames, leave } = fakeStep(api, 'permissions');
    await permissions(ctx);
    api.permStatus.mockImplementation(() => new Promise((r) => { resolve = r; }));
    window.dispatchEvent(new Event('focus'));
    leave('token');
    resolve(granted);
    await flush();
    expect(frames).toHaveLength(1);
  });
});

describe('engine (설치 진행)', () => {
  const comp = (over: object) => ({ id: 'turbo', name: 'Turbo', desc: '', installed: false, size: 10, removable: true, ...over });

  it('들어올 때 실패하지 않은 받을 것이 있으면 한 번 모두 설치를 시작하고, 실패한 것뿐이면 시작하지 않는다', async () => {
    const api = { setupStatus: vi.fn().mockResolvedValue([comp({}), comp({ id: 'large', installed: true }), comp({ id: 'other' })]), setupInstall: vi.fn(), openExternal: vi.fn() };
    await engine(fakeStep(api, 'engine').ctx);
    expect(api.setupInstall.mock.calls).toEqual([['turbo']]); // 원하는 것(engine·turbo·large·diarize)만
    api.setupInstall.mockClear();
    api.setupStatus.mockResolvedValue([comp({}), comp({ id: 'diarize', job: { error: '실패' } })]);
    await engine(fakeStep(api, 'engine').ctx);
    expect(api.setupInstall.mock.calls).toEqual([['turbo'], ['diarize']]); // '모두 설치'와 같아 실패한 것도 다시 받는다
    api.setupInstall.mockClear();
    api.setupStatus.mockResolvedValue([comp({ job: { error: '실패' } }), comp({ id: 'engine', installed: true })]);
    await engine(fakeStep(api, 'engine').ctx);
    expect(api.setupInstall).not.toHaveBeenCalled();
  });

  it('진행 알림은 이 단계일 때만 그리고, 떠나면 구독을 끊는다', async () => {
    const api = { setupStatus: vi.fn().mockResolvedValue([comp({ job: { running: true } })]), setupInstall: vi.fn(), openExternal: vi.fn() };
    const { ctx, frames, leave, last } = fakeStep(api, 'engine');
    await engine(ctx);
    expect(last().primary.label).toBe('설치 중…');
    const [listener] = [...ctx.setupListeners];
    listener!([comp({ installed: true }), comp({ id: 'engine', installed: true })]);
    expect(last().primary.label).toBe('계속');
    expect(frames).toHaveLength(2);
    leave('account');
    expect(ctx.setupListeners.size).toBe(0);
    listener!([comp({})]);
    expect(frames).toHaveLength(2);
  });
});

describe('mic (마이크 막대)', () => {
  it('첫 그리기 뒤에 장치를 열고, 떠나면 트랙을 멈추고 닫아 막대 고리도 멈춘다', async () => {
    const stop = vi.fn();
    const close = vi.fn();
    const frameLoop = vi.fn();
    const order: string[] = [];
    vi.stubGlobal('navigator', { mediaDevices: {
      enumerateDevices: vi.fn().mockResolvedValue([]),
      getUserMedia: vi.fn(async () => {
        order.push('open');
        return { getTracks: () => [{ stop }] };
      }),
    } });
    const getFloat = vi.fn();
    vi.stubGlobal('AudioContext', class {
      close = close;
      createAnalyser() { return { fftSize: 0, getFloatTimeDomainData: getFloat }; }
      createMediaStreamSource() { return { connect: vi.fn() }; }
    });
    vi.stubGlobal('requestAnimationFrame', frameLoop);
    const { ctx, frames, leave } = fakeStep({}, 'mic');
    const select = document.createElement('select');
    const bars = document.createElement('div');
    const wrapped = { ...ctx, frame: (view: Frame) => {
      order.push('draw');
      if (view.body.kind === 'mic') {
        view.body.select.current = select;
        view.body.bars.current = bars;
      }
      frames.push(view);
    } };
    await mic(wrapped);
    await flush();
    expect(order).toEqual(['draw', 'open']);
    expect(frameLoop).toHaveBeenCalledOnce();
    leave('fnkey');
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    const tick = frameLoop.mock.calls[0]![0] as () => void;
    getFloat.mockClear();
    tick();
    expect(getFloat).not.toHaveBeenCalled(); // 닫은 뒤의 고리는 바로 끝난다
    expect(vi.getTimerCount()).toBe(0); // 20초 '그래도 계속' 타이머도 지웠다
  });
});

describe('fnkey (fn 키 확인)', () => {
  it('들어오면 본체 fn 확인 모드를 켜고, 12초 뒤 건너뛰기를 보이며, 떠나면 끈다', () => {
    const api = { onboardingFnTest: vi.fn(), permRequest: vi.fn() };
    const { ctx, leave, last } = fakeStep(api, 'fnkey');
    fnkey(ctx);
    expect(api.onboardingFnTest.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(11999);
    expect(last().secondary).toBeFalsy();
    vi.advanceTimersByTime(1);
    expect(last().secondary).toMatchObject({ label: '건너뛰기' });
    leave('practice');
    expect(api.onboardingFnTest.mock.calls).toEqual([[true], [false]]);
    expect(ctx.fnListeners.size).toBe(0);
  });
});

describe('practice (연습)', () => {
  it('15초가 되어야 건너뛰기를 보이고, 입력이 들어온 뒤의 톡 안내는 무시한다', () => {
    const area = document.createElement('textarea');
    document.body.append(area);
    const { ctx, frames, leave, last } = fakeStep({}, 'practice');
    practice({ ...ctx, frame: (view) => {
      if (view.body.kind === 'practice') view.body.area.current = area;
      frames.push(view);
    } });
    vi.advanceTimersByTime(14999);
    expect(last().secondary).toBeFalsy();
    vi.advanceTimersByTime(1);
    expect(last().secondary).toMatchObject({ label: '건너뛰기' });
    area.value = '말한 내용';
    (last().body as Extract<Frame['body'], { kind: 'practice' }>).input();
    expect(last().title).toBe('잘 됩니다!');
    const count = frames.length;
    ctx.tapListeners.forEach((fn) => fn());
    expect(frames).toHaveLength(count);
    leave('done');
    expect(ctx.tapListeners.size).toBe(0);
    area.remove();
  });
});
