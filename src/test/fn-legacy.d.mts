// fn-legacy.mjs(옮기기 전 fn 상태 머신의 얼린 사본)의 모양. 시험(src/app/fn.test.mts)만 쓴다
export interface LegacyEnv {
  DEBOUNCE_MS: number;
  SELFTEST: boolean;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  log(line: string): void;
  send(channel: string, payload?: unknown): void;
  sendOverlay(channel: string, payload?: unknown): void;
  sendOverlayState(): void;
  dictation: { getSettings(): { enabled?: boolean }; storedSettings(): { onboarding?: { completed?: boolean; step?: unknown } } };
}

export interface LegacyFn {
  onFnDown(): void;
  onFnUp(e: { chord: boolean }): void;
  uiToggle(mode: string | undefined): void;
  uiCancel(): void;
  dictationLimit(): void;
  recStop(e?: { discard?: boolean }): void;
  handedOff(): void;
  failed(): void;
  setFnTestMode(on: boolean): void;
  fnState(): string;
  world(next: { recording: { mode?: string } | null; transcribing: number }): void;
}

export function createLegacyFn(env: LegacyEnv): LegacyFn;
