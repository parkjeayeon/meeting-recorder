// 오래 걸리는 LLM 작업(흐름도 만들기·다시 그리기, 액션 찾기, 확인 필요 직접 추가 …)을 키마다 기억한다.
// 탭을 옮기거나 화면을 다시 그려도 버튼이 '… 중'을 잃지 않게 (화면을 떠났다 와도 그대로). 같은 키는 한 번만 돈다.
export interface Job {
  readonly label: string;
  readonly promise: Promise<unknown>;
}
export interface Jobs {
  /** 키의 작업이 없으면 시작하고, 있으면 그 작업을 기다린다 */
  readonly run: <T>(key: string, label: string, fn: () => Promise<T>) => Promise<T>;
  readonly get: (key: string) => Job | undefined;
  readonly has: (key: string) => boolean;
  readonly subscribe: (onChange: () => void) => () => void;
  /** 작업이 시작·끝날 때마다 바뀌는 번호 (useSyncExternalStore용) */
  readonly version: () => number;
}

export function createJobs(): Jobs {
  const map = new Map<string, Job>();
  const listeners = new Set<() => void>();
  let ver = 0;
  const changed = () => {
    ver++;
    for (const l of [...listeners]) l();
  };
  return {
    run: <T>(key: string, label: string, fn: () => Promise<T>) => {
      if (!map.has(key)) {
        const promise = fn().finally(() => {
          map.delete(key);
          changed();
        });
        map.set(key, { label, promise });
        changed();
      }
      return map.get(key)!.promise as Promise<T>;
    },
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    version: () => ver,
  };
}
