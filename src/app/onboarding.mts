// ── 처음 설정(온보딩): 어디까지 했는지 저장해 두고, 끝나면 본 화면으로 ─────────
// src/main.js에서 옮김 (결정 70). fn 키 확인 단계 표시(fnTestMode)는 fn 상태 머신이 읽으므로 본체에 남고 setter로 바꾼다.
// 창·앱(app:focus)은 본체가 getter로 넘긴다 — 부를 때의 창을 쓴다.
import type { Ipc } from './ipc.mjs';

// 설정 파일의 onboarding 값 (화면이 단계 이름·번호와 completed를 적는다)
export interface OnboardingState {
  completed?: boolean;
  step?: number | string;
  [k: string]: unknown;
}

export interface OnboardingContext {
  dictation: {
    storedSettings(): { onboarding?: OnboardingState };
    saveSettings(patch: { onboarding: OnboardingState }): unknown;
  };
  setFnTestMode: (on: boolean) => void;
  win: () => { show(): void; focus(): void };
  app: { focus(opts: { steal: boolean }): void };
}

export function registerOnboarding(ipc: Ipc, ctx: OnboardingContext): void {
  ipc.handle('onboarding:get', () => ctx.dictation.storedSettings().onboarding ?? { completed: false, step: 0 });
  ipc.on('onboarding:fnTest', (_e, on) => ctx.setFnTestMode(Boolean(on)));
  // 권한을 허용하고 돌아왔을 때 창을 앞으로
  ipc.on('app:focus', () => {
    ctx.win().show();
    ctx.app.focus({ steal: true });
    ctx.win().focus();
  });
  ipc.handle('onboarding:set', (_e, patch) => {
    const next: OnboardingState = { ...(ctx.dictation.storedSettings().onboarding ?? {}), ...(patch as OnboardingState) };
    ctx.dictation.saveSettings({ onboarding: next });
    return next;
  });
}
