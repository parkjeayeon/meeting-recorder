// 확인 필요 항목 다듬기 (LLM 출력 → 항목). 파일을 읽거나 쓰지 않는다. src/minutes.js가 불러 쓴다.

export interface ReviewItem {
  id: string;
  kind: 'word' | 'name' | 'meaning' | 'lost';
  at: string | null;
  heard: string | null; // 녹취에 실제로 있는 글자 (고칠 대상)
  heardNote: string | null; // LLM이 적은 그대로 (녹취에 없으면 설명으로만)
  guess: string | null;
  note: string;
  status: string;
  [extra: string]: unknown;
}

// 고칠 말에 설명이 섞여 오면 떼어 내고, 설명뿐이면 버린다 ("'반복문'으로 추정됨" → "반복문")
export function cleanGuess(g: unknown): string | null {
  if (typeof g !== 'string' || !g) return null;
  const t = g.replace(/\s*\(?(으)?로\s*추정(됨|된다|합니다)?\.?\)?$/, '').replace(/^['"‘“]|['"’”]$/g, '').trim();
  return !t || /추정|관련|불분명|가능성/.test(t) ? null : t;
}

// 회의록 본문에 괄호로 적힌 추정 ("통신 한정성(안정성으로 추정)"). 회의록 LLM이 확인 필요에 올리지 않고 본문에 써 버린 것.
// 확인 필요 섹션 안의 줄은 빼고 본문 줄만
const INLINE_GUESS = /\([^()\n]*추정[^()\n]*\)/;
export function inlineGuesses(md: string): string[] {
  const body = md.split(/^## 확인 필요/m)[0] ?? '';
  return body.split('\n').filter((l) => INLINE_GUESS.test(l)).map((l) => l.trim());
}

const KINDS = new Set(['word', 'name', 'meaning', 'lost']);

// LLM이 낸 항목을 확인 필요 항목으로: 녹취에 실제로 있는 글자만 고칠 대상으로 삼고, 이미 열린 같은 항목은 건너뛴다.
// 번호는 지금 있는 항목 다음부터 (r3까지 있으면 r4)
export function toReviewItems(list: unknown, transcript: string, existing: Pick<ReviewItem, 'id' | 'status' | 'heard'>[], extra: Record<string, unknown> = {}): ReviewItem[] {
  let n = Math.max(0, ...existing.map((it) => Number(/^r(\d+)$/.exec(it.id)?.[1] ?? 0)));
  const items: ReviewItem[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const said = typeof it.heard === 'string' && it.heard.trim() ? it.heard : null;
    const heard = said && transcript.includes(said) ? said : null;
    const note = typeof it.note === 'string' ? it.note.trim().slice(0, 300) : '';
    if (heard && [...existing, ...items].some((x) => x.status === 'open' && x.heard === heard)) continue;
    if (!heard && !note) continue; // 녹취에서 못 찾았고 설명도 없으면 고를 게 없다
    const kind = typeof it.kind === 'string' && KINDS.has(it.kind) ? (it.kind as ReviewItem['kind']) : heard ? 'word' : 'meaning';
    const at = typeof it.at === 'string' && /^\d{1,2}(:\d{2}){1,2}$/.test(it.at) ? it.at : null;
    items.push({ id: `r${++n}`, kind, at, heard, heardNote: said, guess: cleanGuess(it.guess), note, status: 'open', ...extra });
  }
  return items;
}
