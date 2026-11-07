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
    const given = typeof it.at === 'string' && /^\d{1,2}(:\d{2}){1,2}$/.test(it.at) ? it.at : null;
    const at = stampFor({ at: given, heard, heardNote: said, note }, transcript);
    items.push({ id: `r${++n}`, kind, at, heard, heardNote: said, guess: cleanGuess(it.guess), note, status: 'open', ...extra });
  }
  return items;
}

// 메모에 따옴표로 적힌 표기 중 녹취에 실제로 있는 것 ("화자 2의 이름이 '원성'과 '원석'으로 혼재" → ['원성', '원석']).
// 이름이 두 가지로 섞인 항목에서 어느 쪽으로 통일할지 고르게 하고, 고칠 말을 들린 말과 똑같이 넣었을 때 바꿀 다른 표기를 찾는다
export function noteVariants(note: string | null | undefined, transcript: string): string[] {
  const out: string[] = [];
  for (const m of String(note ?? '').matchAll(/['"‘“「]([^'"‘’“”「」\n]{1,20})['"’”」]/g)) {
    const v = m[1]!.trim();
    if (v && transcript.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

// 시각이 없는 항목의 시각: 고칠 말(없으면 메모에 따옴표로 적힌 말)이 녹취에 처음 나온 줄의 시각.
// 회의록 메모에 시각이 안 적혀 있으면 LLM이 at을 비워 둔다 ("'하윤님'이 대표를 가리키는지 불분명함")
// 이미 고친 항목은 녹취에 고칠 말이 없다 ('하윤님' → '대표님'으로 적용한 뒤) — 되돌리기 기록에 남은 고친 줄의 시각을 쓴다
export function stampFor(item: Pick<ReviewItem, 'at' | 'heard' | 'heardNote' | 'note'> & { undo?: unknown }, transcript: string): string | null {
  if (item.at) return item.at;
  const changed = (item.undo as Record<string, { changed?: { from?: string }[] }> | undefined)?.['transcript.txt']?.changed ?? [];
  for (const c of changed) {
    const m = /^\[([\d:]+)\]/.exec(c.from ?? '');
    if (m) return m[1]!;
  }
  for (const key of searchKeys(item, transcript)) {
    for (const line of transcript.split('\n')) {
      const m = /^\[([\d:]+)\]\s*(?:\[[^\]]+\]\s*)?(.*)$/.exec(line);
      if (m && m[2]!.includes(key)) return m[1]!;
    }
  }
  return stampFromNote(item.note, transcript);
}

// 고칠 말도 따옴표 말도 없는 항목("매출 30억 외에 내년 목표 매출은 말이 끊겨 확인할 수 없음"): 메모의 낱말이 가장 많이
// 겹치는 녹취 줄의 시각. 숫자가 든 낱말은 3점, 나머지는 1점. 가장 높은 줄이 3점 이상이고 90초 밖의 다른 곳보다 2점 넘게 높을 때만 —
// 애매하면 null (엉뚱한 구간을 다시 받아쓰지 않게, 그때는 화면에서 구간을 직접 고른다)
const NOTE_STOP = new Set(['확인', '확인할', '없음', '내용', '말이', '끊겨', '끊김', '불분명', '필요', '회의', '부분', '유실', '유실됨', '중간', '일부', '관련', '이후', '이전', '대한', '설명', '언급', '있음', '있는', '하는', '정확한', '정확히', '알아듣기', '어려움', '들리지', '않음', '반복', '반복됨']);
export function stampFromNote(note: string | null | undefined, transcript: string): string | null {
  const words = [...new Set(String(note ?? '').split(/\s+/)
    .map((w) => w.replace(/[.,·'"‘’“”()]/g, '').replace(/(으로|에서|에게|까지|부터|이라|라는|은|는|이|가|을|를|에|의|외|도|로|와|과|만)$/, ''))
    .filter((w) => w.length >= 2 && !NOTE_STOP.has(w)))];
  if (!words.length) return null;
  const scored: { at: string; score: number }[] = [];
  for (const line of transcript.split('\n')) {
    const m = /^\[([\d:]+)\]\s*(?:\[[^\]]+\]\s*)?(.*)$/.exec(line);
    if (!m) continue;
    let score = 0;
    for (const w of words) if (m[2]!.includes(w)) score += /\d/.test(w) ? 3 : 1;
    if (score) scored.push({ at: m[1]!, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 3) return null;
  // 90초 안의 줄은 같은 곳으로 본다 (다시 받아쓰기는 그 앞뒤 1분을 받는다). 다른 곳에 비슷한 줄이 있을 때만 애매하다고 본다
  const sec = (t: string) => t.split(':').reduce((n, x) => n * 60 + Number(x), 0);
  const elsewhere = scored.find((x) => Math.abs(sec(x.at) - sec(best.at)) > 90);
  return !elsewhere || best.score >= elsewhere.score + 2 ? best.at : null;
}

// LLM이 채팅에서 제안한 "고칠 말"을 녹취에서 찾는다. 그대로 있으면 그것, 띄어쓰기만 다르면 녹취에 실제로 있는 글자로 바꿔 준다
// ("박 편님" ↔ "박편님"). 시각·화자 표시([00:05] [화자 1])는 건너뛴다. 못 찾으면 null — 이때 적용 버튼 대신 이유를 보인다
export function locateHeard(heard: string | null | undefined, transcript: string): string | null {
  const want = String(heard ?? '').trim();
  if (!want) return null;
  if (transcript.includes(want)) return want;
  const chars = [...want.replace(/\s+/g, '')];
  if (chars.length < 2 || chars.length > 80) return null;
  const re = new RegExp(chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'));
  for (const line of transcript.split('\n')) {
    const body = line.replace(/^\[[\d:]+\]\s*(?:\[[^\]]+\]\s*)?/, '');
    const m = re.exec(body);
    if (m) return m[0];
  }
  return null;
}

// 녹취에서 이 항목이 나온 곳을 찾을 말 (앞에 둔 것일수록 정확): 고칠 말 → LLM이 적은 표기 → 메모에 따옴표로 적힌 표기 →
// 그 표기의 조각. 메모 표기는 녹취에 그대로 없는 일이 많다 ("'하윤님(팀장님)'이 누구인지" → 녹취에는 "하윤님"만) —
// 그러면 괄호·띄어쓰기로 나눈 조각과 '님'을 뗀 이름으로 찾는다. 녹취에 실제로 있는 말만, 두 글자 이상만
export function searchKeys(item: Pick<ReviewItem, 'heard' | 'heardNote' | 'note'>, transcript: string): string[] {
  const quoted = [...String(item.note ?? '').matchAll(/['"‘“「]([^'"‘’“”「」\n]{1,30})['"’”」]/g)].map((m) => m[1]!.trim());
  const whole = [item.heard, item.heardNote, ...quoted].filter((k): k is string => Boolean(k && k.trim())).map((k) => k.trim());
  const parts: string[] = [];
  for (const w of whole) {
    for (const piece of w.split(/[()（）[\]\s,·/]+/)) {
      if (piece.length >= 2) parts.push(piece);
      const bare = piece.replace(/님$/, '');
      if (bare !== piece && bare.length >= 2) parts.push(bare);
    }
  }
  const body = transcript.split('\n').map((l) => l.replace(/^\[[\d:]+\]\s*(?:\[[^\]]+\]\s*)?/, '')).join('\n');
  return [...new Set([...whole, ...parts])].filter((k) => body.includes(k));
}
