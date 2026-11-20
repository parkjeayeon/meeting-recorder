import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readReview, revertReview } from '../review/index.mjs';
import { fakeDeps, meetingDir, readJson, tmpDir } from '../test/meeting.mjs';
import { applyRetranscribe, retranscribeRange } from './retranscribe.mjs';
import type { Segment } from './transcript.mjs';

const TRANSCRIPT = '[00:02] [화자 1] 시작합니다\n[00:10] [화자 2] 잘 안 들리는 말\n[00:12] [화자 2] 반복 반복\n[00:20] [화자 1] 마무리합니다\n';
const CLEAN = '[00:02] [화자 1] 시작합니다\n[00:10] [화자 2] 잘 안 들리는 말\n[00:20] [화자 1] 마무리합니다\n';
const SEGMENTS = [
  { start: 2, end: 5, text: '시작합니다', track: 'mic' },
  { start: 10, end: 11.5, text: '잘 안 들리는 말', track: 'mic' },
  { start: 12, end: 14, text: '반복 반복', track: 'mic' },
  { start: 20, end: 22, text: '마무리합니다', track: 'mic' },
];
const TURNS = [
  { start: 0, end: 8, speaker: 'SPEAKER_00' },
  { start: 8, end: 18, speaker: 'SPEAKER_01' },
  { start: 18, end: 30, speaker: 'SPEAKER_00' },
];
// 잘라 낸 구간(앞뒤 0.5초 여유) 안의 시각으로 돌려준다: 9.5초부터 → 앞 여유분·뒤 여유분에 걸친 말은 빠진다
const HEARD: Segment[] = [
  { start: 0, end: 0.4, text: '앞 여유분' },
  { start: 0.8, end: 3, text: '새로 들린 말' },
  { start: 3.5, end: 4.5, text: '이어서 들린 말' },
  { start: 5.4, end: 6, text: '뒤 여유분' },
];

let root = '';
let dir = '';
const snap = () => Object.fromEntries(['transcript.txt', 'script-clean.txt', 'segments.json', 'minutes.md'].map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
beforeEach(() => {
  root = tmpDir('mr-redo-');
  fs.mkdirSync(path.join(root, 'userData'));
  dir = meetingDir(root, 'm');
  const write = (f: string, data: unknown) => fs.writeFileSync(path.join(dir, f), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  write('transcript.txt', TRANSCRIPT);
  write('script-clean.txt', CLEAN);
  fs.writeFileSync(path.join(dir, 'segments.json'), JSON.stringify({ model: 'large-v3', tracks: ['mic'], redo: [], segments: SEGMENTS }));
  write('diarization.json', { segments: TURNS });
  write('minutes.md', '# 회의\n\n## 요약\n시작하고 마무리함.\n\n## 확인 필요\n- 00:10~00:15 유실\n');
  write('review.json', { items: [{ id: 'r1', kind: 'lost', at: '00:10', heard: null, heardNote: null, guess: null, note: '00:10~00:15 유실', status: 'open' }] });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('retranscribeRange', () => {
  it('구간만 잘라 앞 문장 없이 다시 받아쓰고, 화자 번호를 이어 붙여 확인 항목에 둔다 (녹취는 아직 그대로)', async () => {
    const before = snap();
    const f = fakeDeps(path.join(root, 'userData'), { transcribe: () => HEARD });
    const r = await retranscribeRange(dir, 'r1', '10', '15');

    expect(r).toEqual({ start: 10, end: 15, gain: expect.any(Number), text: '[00:10] [화자 2] 새로 들린 말\n[00:13] [화자 2] 이어서 들린 말', empty: false });
    expect(f.asr).toEqual([{ file: '.redo-r1.wav', language: 'en', port: 4321, noContext: true, argc: 4 }]);
    expect(f.servers).toEqual([{ modelFile: path.join(root, 'userData', 'models', 'ggml-large-v3.bin'), vad: undefined, argc: 1 }]);
    expect(f.stopped).toBe(1);
    expect(fs.readdirSync(dir).filter((x) => x.startsWith('.'))).toEqual([]);
    expect(snap()).toEqual(before);

    const redo = readReview(dir)!.items[0]!.redo!;
    expect(redo).toMatchObject({ start: 10, end: 15, track: 'mic', model: 'large-v3', gain: r.gain, at: expect.any(String) });
    expect(redo.lines!.map((l) => [l.label, l.text])).toEqual([
      ['화자 2', '새로 들린 말'],
      ['화자 2', '이어서 들린 말'],
    ]);
    expect(Object.keys(redo.lines![0]!)).toEqual(['start', 'end', 'text', 'track', 'label']);
  });

  it('회의용 서버가 없으면 turbo로 기록한다', async () => {
    fakeDeps(path.join(root, 'userData'), { server: 'fail', transcribe: () => [] });
    const r = await retranscribeRange(dir, 'r1', 10, 15);
    expect(r).toMatchObject({ text: '', empty: true });
    expect(readReview(dir)!.items[0]!.redo!.model).toBe('large-v3-turbo');
  });

  it('구간·항목이 틀리면 받아쓰지 않고 실패한다', async () => {
    const f = fakeDeps(path.join(root, 'userData'), { transcribe: () => HEARD });
    await expect(retranscribeRange(dir, 'r1', 15, 10)).rejects.toThrow('다시 받아쓸 구간은 10분 이내로 골라 주세요');
    await expect(retranscribeRange(dir, 'r1', 0, 601)).rejects.toThrow('다시 받아쓸 구간은 10분 이내로 골라 주세요');
    await expect(retranscribeRange(dir, 'r9', 10, 15)).rejects.toThrow('확인 항목이 없습니다');
    expect(f.asr).toEqual([]);
  });
});

describe('applyRetranscribe → revertReview', () => {
  it('구간 안 줄만 바꾸고 원래 줄을 기록해 두며, 두 번 눌러도 기록을 덮지 않고, 되돌리면 처음과 같다', async () => {
    const original = snap();
    fakeDeps(path.join(root, 'userData'), { transcribe: () => HEARD });
    await retranscribeRange(dir, 'r1', 10, 15);
    applyRetranscribe(dir, 'r1');

    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe('[00:02] [화자 1] 시작합니다\n[00:10] [화자 2] 새로 들린 말\n[00:13] [화자 2] 이어서 들린 말\n[00:20] [화자 1] 마무리합니다\n');
    expect(fs.readFileSync(path.join(dir, 'script-clean.txt'), 'utf8')).toBe('[00:02] [화자 1] 시작합니다\n[00:10] [화자 2] 새로 들린 말\n[00:13] [화자 2] 이어서 들린 말\n[00:20] [화자 1] 마무리합니다\n');
    expect(fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8')).toBe(original['minutes.md']);
    const seg = readJson(dir, 'segments.json');
    expect(seg.segments.map((s: Segment) => s.text)).toEqual(['시작합니다', '새로 들린 말', '이어서 들린 말', '마무리합니다']);
    expect(Object.keys(seg.segments[1])).toEqual(['start', 'end', 'text', 'track']); // 화자 표시는 segments.json에 넣지 않는다
    expect(fs.readFileSync(path.join(dir, 'transcript.before-review.txt'), 'utf8')).toBe(TRANSCRIPT);
    expect(fs.readFileSync(path.join(dir, 'script-clean.before-review.txt'), 'utf8')).toBe(CLEAN);

    const item = readReview(dir)!.items[0]!;
    expect(item).toMatchObject({ status: 'applied', applied: '구간 다시 받아씀', count: 2 });
    expect(item.chat).toEqual([{ user: '(00:10~00:15 구간을 다시 받아써 녹취에 반영함)', assistant: '[00:10] [화자 2] 새로 들린 말\n[00:13] [화자 2] 이어서 들린 말' }]);
    expect(item.redo!.appliedAt).toEqual(expect.any(String));
    expect(item.redo!.replaced).toEqual({
      'transcript.txt': ['[00:10] [화자 2] 잘 안 들리는 말', '[00:12] [화자 2] 반복 반복'],
      'script-clean.txt': ['[00:10] [화자 2] 잘 안 들리는 말'],
      segments: [SEGMENTS[1], SEGMENTS[2]],
    });

    // 두 번 눌러도: 파일·원래 줄 기록 그대로
    const applied = snap();
    const reviewText = fs.readFileSync(path.join(dir, 'review.json'), 'utf8');
    applyRetranscribe(dir, 'r1');
    expect(snap()).toEqual(applied);
    expect(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')).toBe(reviewText);

    // src/review의 되돌리기로 처음 녹취·정리본·녹취 구간으로
    revertReview(dir, 'r1');
    const back = snap();
    expect(back['transcript.txt']).toBe(original['transcript.txt']);
    expect(back['script-clean.txt']).toBe(original['script-clean.txt']);
    expect(readJson(dir, 'segments.json').segments).toEqual(SEGMENTS);
    expect(readReview(dir)!.items[0]!.status).toBe('open');
  });

  it('다시 받아쓴 결과가 없거나 비었으면 반영하지 않는다', async () => {
    expect(() => applyRetranscribe(dir, 'r1')).toThrow('다시 받아쓴 결과가 없습니다');
    fakeDeps(path.join(root, 'userData'), { transcribe: () => [] });
    await retranscribeRange(dir, 'r1', 10, 15);
    expect(() => applyRetranscribe(dir, 'r1')).toThrow('다시 받아써도 알아들을 수 있는 말이 없었습니다');
  });

  it('지난 반영이 원래 줄만 기록하고 끊겼으면, 다시 받아쓸 때 그 구간을 먼저 원래대로 돌린다', async () => {
    fakeDeps(path.join(root, 'userData'), { transcribe: () => HEARD });
    await retranscribeRange(dir, 'r1', 10, 15);
    applyRetranscribe(dir, 'r1');
    // 끊긴 것처럼: 반영 표시만 지운다 (파일은 이미 바뀜)
    const review = JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
    delete review.items[0].redo.appliedAt;
    review.items[0].status = 'open';
    fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review));
    await retranscribeRange(dir, 'r1', 10, 15);
    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe(TRANSCRIPT);
    expect(readJson(dir, 'segments.json').segments).toEqual(SEGMENTS);
  });
});

// 구간 경계 둘레의 말: 잘라 낸 녹음은 구간보다 0.5초 앞에서 시작한다 (10~15초 → 9.5초부터)
const EDGE: Segment[] = [
  { start: 0.0, end: 0.6, text: '앞 여유분만' }, // 9.5~10.1 — 가운데가 구간 앞이라 뺀다
  { start: 0.2, end: 1.0, text: '앞에서 시작한 말' }, // 9.7~10.5 — 가운데가 구간 안이라 넣는다 (예전엔 [00:09]로 구간 밖에 들어갔다)
  { start: 0.5, end: 1.5, text: '딱 시작에서' }, // 10.0
  { start: 2.0, end: 3.0, text: '가운데 말' },
  { start: 4.9, end: 5.4, text: '끝 바로 앞' }, // 14.4~14.9
  { start: 5.3, end: 5.9, text: '끝에 걸친 말' }, // 14.8~15.4 — 가운데 15.1, 뺀다
  { start: 5.5, end: 6.0, text: '딱 끝에서' }, // 15.0 — 뺀다
];

describe('구간 경계 둘레의 말도 되돌리면 처음과 같다', () => {
  const files = () => Object.fromEntries(['transcript.txt', 'script-clean.txt', 'segments.json'].map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
  const reviewJson = () => JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
  const writeReviewJson = (r: unknown) => fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(r));

  for (const [s, e] of [[10, 15], [10.4, 14.6], [9.95, 15]] as const) {
    it(`${s}~${e}초: 새 줄은 모두 구간 안에서 시작하고, 반영 → 되돌리기가 세 파일을 바이트 그대로 돌린다`, async () => {
      const original = files();
      fakeDeps(path.join(root, 'userData'), { transcribe: () => EDGE });
      await retranscribeRange(dir, 'r1', s, e);
      const lines = readReview(dir)!.items[0]!.redo!.lines!;
      expect(lines.map((l) => l.text)).toEqual(expect.arrayContaining(['앞에서 시작한 말', '가운데 말']));
      expect(lines.map((l) => l.text)).not.toContain('끝에 걸친 말');
      for (const l of lines) expect(l.start >= s && l.start < e).toBe(true);

      applyRetranscribe(dir, 'r1');
      const applied = files();
      const stamps = applied['transcript.txt']!.split('\n').filter((l) => lines.some((x) => l.endsWith(x.text))).map((l) => /^\[(\d+):(\d+)\]/.exec(l)!).map((m) => Number(m[1]) * 60 + Number(m[2]));
      for (const t of stamps) expect(t >= Math.floor(s) && t < e).toBe(true);
      for (const x of readJson(dir, 'segments.json').segments.filter((x: Segment) => lines.some((l) => l.text === x.text))) expect(x.start >= s && x.start < e).toBe(true);

      applyRetranscribe(dir, 'r1'); // 두 번 눌러도 그대로
      expect(files()).toEqual(applied);
      revertReview(dir, 'r1');
      expect(files()).toEqual(original);
    });
  }

  it('반영이 파일 사이에서 끊긴 뒤 다시 반영해도 줄이 겹쳐 들어가지 않고, 되돌리면 처음과 같다', async () => {
    const original = files();
    fakeDeps(path.join(root, 'userData'), { transcribe: () => EDGE });
    await retranscribeRange(dir, 'r1', 10, 15);
    applyRetranscribe(dir, 'r1');
    const applied = files();
    // 녹취만 바꾸고 끊긴 것처럼: 정리본·녹취 구간은 처음 그대로, 반영 표시는 없음 (원래 줄 기록은 파일을 고치기 전에 남는다)
    fs.writeFileSync(path.join(dir, 'script-clean.txt'), original['script-clean.txt']!);
    fs.writeFileSync(path.join(dir, 'segments.json'), original['segments.json']!);
    const r = reviewJson();
    delete r.items[0].redo.appliedAt;
    r.items[0].status = 'open';
    writeReviewJson(r);
    applyRetranscribe(dir, 'r1');
    expect(files()).toEqual(applied);
    revertReview(dir, 'r1');
    expect(files()).toEqual(original);
  });

  it('고치기 전에 받아 둔 결과(구간 앞에서 시작하는 줄)를 반영해도 구간 안으로 당겨 넣고 기록도 그대로 맞춘다', async () => {
    const original = files();
    fakeDeps(path.join(root, 'userData'), { transcribe: () => EDGE });
    await retranscribeRange(dir, 'r1', 10, 15);
    const r = reviewJson();
    r.items[0].redo.lines[0].start = 9.7; // 예전 결과: 당기지 않은 시각
    writeReviewJson(r);
    applyRetranscribe(dir, 'r1');
    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toContain('[00:10] [화자 2] 앞에서 시작한 말');
    expect(readReview(dir)!.items[0]!.redo!.lines![0]!.start).toBe(10);
    revertReview(dir, 'r1');
    expect(files()).toEqual(original);
  });

  it('고치기 전에 반영한 항목: 구간 앞에 들어간 새 줄·녹취 구간을 기록(redo.lines)으로 찾아 하나씩 빼고, 원래 있던 같은 말 줄은 남긴다', () => {
    // 같은 시각·같은 말의 원래 줄([00:09] [화자 2] 네)이 있는 녹취에, 예전 반영이 같은 줄을 하나 더 넣은 상태를 만든다
    const T0 = '[00:02] [화자 1] 시작합니다\n[00:09] [화자 2] 네\n[00:10] [화자 2] 잘 안 들리는 말\n[00:12] [화자 2] 반복 반복\n[00:20] [화자 1] 마무리합니다\n';
    const S0 = [SEGMENTS[0], { start: 9.2, end: 9.6, text: '네', track: 'mic' }, ...SEGMENTS.slice(1)];
    fs.writeFileSync(path.join(dir, 'transcript.txt'), T0);
    fs.writeFileSync(path.join(dir, 'segments.json'), JSON.stringify({ model: 'large-v3', tracks: ['mic'], redo: [], segments: S0 }));
    const original = files();
    const lines = [{ start: 9.7, end: 10.5, text: '네', track: 'mic', label: '화자 2' }, { start: 11.5, end: 12.5, text: '가운데 말', track: 'mic', label: '화자 2' }];
    fs.writeFileSync(path.join(dir, 'transcript.txt'), '[00:02] [화자 1] 시작합니다\n[00:09] [화자 2] 네\n[00:09] [화자 2] 네\n[00:11] [화자 2] 가운데 말\n[00:20] [화자 1] 마무리합니다\n');
    fs.writeFileSync(path.join(dir, 'script-clean.txt'), '[00:02] [화자 1] 시작합니다\n[00:09] [화자 2] 네\n[00:11] [화자 2] 가운데 말\n[00:20] [화자 1] 마무리합니다\n');
    fs.writeFileSync(path.join(dir, 'segments.json'), JSON.stringify({ model: 'large-v3', tracks: ['mic'], redo: [], segments: [SEGMENTS[0], S0[1], { start: 9.7, end: 10.5, text: '네', track: 'mic' }, { start: 11.5, end: 12.5, text: '가운데 말', track: 'mic' }, SEGMENTS[3]] }));
    writeReviewJson({ items: [{ id: 'r1', kind: 'lost', at: '00:10', heard: null, heardNote: null, guess: null, note: '00:10~00:15 유실', status: 'applied', applied: '구간 다시 받아씀', count: 2,
      redo: { start: 10, end: 15, track: 'mic', lines, appliedAt: '2026-11-19T00:00:00.000Z', replaced: {
        'transcript.txt': ['[00:10] [화자 2] 잘 안 들리는 말', '[00:12] [화자 2] 반복 반복'], 'script-clean.txt': ['[00:10] [화자 2] 잘 안 들리는 말'], segments: [SEGMENTS[1], SEGMENTS[2]] } } }] });
    revertReview(dir, 'r1');
    expect(files()).toEqual(original);
  });
});
