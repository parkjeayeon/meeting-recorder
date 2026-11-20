// 확인 필요 › 구간 다시 받아쓰기: 유실·잘못 들린 구간만 녹음에서 잘라 Whisper로 다시 받아쓰고, '녹취에 반영'할 때 그 구간 줄만 바꾼다.
// Electron을 쓰지 않는다. Whisper 서버·지금 설정·앱 데이터 폴더는 deps.mts로 받는다 (결정 70). 되돌리기는 src/review(revertReview)가 한다.
import fs from 'node:fs';
import path from 'node:path';
import { copyFileAtomic, writeFileAtomic, writeJsonAtomic } from '../core/write.mjs';
import { parseClock, spliceLines } from '../review/lines.mjs';
import { readJsonFile, readReview, readText, writeReview, type Redo, type Review } from '../review/store.mjs';
import { restoreRedoRange } from '../review/apply.mjs';
import { REDO_MAX_SEC } from '../review/assist.mjs';
import { decodeTo16k, recordedTracks, sliceTo16k, trackPath } from './audio.mjs';
import { getSettings, startDedicatedServer, transcribeSegments, userData } from './deps.mjs';
import { labelRedoLines } from './diarize.mjs';
import { enqueue } from './queue.mjs';
import { MEETING_MODEL, meetingAsr } from './transcribe.mjs';
import { clock, formatLine } from './transcript.mjs';

// 앞 문장을 이어 받지 않고(반복에 갇히지 않게), 소리가 작으면 키워서 넣는다. 결과는 확인 항목에 두었다가 '녹취에 반영'할 때만 그 구간 줄을 바꾼다 (다른 줄은 그대로)
export const REDO_PAD_SEC = 0.5;

export function retranscribeRange(dir: string, itemId: string, start: number | string, end: number | string): Promise<{ start: number; end: number; gain: number; text: string; empty: boolean }> {
  return enqueue(async () => {
    const s = Number(start);
    const e = Number(end);
    if (!(e > s) || e - s > REDO_MAX_SEC) throw new Error('다시 받아쓸 구간은 10분 이내로 골라 주세요');
    const review = readReview(dir);
    const item = review?.items.find((it) => it.id === itemId);
    if (!item) throw new Error('확인 항목이 없습니다');
    const meta = JSON.parse(readText(dir, 'meta.json'));
    const tracks = recordedTracks(dir, meta);
    const track = tracks.includes('mic') ? 'mic' : tracks[0];
    if (!track) throw new Error('녹음 파일이 없습니다');
    const tmp = path.join(dir, `.redo-${itemId}.wav`);
    // 압축한 녹음이면 먼저 16kHz WAV로 푼다 (2시간에 약 1초) — 구간 자르기는 WAV를 바이트로 읽는다
    let source = trackPath(dir, meta, track)!;
    const decoded = /\.wav$/i.test(source) ? null : path.join(dir, `.redo-${itemId}-src.wav`);
    if (decoded) {
      await decodeTo16k(source, decoded);
      source = decoded;
    }
    const settings = getSettings();
    let server: Awaited<ReturnType<typeof startDedicatedServer>> = null;
    try {
      const cut = sliceTo16k(source, Math.max(0, s - REDO_PAD_SEC), e + REDO_PAD_SEC, tmp);
      server = await startDedicatedServer(path.join(userData(), 'models', MEETING_MODEL)).catch(() => null);
      const segs = (await transcribeSegments(tmp, meetingAsr(settings), server?.port ?? null, { noContext: true }))
        .map((x) => ({ start: x.start + cut.start, end: x.end + cut.start, text: x.text }))
        .filter((x) => (x.start + x.end) / 2 >= s && (x.start + x.end) / 2 < e); // 앞뒤 여유분에 걸친 말은 옆 줄과 겹치므로 뺀다
      const lines = labelRedoLines(dir, segs, track, tracks);
      // 지난 반영이 도중에 끊겼으면(원래 줄만 기록되고 반영 표시가 없음) 그 구간을 먼저 원래대로 돌린 뒤 새 결과로 바꾼다
      if (item.redo?.replaced && !item.redo.appliedAt) restoreRedoRange(dir, item.redo);
      item.redo = { start: s, end: e, track, gain: cut.gain, lines, model: server ? 'large-v3' : 'large-v3-turbo', at: new Date() };
      writeReview(dir, review!);
      return { start: s, end: e, gain: cut.gain, text: lines.map(formatLine).join('\n'), empty: !lines.length };
    } finally {
      server?.stop();
      fs.rmSync(tmp, { force: true });
      if (decoded) fs.rmSync(decoded, { force: true });
    }
  });
}

type RedoLine = { start: number; end: number; text: string; track: string; label?: string | null };

export function applyRetranscribe(dir: string, itemId: string): Review {
  const review = readReview(dir);
  const item = review?.items.find((it) => it.id === itemId);
  if (!item?.redo) throw new Error('다시 받아쓴 결과가 없습니다');
  const { start, end, track } = item.redo;
  const lines = item.redo.lines as RedoLine[];
  if (!lines.length) throw new Error('다시 받아써도 알아들을 수 있는 말이 없었습니다');
  if (item.redo.appliedAt) return review!; // 이미 반영함 (두 번 눌러도 원래 줄 기록을 덮지 않게)
  const inRange = (l: string) => {
    const m = /^\[([\d:]+)\]/.exec(l);
    return m && parseClock(m[1]!) >= Math.floor(start) && parseClock(m[1]!) < end;
  };
  const files = (['transcript.txt', 'script-clean.txt'] as const).filter((f) => fs.existsSync(path.join(dir, f)));
  const segFile = path.join(dir, 'segments.json');
  const seg = readJsonFile(segFile);
  // 되돌리기용으로 이 구간에 원래 있던 줄을 파일을 고치기 '전에' 기록해 둔다. 고치는 중에 끊기면 다음에 누를 때 이 기록을 그대로 쓴다
  // (나중에 기록하면, 끊긴 뒤 다시 누를 때 이미 바뀐 줄을 원래 줄로 기억해 되돌릴 수 없게 된다)
  if (!item.redo.replaced) {
    const before: NonNullable<Redo['replaced']> = {};
    for (const f of files) before[f] = readText(dir, f).split('\n').filter(inRange);
    if (seg?.segments) before.segments = seg.segments.filter((x: RedoLine) => x.track === track && x.start >= start && x.start < end);
    item.redo.replaced = before;
    writeReview(dir, review!);
  }
  const replaced = item.redo.replaced;
  for (const f of files) {
    const p = path.join(dir, f);
    const backup = path.join(dir, f.replace(/\.(\w+)$/, '.before-review.$1'));
    if (!fs.existsSync(backup)) copyFileAtomic(p, backup);
    writeFileAtomic(p, spliceLines(readText(dir, f), start, end, lines.map(formatLine)));
  }
  // 나중에 스크립트를 다시 만들어도 반영되도록 녹취 구간(segments.json)도 바꾼다 (같은 구간을 다시 바꿔도 결과가 같다)
  if (seg?.segments) {
    seg.segments = [
      ...seg.segments.filter((x: RedoLine) => x.track !== track || x.start < start || x.start >= end),
      ...lines.map(({ start: a, end: b, text, track: t }) => ({ start: a, end: b, text, track: t })),
    ].sort((a, b) => a.start - b.start);
    writeJsonAtomic(segFile, seg, 0);
  }
  const text = lines.map(formatLine).join('\n');
  Object.assign(item, { status: 'applied', applied: '구간 다시 받아씀', count: lines.length });
  // 확인 마치기에서 회의록 해당 부분에 반영하도록 새로 받아쓴 내용을 남긴다
  item.chat = [...(item.chat ?? []), { user: `(${clock(start)}~${clock(end)} 구간을 다시 받아써 녹취에 반영함)`, assistant: text.slice(0, 1200) }].slice(-4);
  item.redo.appliedAt = new Date();
  item.redo.replaced = replaced;
  return writeReview(dir, review!);
}
