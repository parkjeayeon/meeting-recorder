// 받아쓰기 기록(dictations.jsonl) 읽기·찾기·나눠 보기·통계. 파일은 읽기만 한다. src/main.js가 불러 쓴다.
// 예전에는 화면이 최근 300개만 받아 목록·검색·통계를 그 안에서 했다 → 기록이 쌓이면 오래된 것이 목록·검색·통계에서 조용히 빠졌다 (2026-11-07).
// 이제 목록은 최신순으로 나눠(커서) 받고, 검색과 통계는 본체가 전체 기록으로 한다.

export interface DictRecord {
  id: string;
  startedAt: string;
  durationSec?: number;
  app?: string | null;
  words?: number;
  chars?: number;
  wpm?: number;
  language?: string | null; // 실제로 받아쓴 언어 (자동이면 고른 언어)
  status?: string;
  raw?: string | null;
  text?: string | null;
  cleanupProvider?: string | null;
  cleanupError?: string | null;
  timing?: { transcribeMs?: number; cleanupMs?: number; pasteMs?: number };
}

// 화면에 보이는 기록만: 받아쓴 글이 있고, 말이 없었거나 지어낸 문장으로 걸러진 시도는 뺀다 (통계용 기록으로만 남는다)
export function parseDictationLog(text: string): DictRecord[] {
  const out: DictRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as DictRecord;
      if (d?.raw && d.status !== 'empty' && typeof d.startedAt === 'string') out.push(d);
    } catch {}
  }
  return out.sort((a, b) => b.startedAt.localeCompare(a.startedAt)); // 최신순
}

const charsOf = (r: DictRecord) => r.chars ?? (r.text ?? r.raw ?? '').length;
const localDay = (iso: string | Date) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 나눠 보기: before(그 기록의 startedAt·id보다 오래된 것부터)로 이어 받는다. q가 있으면 글·원문·앱 이름에서 찾는다(대소문자 무시)
export function pageDictations(records: DictRecord[], { q = '', before = null as string | null, limit = 50 } = {}) {
  const needle = q.trim().toLowerCase();
  const matched = needle ? records.filter((r) => `${r.text ?? ''} ${r.raw ?? ''} ${r.app ?? ''}`.toLowerCase().includes(needle)) : records;
  let start = 0;
  if (before) {
    const i = matched.findIndex((r) => r.id === before);
    start = i >= 0 ? i + 1 : matched.length;
  }
  const items = matched.slice(start, start + limit);
  const last = items.at(-1);
  return { items, total: records.length, matched: matched.length, next: start + limit < matched.length && last ? last.id : null };
}

export interface DictationStats {
  count: number;
  total: number; // 받아쓴 글자
  today: number;
  todayCount: number;
  wpm: number | null;
  streak: number;
  days: { date: string; chars: number; count: number }[]; // 최근 14일, 오래된 날부터
  apps: { app: string; chars: number }[]; // 많이 쓴 앱 6개
  languages: { language: string; chars: number; count: number }[]; // 많이 쓴 순
  asrMs: number | null;
  cleanup: { provider: string; avgMs: number; count: number }[];
}

export function dictationStats(records: DictRecord[], now = new Date()): DictationStats {
  const today = localDay(now);
  const byDay = new Map<string, { chars: number; count: number }>();
  const byApp = new Map<string, number>();
  const byLang = new Map<string, { chars: number; count: number }>();
  const providers = new Map<string, number[]>();
  const wpms: number[] = [];
  const asr: number[] = [];
  let total = 0;
  for (const r of records) {
    const c = charsOf(r);
    total += c;
    const day = localDay(r.startedAt);
    const d = byDay.get(day) ?? { chars: 0, count: 0 };
    byDay.set(day, { chars: d.chars + c, count: d.count + 1 });
    const app = r.app || '알 수 없음';
    byApp.set(app, (byApp.get(app) ?? 0) + c);
    const lang = r.language || 'ko'; // 언어를 적기 전 기록은 한국어로 받아썼다
    const l = byLang.get(lang) ?? { chars: 0, count: 0 };
    byLang.set(lang, { chars: l.chars + c, count: l.count + 1 });
    if (r.wpm && r.wpm > 0) wpms.push(r.wpm);
    if (typeof r.timing?.transcribeMs === 'number') asr.push(r.timing.transcribeMs);
    if (r.cleanupProvider && r.timing?.cleanupMs) {
      const list = providers.get(r.cleanupProvider) ?? [];
      list.push(r.timing.cleanupMs);
      providers.set(r.cleanupProvider, list);
    }
  }
  // 연속 사용: 오늘 아직 안 썼으면 어제부터 센다
  let streak = 0;
  const cur = new Date(now);
  if (!byDay.has(localDay(cur))) cur.setDate(cur.getDate() - 1);
  while (byDay.has(localDay(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13 + i);
    const key = localDay(d);
    return { date: key, ...(byDay.get(key) ?? { chars: 0, count: 0 }) };
  });
  const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  return {
    count: records.length,
    total,
    today: byDay.get(today)?.chars ?? 0,
    todayCount: byDay.get(today)?.count ?? 0,
    wpm: wpms.length ? Math.round(avg(wpms)!) : null,
    streak,
    days,
    apps: [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([app, chars]) => ({ app, chars })),
    languages: [...byLang.entries()].sort((a, b) => b[1].chars - a[1].chars).map(([language, v]) => ({ language, ...v })),
    asrMs: avg(asr),
    cleanup: [...providers.entries()].map(([provider, list]) => ({ provider, avgMs: avg(list)!, count: list.length })),
  };
}
