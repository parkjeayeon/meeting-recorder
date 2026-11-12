import { expect, it, vi } from 'vitest';
import { createJobs } from './jobs.ts';

it('같은 키는 한 번만 돌고, 시작·끝을 알린다', async () => {
  const jobs = createJobs();
  const seen = vi.fn();
  jobs.subscribe(seen);
  let done!: (v: string) => void;
  const fn = vi.fn(() => new Promise<string>((r) => (done = r)));
  const a = jobs.run('m|액션', '찾는 중…', fn);
  const b = jobs.run('m|액션', '다른 이름', fn);
  expect([fn.mock.calls.length, jobs.get('m|액션')?.label, seen.mock.calls.length]).toEqual([1, '찾는 중…', 1]);
  done('끝');
  expect(await a).toBe('끝');
  expect(await b).toBe('끝');
  expect([jobs.has('m|액션'), seen.mock.calls.length]).toEqual([false, 2]);
});
