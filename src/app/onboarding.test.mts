// 처음 설정(온보딩) 진행 저장·읽기, fn 키 확인 단계, 창 앞으로 (onboarding:*, app:focus)
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeIpc, type FakeIpc } from '../test/ipc.mjs';
import { registerOnboarding, type OnboardingState } from './onboarding.mjs';

let ipc: FakeIpc;
let stored: { onboarding?: OnboardingState; other?: string };
let saves: unknown[];
let fnTest: unknown[];
let calls: string[];
let win: { show(): void; focus(): void };

beforeEach(() => {
  ipc = fakeIpc();
  stored = { other: '그대로' };
  saves = [];
  fnTest = [];
  calls = [];
  const makeWin = (name: string) => ({ show: () => calls.push(`${name}.show`), focus: () => calls.push(`${name}.focus`) });
  win = makeWin('win1');
  registerOnboarding(ipc, {
    dictation: {
      storedSettings: () => structuredClone(stored),
      saveSettings: (patch) => {
        saves.push(patch);
        Object.assign(stored, patch);
      },
    },
    setFnTestMode: (on) => fnTest.push(on),
    win: () => win,
    app: { focus: (opts) => calls.push(`app.focus(${JSON.stringify(opts)})`) },
  });
  win = makeWin('win2'); // 등록한 뒤 창이 바뀌어도 부를 때의 창을 쓴다
});

describe('onboarding:get·set', () => {
  it('받는 채널은 넷', () => {
    expect(ipc.channels()).toEqual(['handle onboarding:get', 'handle onboarding:set', 'on app:focus', 'on onboarding:fnTest']);
  });

  it('저장한 적이 없으면 처음 단계', async () => {
    expect(await ipc.invoke('onboarding:get')).toEqual({ completed: false, step: 0 });
  });

  it('지금 값에 고친 것만 덮어 저장하고, 저장한 값을 돌려준다', async () => {
    expect(await ipc.invoke('onboarding:set', { step: 'permissions' })).toEqual({ step: 'permissions' });
    expect(await ipc.invoke('onboarding:set', { fnChecked: true })).toEqual({ step: 'permissions', fnChecked: true });
    expect(await ipc.invoke('onboarding:set', { step: 'practice', completed: true })).toEqual({ step: 'practice', fnChecked: true, completed: true });
    expect(await ipc.invoke('onboarding:get')).toEqual({ step: 'practice', fnChecked: true, completed: true });
    expect(saves).toEqual([
      { onboarding: { step: 'permissions' } },
      { onboarding: { step: 'permissions', fnChecked: true } },
      { onboarding: { step: 'practice', fnChecked: true, completed: true } },
    ]);
    expect(stored.other).toBe('그대로');
  });

  it('빈 patch(null)는 지금 값을 그대로 다시 저장한다', async () => {
    stored.onboarding = { completed: false, step: 2 };
    expect(await ipc.invoke('onboarding:set', null)).toEqual({ completed: false, step: 2 });
  });
});

describe('onboarding:fnTest · app:focus', () => {
  it('fn 키 확인 단계 표시는 참·거짓으로 바꿔 넘긴다', () => {
    for (const v of [1, 0, 'x', undefined, true]) ipc.send('onboarding:fnTest', v);
    expect(fnTest).toEqual([true, false, true, false, true]);
  });

  it('부를 때의 창을 보이고, 앱을 앞으로 가져온 뒤 창에 포커스', () => {
    ipc.send('app:focus');
    expect(calls).toEqual(['win2.show', 'app.focus({"steal":true})', 'win2.focus']);
  });
});
