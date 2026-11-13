import type { RefObject } from 'react';

export type StepId = 'welcome' | 'permissions' | 'token' | 'engine' | 'account' | 'mic' | 'fnkey' | 'practice' | 'done';
export type Control<T> = RefObject<T | null>;
export interface Action {
  label: string;
  onclick: () => void;
  disabled?: boolean;
  icon?: string;
}
export interface ResultView {
  ref: Control<HTMLParagraphElement>;
  className: string;
  text: string;
}
interface Item {
  good: boolean | undefined;
  title: string;
  text: string;
}
export type StepView =
  | { kind: 'welcome' }
  | { kind: 'permissions'; items: { kind: string; ok: boolean; active: boolean; name: string; text: string; clicked: boolean; request: () => void }[]; dictation: boolean; fnWarn: boolean; openKeyboard: () => void }
  | { kind: 'token'; input: Control<HTMLInputElement>; result: ResultView; keydown: (e: KeyboardEvent) => void; save: () => void; verify: () => void; check: boolean; openModel: () => void; openTokens: () => void }
  | { kind: 'engine'; items: { id: string; installed: boolean; running: boolean; name: string; optional: boolean; text: string; progress: number | null; size: string; brew: boolean; install: boolean; retry: boolean; openBrew: () => void; start: () => void }[] }
  | { kind: 'account'; items: Item[]; showKey: boolean; input: Control<HTMLInputElement>; result: ResultView; keydown: (e: KeyboardEvent) => void; save: () => void }
  | { kind: 'mic'; select: Control<HTMLSelectElement>; bars: Control<HTMLDivElement>; note: ResultView; mics: readonly { readonly id: string; readonly label: string }[]; initialMic: string; change: () => void; bt: boolean; ok: boolean }
  | { kind: 'fnkey'; pressed: boolean; down: boolean; quiet: boolean; request: () => void }
  | { kind: 'practice'; area: Control<HTMLTextAreaElement>; input: () => void; sample: string; done: boolean; hint: string }
  | { kind: 'done'; items: Item[] };

export interface Frame {
  instance: number;
  title: string;
  lead: string;
  body: StepView;
  primary: Action;
  secondary?: Action | false;
  canBack?: boolean;
}
export interface OnboardingView extends Frame {
  sections: readonly string[];
  at: number;
  back: (() => void) | null;
}
