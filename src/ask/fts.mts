// 질문으로 찾기의 색인: 이 Mac에서 녹취·회의록 전문 검색 (SQLite FTS5, trigram). src/ask.js에서 옮김 (결정 70).
// 색인(search-index.sqlite)은 지우고 다시 만들 수 있는 사본이다(원본은 회의 폴더). 회의 파일은 읽기만 한다.
// 색인을 여는 것은 index.mts가 한 번만 하고(예전 index()), 여기 함수는 그 여는 함수를 받아 부를 때 연다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AskMeeting } from './types.mjs';

export const SNIPS = 3; // 후보마다 걸린 곳

export type Index = () => DatabaseSync;
export interface Ref {
  src: string;
  n: number;
  term: string;
}
export interface Hit {
  mid: string;
  score: number;
  refs: Ref[];
}

// ── 색인 ──
export function openIndex(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY, sig TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS lines USING fts5(text, mid UNINDEXED, src UNINDEXED, n UNINDEXED, tokenize='trigram');`);
  return db;
}
const read = (dir: string, f: string): string => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const mtime = (dir: string, f: string): number => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } };
// 바뀐 회의만 다시 넣는다 (녹취·회의록·상태 파일의 수정 시각으로 판단)
export function syncIndex(index: Index, meetings: AskMeeting[]): void {
  const d = index();
  const known = new Map(d.prepare('SELECT id, sig FROM meetings').all().map((r) => [r.id as string, r.sig as string]));
  const del = d.prepare('DELETE FROM lines WHERE mid = ?');
  const ins = d.prepare('INSERT INTO lines(text, mid, src, n) VALUES (?, ?, ?, ?)');
  const up = d.prepare('INSERT OR REPLACE INTO meetings(id, sig) VALUES (?, ?)');
  d.exec('BEGIN');
  try {
    for (const m of meetings) {
      const sig = ['transcript.txt', 'minutes.md', 'minutes.json'].map((f) => mtime(m.dir, f)).join(':');
      if (known.get(m.id) === sig) { known.delete(m.id); continue; }
      known.delete(m.id);
      del.run(m.id);
      const parts = { title: [m.title ?? ''], summary: [m.summary ?? ''], minutes: read(m.dir, 'minutes.md').split('\n'), transcript: read(m.dir, 'transcript.txt').split('\n') };
      for (const [src, ls] of Object.entries(parts)) ls.forEach((t, n) => t.trim() && ins.run(t, m.id, src, n));
      up.run(m.id, sig);
    }
    for (const gone of known.keys()) { del.run(gone); d.prepare('DELETE FROM meetings WHERE id = ?').run(gone); }
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
// 찾을 말이 나온 줄. trigram은 3글자 이상만 찾아서 두 글자 말("장애")은 LIKE로
export function search(index: Index, terms: string[], allowed: Set<string>): Hit[] {
  const d = index();
  const byMatch = d.prepare('SELECT mid, src, n FROM lines WHERE lines MATCH ?');
  const byLike = d.prepare('SELECT mid, src, n FROM lines WHERE text LIKE ?');
  const hit = new Map<string, { terms: Set<string>; refs: Ref[] }>();
  for (const raw of terms) {
    const term = raw.trim();
    if (term.length < 2) continue;
    const rows = term.length >= 3 ? byMatch.all(`"${term.replace(/"/g, '""')}"`) : byLike.all(`%${term}%`);
    for (const r of rows) {
      if (!allowed.has(r.mid as string)) continue;
      const h = hit.get(r.mid as string) ?? { terms: new Set(), refs: [] };
      h.terms.add(term);
      h.refs.push({ src: r.src as string, n: Number(r.n), term });
      hit.set(r.mid as string, h);
    }
  }
  return [...hit.entries()].map(([mid, h]) => ({ mid, score: h.terms.size * 10 + Math.min(h.refs.length, 9), refs: h.refs })).sort((a, b) => b.score - a.score);
}
// 걸린 곳 앞뒤 한 줄씩, 녹취 먼저, 서로 다른 말 먼저
export function snippets(m: AskMeeting, refs: Ref[]): string[] {
  const docs: Record<string, string[]> = { minutes: read(m.dir, 'minutes.md').split('\n'), transcript: read(m.dir, 'transcript.txt').split('\n') };
  const ordered = [...refs].filter((r) => docs[r.src]).sort((a, b) => (a.src === 'transcript' ? 0 : 1) - (b.src === 'transcript' ? 0 : 1));
  const out: string[] = [];
  const seen = new Set<string>();
  const used = new Set<string>();
  for (const pass of [true, false]) {
    for (const r of ordered) {
      if (out.length >= SNIPS) break;
      if (pass && used.has(r.term)) continue;
      const key = `${r.src}:${r.n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      used.add(r.term);
      const ls = docs[r.src]!;
      out.push([ls[r.n - 1], ls[r.n], ls[r.n + 1]].filter((x) => x && x.trim()).join(' / '));
    }
  }
  return out;
}

// ── LLM ── 이 기능은 다듬기 설정과 상관없이 '자동' 규칙으로 고른다: Claude Code 먼저(측정: 정확도 비슷, 입력 약 1/4·시간 약 60%),
