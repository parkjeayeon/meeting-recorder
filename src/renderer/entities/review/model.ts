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
