// 녹취 구간 → 대화 스크립트: 같은 문장 반복 구간 찾기, 화자 붙이기, 연달아 같은 말 합치기, 줄 쓰기.
// 파일을 읽거나 쓰지 않는다. 본체(CommonJS)는 src/minutes.js가 require('../lib/meeting/index.mjs')로 불러 쓴다 (결정 70).
import { clock } from '../core/script.mjs';
import { smoothTurns, type Turn } from '../core/turns.mjs';

export const SPEAKER: Record<string, string> = { mic: '나', system: '상대방' };

// Whisper가 돌려주는 녹취 구간 (초)
export interface Segment {
  start: number;
  end: number;
  text: string;
}

// ── 같은 문장 반복 구간 ─────────────────────────────────────────────────
// Whisper는 앞 문장을 이어 받아 쓰는데, 작은 목소리·잡음 구간에서 한 문장에 갇히면 조각이 끝날 때까지
// 1초마다 같은 문장을 적는다 (30분 회의에서 3.5분, 2시간 회의에서 8.5분이 이렇게 빠짐).
// 매번 생기는 게 아니라 같은 녹음도 다시 돌리면 대개 제대로 나오므로, 그 구간만 앞 문장 없이 다시 받아쓴다 (src/minutes.js redoLoops).
export const LOOP_MIN_REPEATS = 3; // 같은 줄(또는 같은 두세 줄 묶음)이 3번 이상
export const LOOP_MAX_PERIOD = 3;
export const LOOP_MIN_SEC = 15;

// 같은 줄이 이어지거나("A A A …"), 두세 줄이 번갈아 되풀이되는("A 네 A 네 …") 구간
export function findLoops(segs: readonly Segment[]): { start: number; end: number }[] {
  const norm = (t: string) => t.replace(/[\s.,!?…~]/g, '');
  const texts = segs.map((x) => norm(x.text));
  const loops: { start: number; end: number }[] = [];
  for (let i = 0; i < segs.length; ) {
    let best = i; // 반복이 끝나는 줄 (포함)
    for (let p = 1; p <= LOOP_MAX_PERIOD; p++) {
      let j = i + p;
      while (j < segs.length && texts[j] === texts[j - p]) j++;
      if ((j - i) / p >= LOOP_MIN_REPEATS && j - 1 > best) best = j - 1;
    }
    const long = segs[best]!.end - segs[i]!.start >= LOOP_MIN_SEC;
    // 한 줄 안에서 같은 말을 되풀이한 경우 ("네 네 네 네 네 …")
    const stutter = best === i && long && /(.{2,}?)\1{4,}/.test(texts[i]!);
    if ((best > i && long) || stutter) loops.push({ start: segs[i]!.start, end: segs[best]!.end });
    i = best + 1;
  }
  return loops;
}

// ── 화자 붙이기 ──────────────────────────────────────────────────────────
export const NEAREST_SPEAKER_SEC = 2; // 겹치는 화자가 없으면 이 안에 있는 가장 가까운 화자에게 붙인다

// 화자를 붙일 녹취 줄 (label을 채운다)
export interface LabeledLine {
  start: number;
  end: number;
  label?: string | null;
}

// 녹취 구간마다 가장 많이 겹치는 화자를 붙이고, 처음 말한 순서대로 "화자 1, 2…"로 부른다
// names: 이미 정한 번호(화자 구분 결과 → '화자 N')를 이어 쓸 때 넘긴다 (구간 다시 받아쓰기)
export function assignSpeakers(lines: LabeledLine[], turns: readonly Turn[], names: Map<string, string> = new Map()): number {
  turns = smoothTurns(turns); // 같은 사람 말 중간에 몇 초만 다른 사람으로 잡힌 조각을 되돌린다 (src/core/turns.mts)
  for (const line of lines) {
    let best: string | null = null;
    let bestOverlap = 0;
    let nearest: string | null = null;
    let nearestGap = NEAREST_SPEAKER_SEC;
    for (const t of turns) {
      const gap = Math.max(t.start - line.end, line.start - t.end, 0);
      if (gap < nearestGap || (gap === 0 && !nearest)) [nearest, nearestGap] = [t.speaker, gap];
      if (t.end <= line.start || t.start >= line.end) continue;
      const overlap = Math.min(t.end, line.end) - Math.max(t.start, line.start);
      if (overlap > bestOverlap) [best, bestOverlap] = [t.speaker, overlap];
    }
    best ??= nearest;
    if (!best) continue;
    if (!names.has(best)) names.set(best, `화자 ${names.size + 1}`);
    line.label = names.get(best);
  }
  return names.size;
}

// ── 스크립트 ─────────────────────────────────────────────────────────────
// 스크립트 줄 하나가 될 녹취 구간 (track: 'mic' | 'system')
export interface TranscriptLine extends Segment {
  track?: string;
  label?: string | null;
}

// 같은 사람이 같은 말을 연달아 한 줄(조용할 때 Whisper가 적는 "그" 반복, 같은 문장 두 번 적기)은 하나로 합친다
export function collapseRepeats<T extends TranscriptLine>(lines: readonly T[]): T[] {
  const norm = (t: string) => t.replace(/[\s.,!?…~]/g, '');
  const kept: T[] = [];
  for (const line of lines) {
    const prev = kept.at(-1);
    if (prev && prev.label === line.label && norm(prev.text) === norm(line.text)) {
      prev.end = Math.max(prev.end, line.end);
      continue;
    }
    kept.push({ ...line });
  }
  return kept;
}

// 녹취 구간 + 화자 구간 → 대화 스크립트 텍스트
export function buildTranscript(segments: readonly TranscriptLine[], diarization: { segments?: readonly Turn[] } | null | undefined, tracks: readonly string[]): { text: string; speakerCount: number } {
  const lines: TranscriptLine[] = segments.map((l) => ({ ...l, label: null }));
  let speakerCount = 0;
  if (diarization?.segments) speakerCount = assignSpeakers(lines.filter((l) => l.track === 'mic'), diarization.segments);
  for (const l of lines) l.label ??= tracks.length > 1 ? SPEAKER[l.track as string] : null;
  const text = collapseRepeats(lines)
    .map((l) => `[${clock(l.start)}]${l.label ? ` [${l.label}]` : ''} ${l.text}`)
    .join('\n');
  return { text, speakerCount };
}

// 스크립트 줄 하나: "[mm:ss] [화자] 말" (화자가 없으면 시각 뒤에 바로 말)
export const formatLine = (l: TranscriptLine): string => `[${clock(l.start)}]${l.label ? ` [${l.label}]` : ''} ${l.text}`;

export { clock };
