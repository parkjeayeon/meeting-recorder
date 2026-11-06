// 검색 평가 결과를 저장소에 올릴 수 있게 거른다: eval-runs/(git 제외) → docs/eval/(커밋).
//   node scripts/dev/eval/publish.mjs
// 올리는 것: 실행마다 설정·요약, 지어낸 회의 질문의 질문별 결과·쓴 회의 목록, 실행 누적 수치(history.csv)
// 빼는 것: LLM 호출 원문(calls.jsonl, 녹취 인용이 들어감), 실제 회의 정답(real-labels.json), 실제 회의 질문 원문·제목·id
// 실제 회의 질문은 번호(r1…)와 수치만 남긴다. 끝으로 금지어(회사명·실명 등, eval-runs/forbidden.txt)가 하나라도 있으면 실패한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = path.join(REPO, 'eval-runs');
const DST = path.join(REPO, 'docs/eval');
const REAL_ID = /\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_meeting/g; // 실제 회의 폴더 이름 (지어낸 회의 id는 s000)

const labels = fs.existsSync(path.join(SRC, 'real-labels.json')) ? JSON.parse(fs.readFileSync(path.join(SRC, 'real-labels.json'), 'utf8')) : { queries: [], meetings: {} };
const realQ = new Map(labels.queries.map((q) => [q.id, q.q]));
const hideReal = (text) => {
  let t = text.replace(REAL_ID, '(실제 회의)');
  for (const [id, q] of realQ) t = t.split(q).join(`(실제 회의 질문 ${id})`);
  return t;
};

fs.mkdirSync(DST, { recursive: true });
const runs = fs.readdirSync(SRC).filter((d) => /^\d{4}-\d{2}-\d{2}T/.test(d) && fs.existsSync(path.join(SRC, d, 'summary.md'))).sort();
for (const run of runs) {
  const from = path.join(SRC, run);
  const to = path.join(DST, run);
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'config.json'), hideReal(fs.readFileSync(path.join(from, 'config.json'), 'utf8')));
  fs.writeFileSync(path.join(to, 'summary.md'), hideReal(fs.readFileSync(path.join(from, 'summary.md'), 'utf8')));
  // 질문별 결과: 지어낸 회의 질문은 그대로(회의 id에서 실제 회의만 가림), 실제 회의 질문은 수치만
  const rows = fs.readFileSync(path.join(from, 'results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).map((r) => {
    if (realQ.has(r.q)) {
      const { query, fp, fn, plan, note, ...nums } = r;
      return { ...nums, query: `(실제 회의 질문 ${r.q})`, fp: fp.length, fn: fn.length };
    }
    const hid = (ids) => ids.map((id) => (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_meeting$/.test(id) ? '(실제 회의)' : id));
    return { ...r, fp: hid(r.fp), fn: hid(r.fn) };
  });
  fs.writeFileSync(path.join(to, 'results.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  // 쓴 회의 목록: 지어낸 회의만 (실제 회의는 개수만)
  for (const f of fs.readdirSync(from).filter((x) => /^corpus-\d+\.json$/.test(x))) {
    const corpus = JSON.parse(fs.readFileSync(path.join(from, f), 'utf8'));
    fs.writeFileSync(path.join(to, f), JSON.stringify({ realMeetings: corpus.filter((m) => m.real).length, synthetic: corpus.filter((m) => !m.real) }, null, 1));
  }
}
fs.writeFileSync(path.join(DST, 'history.csv'), hideReal(fs.readFileSync(path.join(SRC, 'history.csv'), 'utf8')));

// 금지어 검사 (eval-runs/forbidden.txt, 한 줄에 하나 — 회사명·실명 등. 이 목록도 저장소에 올리지 않는다)
const forbidden = fs.existsSync(path.join(SRC, 'forbidden.txt')) ? fs.readFileSync(path.join(SRC, 'forbidden.txt'), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean) : [];
const hits = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const t = fs.readFileSync(p, 'utf8'); for (const w of forbidden) if (t.includes(w)) hits.push(`${path.relative(REPO, p)}: ${w.slice(0, 1)}…`); } } };
walk(DST);
if (hits.length) {
  console.error(`금지어가 남아 있습니다 (${hits.length}곳). 올리지 마세요:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`실행 ${runs.length}개를 docs/eval/에 걸러서 옮겼습니다 (금지어 ${forbidden.length}개 검사 통과)`);
