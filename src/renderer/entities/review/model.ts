// 확인 필요 항목(review.json)의 화면 쪽 규칙
import { parseStamp } from '../../../core/script.mts';

export const REVIEW_KIND: Readonly<Record<string, string>> = { word: '오인식', name: '이름', meaning: '의미 불명', lost: '유실' };

/** 구간 다시 받아쓰기 범위(초): 설명에 'mm:ss~mm:ss'가 있으면 그 구간, 없으면 항목 시각 앞 10초~뒤 50초, 시각도 없으면 null */
export function itemRange(it: { readonly at?: string | null; readonly note?: string | null; readonly heardNote?: string | null }): { start: number; end: number } | null {
  const m = /(\d{1,2}:\d{2}(?::\d{2})?)\s*[~∼–-]\s*(\d{1,2}:\d{2}(?::\d{2})?)/.exec(`${it.note ?? ''} ${it.heardNote ?? ''}`);
  if (m && parseStamp(m[2]!) > parseStamp(m[1]!)) return { start: parseStamp(m[1]!), end: parseStamp(m[2]!) };
  if (!it.at) return null;
  const at = parseStamp(it.at);
  return { start: Math.max(0, at - 10), end: at + 50 };
}

/** 항목 카드에 보일 녹취 줄 하나: 시각·화자·말, 들린 말이 있으면 그 자리(hit) */
export interface ContextLine {
  readonly at: string;
  readonly speaker: string | null;
  readonly text: string;
  /** text 안에서 들린 말이 있는 구간 [시작, 끝) — 없으면 null */
  readonly hit: readonly [number, number] | null;
}

const LINE = /^\[([\d:]+)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/;

/**
 * 항목이 가리키는 녹취 줄과 그 앞 줄 (카드만 보고도 무슨 말이었는지 알게).
 * 들린 말이 있으면 그 말이 나온 줄 중 항목 시각에 가장 가까운 줄, 없으면 항목 시각 바로 그 줄(없으면 그 앞 줄).
 * 시각도 들린 말도 없거나 녹취에서 못 찾으면 빈 목록.
 */
export function contextLines(it: { readonly at?: string | null; readonly heard?: string | null }, transcript: string, before = 1): ContextLine[] {
  const lines = transcript.split('\n').map((l) => LINE.exec(l)).filter((m): m is RegExpExecArray => Boolean(m));
  if (!lines.length) return [];
  const at = it.at ? parseStamp(it.at) : null;
  const heard = it.heard || null;
  let pick = -1;
  if (heard) {
    let best = Infinity;
    lines.forEach((m, i) => {
      if (!m[3]!.includes(heard)) return;
      const gap = at === null ? i : Math.abs(parseStamp(m[1]!) - at);
      if (gap < best) [pick, best] = [i, gap];
    });
  }
  if (pick === -1 && at !== null) {
    for (let i = 0; i < lines.length && parseStamp(lines[i]![1]!) <= at; i++) pick = i;
    if (pick === -1) pick = 0;
  }
  if (pick === -1) return [];
  return lines.slice(Math.max(0, pick - before), pick + 1).map((m) => {
    const text = m[3]!;
    const i = heard ? text.indexOf(heard) : -1;
    return { at: m[1]!, speaker: m[2] ?? null, text, hit: i === -1 ? null : [i, i + heard!.length] };
  });
}

