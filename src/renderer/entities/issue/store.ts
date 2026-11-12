import type { Issue } from './model.ts';

/** 문제 목록 — 넣은 차례 그대로(홈 맨 위·엔진 버튼이 '첫 문제'를 고른다). 바뀔 때마다 새 배열 */
export interface IssueState {
  readonly revision: number;
  readonly entries: readonly (readonly [string, Issue])[];
}

export interface IssueStore {
  readonly getSnapshot: () => IssueState;
  /** 바뀐 그 자리에서 바로(동기로) 부른다 — 옛 setIssue가 창구·설정 점을 그 자리에서 바꾸던 것처럼 */
  readonly subscribe: (fn: () => void) => () => void;
  readonly get: (key: string) => Issue | undefined;
  /** null이면 지운다. 제목·설명이 같으면 아무것도 하지 않는다(권한은 3초마다 다시 확인하므로) — 그때는 처리기·칸도 앞의 것 그대로 */
  readonly set: (key: string, issue: Issue | null) => void;
}

/** 앱에 하나뿐인 문제 주인. 이미 있는 키를 바꾸면 자리는 그대로, 지웠다 다시 넣으면 맨 뒤 (Map 그대로) */
export function createIssueStore(): IssueStore {
  const issues = new Map<string, Issue>();
  const subs = new Set<() => void>();
  let state: IssueState = { revision: 0, entries: [] };
  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get: (key) => issues.get(key),
    set: (key, issue) => {
      const before = issues.get(key);
      if (!issue === !before && (!issue || (issue.title === before!.title && issue.detail === before!.detail))) return;
      if (issue) issues.set(key, issue);
      else issues.delete(key);
      state = { revision: state.revision + 1, entries: [...issues.entries()] };
      for (const fn of subs) fn();
    },
  };
}
