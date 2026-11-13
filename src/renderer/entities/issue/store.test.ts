import { describe, expect, it, vi } from 'vitest';
import { createIssueStore } from './store.ts';

describe('createIssueStore', () => {
  it('제목·설명이 같으면 알리지 않고 앞의 처리기를 그대로 둔다', () => {
    const s = createIssueStore();
    const fn = vi.fn();
    s.subscribe(fn);
    const first = () => {};
    s.set('perm:microphone', { title: '마이크', detail: '허용 필요', onAction: first });
    s.set('perm:microphone', { title: '마이크', detail: '허용 필요', onAction: () => {} });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.get('perm:microphone')!.onAction).toBe(first);
  });

  it('없는 것을 지우면 아무 일도 없다', () => {
    const s = createIssueStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.set('fn', null);
    expect(fn).not.toHaveBeenCalled();
    expect(s.getSnapshot().revision).toBe(0);
  });

  it('바꾸면 자리 그대로, 지웠다 넣으면 맨 뒤', () => {
    const s = createIssueStore();
    s.set('a', { title: 'a' });
    s.set('b', { title: 'b' });
    s.set('a', { title: 'a2' });
    expect(s.getSnapshot().entries.map(([k]) => k)).toEqual(['a', 'b']);
    s.set('a', null);
    s.set('a', { title: 'a3' });
    expect(s.getSnapshot().entries.map(([k]) => k)).toEqual(['b', 'a']);
  });

  it('바뀔 때마다 새 배열·새 번호, 그대로면 같은 상태', () => {
    const s = createIssueStore();
    const before = s.getSnapshot();
    s.set('a', { title: 'a' });
    const after = s.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.revision).toBe(1);
    s.set('a', { title: 'a' });
    expect(s.getSnapshot()).toBe(after);
  });
});
