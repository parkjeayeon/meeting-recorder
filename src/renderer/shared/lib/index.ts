// 화면 공통 도구: 숫자·시간 표시와 '바뀌면 알려 주는 읽기 창구'. 옛 화면 코드(legacy)도 같은 것을 쓴다 — 두 벌을 두지 않는다.
export const fmt = new Intl.NumberFormat('ko-KR');
export const DAY = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
export const PROVIDER_NAME: Readonly<Record<string, string>> = { 'claude-code': 'Claude Code', codex: 'Codex', api: 'API' };

/** 초 → "mm:ss" 또는 "h:mm:ss" (음수는 0으로). 코어의 clock은 음수를 막지 않는다 — 회의 화면을 옮길 때 하나로 정한다 */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}
/** 밀리초 → "1.2초" */
export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}초`;

/** 상태 주인이 들고 있는 값을 읽는 창구 (React useSyncExternalStore용). 사본을 들지 않는다:
 *  read로 읽고, deps(주인의 값들)의 참조가 그대로면 같은 스냅샷을 돌려준다. 주인은 값을 바꾼 뒤 changed()를 부른다 */
export interface Source<T> {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly getSnapshot: () => T;
  readonly changed: () => void;
}
export function createSource<T>(read: () => T, deps: () => readonly unknown[]): Source<T> {
  const listeners = new Set<() => void>();
  let last: readonly unknown[] | null = null;
  let snap: T;
  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => {
      const now = deps();
      if (!last || now.length !== last.length || now.some((v, i) => v !== last![i])) {
        last = now;
        snap = read();
      }
      return snap;
    },
    changed: () => {
      for (const l of [...listeners]) l();
    },
  };
}
