// 형식 검증(성질 기반, 실제 코드): 확인 필요 항목을 어떤 순서로 적용하고 되돌려도, 전부 되돌리면 녹취·정리본·회의록이 처음과 똑같다.
//   npm run build:ts && npx electron scripts/dev/formal/review-undo.js [--runs 400] [--seed 42] [--lifo] [--independent] [--distinct-heard] [--no-chains]
//   기준선(지금 지켜지는 범위, 회귀 검사): --lifo --independent   ·   전체 성질(지금은 알려진 발견 셋으로 실패): 옵션 없이
//   검증 스킬: .claude/skills/verify-review-undo/SKILL.md
// 대상 코드: src/minutes.js의 applyReview·revertReview (+ changedLines, writeReview). 손으로 만든 모델이 아니라 그 함수를 그대로 부른다.
// 범위: 어휘 9개(서로 겹치는 말 '랩캐시도'⊃'캐시'·'랩', 원래 녹취에 있는 말 'QA'·'배포' 포함)로 만든 줄 2~5개, 항목 1~3개, 적용·되돌리기 1~8번을
// 임의 순서로 한 뒤 남은 적용을 임의 순서로 모두 되돌린다. 실행마다 임시 회의 폴더(실제 회의는 건드리지 않음).
// minutes.js는 Electron 앱 객체를 쓰므로 Electron으로 돌린다 (창 없음, 앱 데이터는 임시 폴더).
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-formal-undo-'));
app.setPath('userData', path.join(tmpRoot, 'userData'));
app.dock?.hide();
const minutes = require('../../../src/minutes');

const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const RUNS = arg('--runs', 400);
const SEED = arg('--seed', Date.now() % 100000);
// --no-chains: 한 항목의 고칠 말이 다른 항목의 들린 말에 들어가는(이어지는) 경우를 빼고 본다 — 알려진 발견(아래)과 나머지를 나눠 보려고
const NO_CHAINS = process.argv.includes('--no-chains');
// --lifo: 되돌리기를 적용한 반대 순서로만(나중에 적용한 것부터) 한다 — 그 순서면 성질이 지켜지는지 보려고
const LIFO = process.argv.includes('--lifo');
// --distinct-heard: 들린 말이 같은 항목을 둘 이상 두지 않는다 (확인 필요 목록을 만들 때는 겹칠 수 있다)
const DISTINCT = process.argv.includes('--distinct-heard');
// --independent: 들린 말끼리 겹치지 않고(같거나 한쪽이 다른 쪽에 들어가지 않음) 고칠 말이 다른 항목의 들린 말을 만들지 않는 항목만
const INDEPENDENT = process.argv.includes('--independent');
const FILES = ['transcript.txt', 'script-clean.txt', 'minutes.md'];
const WORDS = ['랩캐시도', '캐시', '랩', '배포', 'QA', '큐에이', '화요일', '수요일', 'Memcached'];

const line = fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 4 });
const meetingArb = fc.record({
  lines: fc.array(line, { minLength: 2, maxLength: 5 }),
  // 항목: 들린 말(녹취에서 고른다)과 고칠 말(다른 말). 같은 들린 말을 가진 항목이 둘일 수도 있다
  items: fc.array(fc.record({ heardIdx: fc.nat(), guess: fc.constantFrom(...WORDS) }), { minLength: 1, maxLength: 3 }),
  ops: fc.array(fc.record({ kind: fc.constantFrom('apply', 'revert'), item: fc.nat() }), { minLength: 1, maxLength: 8 }),
  finalOrder: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
});

function build(m) {
  const stamp = (i) => `[00:${String(10 + i * 7).padStart(2, '0')}]`;
  const tl = m.lines.map((ws, i) => `${stamp(i)} [화자 ${(i % 2) + 1}] ${ws.join(' ')}`);
  const words = [...new Set(m.lines.flat())];
  const items = m.items.map((it, k) => {
    const heard = words[it.heardIdx % words.length];
    return { id: `r${k + 1}`, kind: 'word', at: null, heard, heardNote: heard, guess: it.guess === heard ? null : it.guess, note: `'${heard}' 확인`, status: 'open' };
  }).filter((it) => it.guess);
  const files = {
    'transcript.txt': `${tl.join('\n')}\n`,
    'script-clean.txt': `${tl.filter((_, i) => i % 2 === 0 || i === tl.length - 1).join('\n')}\n`,
    'minutes.md': `# 예시\n\n## 요약\n${m.lines[0].join(' ')} 이야기를 함.\n\n## 할 일\n- [ ] ${m.lines.at(-1).join(' ')}\n\n## 확인 필요\n- "${words[0]}" 확인\n`,
  };
  return { files, items };
}

let n = 0;
function runCase(m) {
  const { files, items } = build(m);
  fc.pre(items.length > 0);
  if (INDEPENDENT) fc.pre(!items.some((a) => items.some((b) => a !== b && (a.heard.includes(b.heard) || b.heard.includes(a.guess) || a.guess.includes(b.heard)))));
  if (DISTINCT) fc.pre(new Set(items.map((it) => it.heard)).size === items.length);
  if (NO_CHAINS) fc.pre(!items.some((a) => items.some((b) => a !== b && (b.heard.includes(a.guess) || a.guess.includes(b.heard)))));
  const dir = path.join(tmpRoot, `c${n++}`);
  fs.mkdirSync(dir);
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), t);
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ items }));
  const trace = [];
  const status = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8')).items.find((it) => it.id === id).status;
  const act = (kind, it) => {
    if (kind === 'apply' && status(it.id) === 'open') {
      minutes.applyReview(dir, [{ id: it.id, guess: it.guess }]);
      if (status(it.id) === 'applied') trace.push(`적용 ${it.id}(${it.heard}→${it.guess})`);
    } else if (kind === 'revert' && status(it.id) === 'applied') {
      minutes.revertReview(dir, it.id);
      trace.push(`되돌리기 ${it.id}`);
    }
  };
  const applied = []; // 적용한 순서 (--lifo용)
  for (const op of m.ops) {
    const it = items[op.item % items.length];
    if (LIFO && op.kind === 'revert') {
      const last = applied.pop();
      if (last) act('revert', last);
      continue;
    }
    const was = status(it.id);
    act(op.kind, it);
    if (was === 'open' && status(it.id) === 'applied') applied.push(it);
  }
  // 남은 적용을 모두 되돌린다: 임의 순서로 (--lifo면 나중에 적용한 것부터)
  const order = LIFO ? [...applied].reverse() : items.map((it, k) => ({ it, key: m.finalOrder[k % m.finalOrder.length] * 10 + k })).sort((a, b) => a.key - b.key).map((x) => x.it);
  for (const it of order) act('revert', it);
  const diffs = FILES.filter((f) => fs.readFileSync(path.join(dir, f), 'utf8') !== files[f]);
  fs.rmSync(dir, { recursive: true, force: true });
  if (diffs.length) {
    const err = new Error('전부 되돌렸는데 처음과 다름');
    err.detail = { diffs, trace, items: items.map((it) => `${it.id}: ${it.heard}→${it.guess}`), original: files['transcript.txt'] };
    throw err;
  }
  return true;
}

const MODE = `${NO_CHAINS ? ' (이어지는 항목 뺌)' : ''}${LIFO ? ' (나중에 적용한 것부터 되돌림)' : ''}${DISTINCT ? ' (들린 말이 다른 항목만)' : ''}${INDEPENDENT ? ' (서로 독립인 항목만)' : ''}`;

app.whenReady().then(() => {
  const t0 = Date.now();
  const res = fc.check(fc.property(meetingArb, (m) => runCase(m)), { numRuns: RUNS, seed: SEED, endOnFailure: false });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.failed) {
    console.log(`성질 "전부 되돌리면 처음과 같다"${MODE}: 통과 (${res.numRuns}건, seed ${SEED}, ${secs}초)`);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    app.exit(0);
    return;
  }
  // 가장 짧게 줄인 반례를 코드의 말로
  let detail = null;
  try { runCase(res.counterexample[0]); } catch (err) { detail = err.detail ?? err.message; }
  console.log(`성질 "전부 되돌리면 처음과 같다"${MODE}: 실패 (seed ${SEED}, ${res.numRuns}건째, 줄인 횟수 ${res.numShrinks})`);
  console.log('반례:');
  console.log(JSON.stringify(detail, null, 1));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  app.exit(1);
});
