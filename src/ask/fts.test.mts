import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndex, search, snippets, syncIndex } from './fts.mjs';
import type { AskMeeting } from './types.mjs';

let root = '';
let db: DatabaseSync;
const index = () => db;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-fts-'));
  db = openIndex(path.join(root, 'search-index.sqlite'));
});
afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});
function meeting(id: string, transcript: string[], minutes = '', extra: Partial<AskMeeting> = {}): AskMeeting {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'transcript.txt'), transcript.join('\n'));
  if (minutes) fs.writeFileSync(path.join(dir, 'minutes.md'), minutes);
  return { id, dir, startedAt: '2026-11-01T01:00:00.000Z', title: `${id} 회의`, summary: null, status: 'done', ...extra };
}
const rows = (id: string) => (db.prepare('SELECT count(*) n FROM lines WHERE mid = ?').get(id) as { n: number }).n;

describe('search (trigram, 두 글자는 LIKE)', () => {
  it('세 글자 이상은 trigram으로, 두 글자는 LIKE로 찾고, 한 글자는 버린다', () => {
    const ms = [meeting('a', ['[00:01] [화자 1] 지난주 장애 회고', '[00:02] [화자 2] 배포 일정']), meeting('b', ['[00:01] 장애물 경주'])];
    syncIndex(index, ms);
    const all = new Set(['a', 'b']);
    expect(search(index, ['장애'], all).map((h) => h.mid).sort()).toEqual(['a', 'b']);
    expect(search(index, ['장애 회고'], all).map((h) => h.mid)).toEqual(['a']);
    expect(search(index, ['일', ' '], all)).toEqual([]);
    // trigram 색인은 두 글자를 MATCH로 못 찾는다 — 그래서 LIKE (이 성질이 바뀌면 이 갈래를 다시 볼 것)
    expect(db.prepare('SELECT count(*) n FROM lines WHERE lines MATCH ?').get('"장애"')).toEqual({ n: 0 });
  });

  it('점수는 서로 다른 말 수 × 10 + 걸린 줄 수(9까지), 허용한 회의만, 따옴표는 이스케이프', () => {
    const ms = [
      meeting('a', ['배포 배포', '배포', '롤백 계획'], '# 배포\n- 롤백'),
      meeting('b', Array.from({ length: 12 }, () => '배포만 열두 번')),
      meeting('c', ['배포 롤백 "따옴표" 말']),
    ];
    syncIndex(index, ms);
    const hits = search(index, ['배포', '롤백', '"따옴표"'], new Set(['a', 'b']));
    expect(hits.map((h) => [h.mid, h.score])).toEqual([['a', 2 * 10 + 5], ['b', 10 + 9]]);
    expect(hits[0]!.refs.filter((r) => r.term === '롤백').map((r) => `${r.src}:${r.n}`).sort()).toEqual(['minutes:1', 'transcript:2']);
    expect(search(index, ['"따옴표"'], new Set(['c'])).map((h) => h.mid)).toEqual(['c']);
  });
});

describe('syncIndex', () => {
  it('제목·요약·회의록·녹취를 줄마다 넣고, 바뀐 회의만 다시, 없어진 회의는 뺀다', () => {
    const a = meeting('a', ['첫 줄', '', '셋째 줄'], '# 회의록', { summary: '요약 글' });
    const b = meeting('b', ['다른 회의']);
    syncIndex(index, [a, b]);
    expect(rows('a')).toBe(1 + 1 + 1 + 2); // 제목·요약·회의록 한 줄·녹취 빈 줄 빼고 둘
    db.prepare("INSERT INTO lines(text, mid, src, n) VALUES ('표시', 'b', 'x', 0)").run();
    syncIndex(index, [a, b]);
    expect(rows('b')).toBe(3); // 수정 시각이 같으면 다시 넣지 않는다 (넣어 둔 표시가 남음)
    const later = new Date(Date.now() + 10000);
    fs.utimesSync(path.join(b.dir, 'transcript.txt'), later, later);
    syncIndex(index, [a, b]);
    expect(rows('b')).toBe(2);
    syncIndex(index, [b]);
    expect([rows('a'), (db.prepare("SELECT count(*) n FROM meetings WHERE id = 'a'").get() as { n: number }).n]).toEqual([0, 0]);
  });
});

describe('snippets', () => {
  it('걸린 줄 앞뒤 한 줄씩, 녹취 먼저, 서로 다른 말 먼저, 셋까지', () => {
    const m = meeting('a', ['앞', '배포 이야기', '뒤', '', '롤백 이야기', '배포 또', '끝'], '# 회의록\n배포 요약');
    const refs = [{ src: 'minutes', n: 1, term: '배포' }, { src: 'transcript', n: 1, term: '배포' }, { src: 'transcript', n: 5, term: '배포' }, { src: 'transcript', n: 4, term: '롤백' }, { src: 'title', n: 0, term: '배포' }];
    expect(snippets(m, refs)).toEqual(['앞 / 배포 이야기 / 뒤', '롤백 이야기 / 배포 또', '롤백 이야기 / 배포 또 / 끝']);
  });
});
