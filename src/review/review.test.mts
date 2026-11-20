import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyReview, revertReview } from './apply.mjs';
import { changedLines, parseClock, spliceLines, stampOf } from './lines.mjs';
import { markReviewItems, readReview, setReviewStatus, writeReview, type Item } from './store.mjs';

describe('parseClock · stampOf', () => {
  it('mm:ss와 h:mm:ss', () => {
    expect(parseClock('12:30')).toBe(750);
    expect(parseClock('1:24:53')).toBe(5093);
    expect(Number.isNaN(parseClock('모름'))).toBe(true);
  });
  it('줄 맨 앞 시각만', () => {
    expect(stampOf('[00:12] [화자 1] 안녕하세요')).toBe('[00:12]');
    expect(stampOf('- 결정 (12:30)')).toBeUndefined();
  });
});

describe('changedLines', () => {
  it('같은 자리의 바뀐 줄만', () => {
    expect(changedLines('a\nb\nc', 'a\nB\nc')).toEqual([{ from: 'b', to: 'B' }]);
  });
  it('줄 수가 다르면 기록하지 않는다', () => {
    expect(changedLines('a\nb', 'a\nb\nc')).toEqual([]);
  });
});

describe('spliceLines', () => {
  const text = '[00:10] 하나\n[00:20] 둘\n[00:30] 셋\n[00:40] 넷\n';
  it('구간 안 줄을 새 줄로 바꾸고 앞뒤는 그대로', () => {
    expect(spliceLines(text, 20, 40, ['[00:21] 새 줄'])).toBe('[00:10] 하나\n[00:21] 새 줄\n[00:40] 넷\n');
  });
  it('빈 구간(start = end)이면 그 시각 자리에 끼워 넣는다', () => {
    expect(spliceLines(text, 25, 25, ['[00:25] 끼움'])).toBe('[00:10] 하나\n[00:20] 둘\n[00:25] 끼움\n[00:30] 셋\n[00:40] 넷\n');
  });
  it('구간 뒤에 줄이 없으면 맨 끝에', () => {
    expect(spliceLines(text, 35, 99, ['[00:36] 끝'])).toBe('[00:10] 하나\n[00:20] 둘\n[00:30] 셋\n[00:36] 끝\n');
  });
});

describe('applyReview · revertReview', () => {
  let dir: string;
  const files = {
    'transcript.txt': '[00:05] [화자 1] 랩캐시도 쓰고 넥스트로 갑니다\n[00:12] [화자 2] 통신 한정성이 중요합니다\n[00:20] [화자 1] 한정성 얘기는 여기까지\n',
    'script-clean.txt': '[00:05] [화자 1] 랩캐시도 쓰고 넥스트로 갑니다\n[00:12] [화자 2] 통신 한정성이 중요합니다\n',
    'minutes.md': '# 회의\n\n## 요약\n통신 한정성을 다뤘다.\n\n## 확인 필요\n- 한정성: 안정성으로 추정\n',
  };
  const item = (id: string, heard: string, guess: string | null, extra: Partial<Item> = {}): Item => ({ id, kind: 'word', at: null, heard, heardNote: heard, guess, note: '', status: 'open', ...extra });
  const read = () => Object.fromEntries(Object.keys(files).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-review-test-'));
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
    writeReview(dir, { items: [item('r1', '한정성', '안정성'), item('r2', '랩캐시도', 'Memcached'), item('r3', '넥스트', 'Next.js'), item('r4', '없는말', '무엇')] });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('같은 글자를 세 파일에서 모두 바꾸되, 회의록의 확인 필요 섹션은 그대로 둔다', () => {
    const out = applyReview(dir, [{ id: 'r1', guess: '안정성' }]);
    const now = read();
    expect(now['transcript.txt']).toContain('통신 안정성이 중요합니다');
    expect(now['transcript.txt']).toContain('안정성 얘기는 여기까지');
    expect(now['minutes.md']).toContain('통신 안정성을 다뤘다.');
    expect(now['minutes.md']).toContain('- 한정성: 안정성으로 추정');
    const r1 = out.items.find((it) => it.id === 'r1');
    expect(r1).toMatchObject({ status: 'applied', applied: '안정성', count: 4, seq: 1, at: '00:12' });
    expect(fs.readFileSync(path.join(dir, 'transcript.before-review.txt'), 'utf8')).toBe(files['transcript.txt']);
  });

  it('적용하고 되돌리면 세 파일이 처음과 바이트까지 같다', () => {
    applyReview(dir, [{ id: 'r1', guess: '안정성' }]);
    const back = revertReview(dir, 'r1');
    expect(read()).toEqual(files);
    const r1 = back.items.find((it) => it.id === 'r1');
    expect(r1?.status).toBe('open');
    expect(r1).not.toHaveProperty('undo');
    expect(r1).not.toHaveProperty('applied');
  });

  it('같은 줄을 두 항목이 고친 뒤 먼저 고친 것만 되돌리면, 나중 것은 다시 적용된다', () => {
    applyReview(dir, [{ id: 'r2', guess: 'Memcached' }]);
    applyReview(dir, [{ id: 'r3', guess: 'Next.js' }]);
    const out = revertReview(dir, 'r2');
    expect(out.reapplied).toEqual(['r3']);
    expect(read()['transcript.txt']).toContain('[00:05] [화자 1] 랩캐시도 쓰고 Next.js로 갑니다');
    revertReview(dir, 'r3');
    expect(read()).toEqual(files);
  });

  it('여러 항목을 어떤 순서로 되돌려도 전부 되돌리면 처음과 같다', () => {
    applyReview(dir, [{ id: 'r1', guess: '안정성' }, { id: 'r2', guess: 'Memcached' }]);
    applyReview(dir, [{ id: 'r3', guess: 'Next.js' }]);
    for (const id of ['r2', 'r1', 'r3']) revertReview(dir, id);
    expect(read()).toEqual(files);
  });

  it('녹취에 없는 말은 바꾸지 않고 이유를 돌려준다', () => {
    const out = applyReview(dir, [{ id: 'r4', guess: '무엇' }]);
    expect(out.skipped).toEqual([{ id: 'r4', reason: 'notfound', heard: '없는말' }]);
    expect(out.items.find((it) => it.id === 'r4')?.status).toBe('open');
    expect(read()).toEqual(files);
  });

  it('그대로 두기·확인됨은 파일을 바꾸지 않는다', () => {
    const out = applyReview(dir, [{ id: 'r1', keep: true }, { id: 'r2', resolve: '  표기는 그대로  ' }]);
    expect(out.items.find((it) => it.id === 'r1')?.status).toBe('kept');
    expect(out.items.find((it) => it.id === 'r2')).toMatchObject({ status: 'resolved', resolution: '표기는 그대로' });
    expect(read()).toEqual(files);
    expect(revertReview(dir, 'r1').items.find((it) => it.id === 'r1')?.status).toBe('open');
  });

  it('고칠 말을 들린 말과 똑같이 넣으면 메모의 다른 표기를 그 말로 통일한다', () => {
    fs.writeFileSync(path.join(dir, 'transcript.txt'), '[00:01] [화자 1] 원성 씨가 말했고\n[00:09] [화자 2] 원석 씨가 답했다\n');
    writeReview(dir, { items: [item('r1', '원석', null, { kind: 'name', note: "화자 2의 이름이 '원성'과 '원석'으로 혼재" })] });
    applyReview(dir, [{ id: 'r1', heard: '원석', guess: '원석' }]);
    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe('[00:01] [화자 1] 원석 씨가 말했고\n[00:09] [화자 2] 원석 씨가 답했다\n');
  });

  it('확인을 마친 뒤에는 되돌리지 못한다', () => {
    applyReview(dir, [{ id: 'r1', guess: '안정성' }]);
    const review = readReview(dir)!;
    for (const it of review.items) if (it.status === 'open') it.status = 'kept';
    writeReview(dir, { ...review, finalizedAt: new Date() });
    expect(() => revertReview(dir, 'r1')).toThrow('확인을 마친 뒤에는');
  });

  it('상태 바꾸기: 적용한 항목은 건드리지 않고, 다시 열면 확인한 내용을 지운다', () => {
    applyReview(dir, [{ id: 'r1', guess: '안정성' }, { id: 'r2', resolve: '맞음' }]);
    const out = setReviewStatus(dir, ['r1', 'r2', 'r3'], 'open');
    expect(out.items.find((it) => it.id === 'r1')?.status).toBe('applied');
    expect(out.items.find((it) => it.id === 'r2')).not.toHaveProperty('resolution');
    markReviewItems(dir, ['r3'], { vocab: true });
    expect(readReview(dir)?.items.find((it) => it.id === 'r3')?.vocab).toBe(true);
  });
});
