// 확인 필요 처리기의 사전 더하기·빼기 (review.mts) — 가짜 확인 필요와 메모리 사전으로
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import type { DictationSettings } from '../dictation/index.mjs';
import type { Item, Review } from '../review/index.mjs';
import { registerReview, type ReviewContext } from './review.mjs';

let root: string;
let ipc: FakeIpc;
let vocabulary: string;
let review: Review;
let calls: unknown[][];
let portable: number;

const item = (id: string, kind: Item['kind'], applied: string | undefined, status = 'applied'): Item =>
  ({ id, kind, at: null, heard: null, heardNote: null, guess: null, note: '', status, ...(applied === undefined ? {} : { applied }) }) as Item;

beforeEach(() => {
  root = tmpDir('mr-app-review-');
  vocabulary = '기존, Kubernetes';
  calls = [];
  portable = 0;
  review = { items: [] };
  ipc = fakeIpc();
  const minutes = {
    applyReview: (dir: string, fixes: readonly { id: string }[]) => (calls.push(['applyReview', dir, fixes]), { ...review, skipped: [] }),
    readReview: () => review,
    revertReview: (dir: string, id: string) => {
      calls.push(['revertReview', dir, id]);
      review = { ...review, items: review.items.map((it) => (it.id === id ? { ...it, status: 'open' } : it)) };
      return review;
    },
    markReviewItems: (dir: string, ids: readonly string[], patch: Record<string, unknown>) => {
      calls.push(['markReviewItems', dir, ids, patch]);
      review = { ...review, items: review.items.map((it) => (ids.includes(it.id) ? { ...it, ...patch } : it)) };
    },
  } as Partial<ReviewContext['minutes']> as ReviewContext['minutes'];
  registerReview(ipc, {
    recordingDir: (dir) => {
      if (path.dirname(dir as string) !== root) throw new Error('녹음 폴더가 아닙니다');
      return dir as string;
    },
    minutes,
    dictation: {
      getSettings: () => ({ vocabulary }) as DictationSettings,
      saveSettings: (patch) => {
        vocabulary = patch.vocabulary as string;
        return { vocabulary } as DictationSettings;
      },
    },
    writePortableSettings: () => void portable++,
  });
});

const dir = () => path.join(root, '2026-01-01_09-00-00_meeting');

describe('review:apply → 사전', () => {
  it('고친 단어·이름을 사전 끝에 더하고, 더한 항목에 표시하고, 설정 백업을 다시 쓴다', async () => {
    review.items = [item('w', 'word', ' 쿠버네티스 '), item('n', 'name', '김철수')];
    const res = (await ipc.invoke('review:apply', dir(), [{ id: 'w' }, { id: 'n' }])) as Review & { addedWords: string[] };
    expect(res.addedWords).toEqual(['쿠버네티스', '김철수']);
    expect(vocabulary).toBe('기존, Kubernetes, 쿠버네티스, 김철수');
    expect(portable).toBe(1);
    expect(calls.at(-1)).toEqual(['markReviewItems', dir(), ['w', 'n'], { vocabAdded: true }]);
  });

  it('넣지 않는 것: 뜻·빠진 말, 적용 안 됨, 빈 말, 30자 넘음, 다섯 낱말 이상, 문장부호·줄바꿈, 이미 있음(대소문자 무시), 같은 말 두 번', async () => {
    review.items = [
      item('m', 'meaning', '설명'),
      item('l', 'lost', '빠짐'),
      item('k', 'word', '그대로', 'kept'),
      item('e', 'word', '  '),
      item('u', 'word', undefined),
      item('long', 'word', 'ㄱ'.repeat(31)),
      item('ok30', 'word', 'ㄴ'.repeat(30)),
      item('five', 'word', '하나 둘 셋 넷 다섯'),
      item('four', 'word', '하나 둘 셋 넷'),
      ...['.', ',', '!', '?', '。'].map((p, i) => item(`p${i}`, 'word', `끝${p}`)),
      item('nl', 'word', '줄\n바꿈'),
      item('dup', 'name', 'kubernetes'),
      item('twice1', 'word', '같은말'),
      item('twice2', 'word', '같은말'),
    ];
    const fixes = review.items.map((it) => ({ id: it.id }));
    const res = (await ipc.invoke('review:apply', dir(), fixes)) as { addedWords: string[] };
    expect(res.addedWords).toEqual(['ㄴ'.repeat(30), '하나 둘 셋 넷', '같은말']);
    expect(calls.at(-1)).toEqual(['markReviewItems', dir(), ['ok30', 'four', 'twice1', 'twice2'], { vocabAdded: true }]); // 같은 말을 고친 항목은 둘 다
  });

  it('넘긴 항목만 본다, 더할 것이 없으면 사전·백업·표시를 건드리지 않는다', async () => {
    review.items = [item('w', 'word', '다른것')];
    const res = (await ipc.invoke('review:apply', dir(), [{ id: 'x' }])) as { addedWords: string[] };
    expect(res.addedWords).toEqual([]);
    expect(vocabulary).toBe('기존, Kubernetes');
    expect(portable).toBe(0);
    expect(calls.map((c) => c[0])).toEqual(['applyReview']);
  });

  it('녹음 폴더 밖이면 적용하지 않는다', async () => {
    await expect(ipc.invoke('review:apply', '/elsewhere/x', [])).rejects.toThrow('녹음 폴더가 아닙니다');
    expect(calls).toEqual([]);
  });
});

describe('review:revert → 사전', () => {
  it('자동으로 넣었던 단어는 되돌릴 때 뺀다 (대소문자 무시)', async () => {
    vocabulary = '기존, 쿠버네티스, Kubernetes';
    review.items = [{ ...item('w', 'word', ' kubernetes '), vocabAdded: true } as Item];
    const res = (await ipc.invoke('review:revert', dir(), 'w')) as { removedWord: string | null };
    expect(res.removedWord).toBe('kubernetes');
    expect(vocabulary).toBe('기존, 쿠버네티스');
    expect(portable).toBe(1);
    expect(calls).toEqual([['revertReview', dir(), 'w'], ['markReviewItems', dir(), ['w'], { vocabAdded: false }]]);
  });

  it('사전에서 이미 지웠으면 사전은 그대로, 표시만 푼다', async () => {
    review.items = [{ ...item('w', 'word', '없는말'), vocabAdded: true } as Item];
    const res = (await ipc.invoke('review:revert', dir(), 'w')) as { removedWord: string | null };
    expect(res.removedWord).toBe('없는말');
    expect(vocabulary).toBe('기존, Kubernetes');
    expect(portable).toBe(0);
    expect(calls.at(-1)).toEqual(['markReviewItems', dir(), ['w'], { vocabAdded: false }]);
  });

  it('사전에 넣지 않은 항목은 사전을 건드리지 않는다', async () => {
    review.items = [item('w', 'word', 'Kubernetes')];
    const res = (await ipc.invoke('review:revert', dir(), 'w')) as { removedWord: string | null };
    expect(res.removedWord).toBe(null);
    expect(vocabulary).toBe('기존, Kubernetes');
    expect(calls).toEqual([['revertReview', dir(), 'w']]);
  });
});
