// 빌드 전 검사: 화면 스타일(src/renderer/style.css)의 @scope 나눔 (docs/renderer-architecture.md, 결정 75).
//   node scripts/dev/check-css-scope.js            → 어기는 곳이 있으면 끝 코드 1
// 규칙
//  1. 어느 @scope 안에서 만든 클래스는 밖(전역) 규칙의 선택자에 나오지 않는다 — 한 화면의 이름이 다른 화면 규칙과 겹쳐 모양을 바꾸던 일
//     (.ghost ↔ .btn.ghost, 홈 .todo ↔ 회의록 li.todo)을 막는다. 밖의 @media 안 규칙도 밖이다: @scope 안 규칙은 특이성이 같으면
//     밖 규칙을 순서와 상관없이 이겨서(가까움), 밖에 남은 덮는 규칙이 조용히 안 먹게 된다.
//  2. 같은 클래스를 서로 다른 뿌리의 @scope 두 곳에서 만들지 않는다.
//  3. @scope 안 선택자에 뿌리 자신을 쓰지 않는다 — @scope (.a) { .a .b {} }는 아무 데도 맞지 않는다 (뿌리 아래만 본다).
//  일부러 같이 쓰는 이름은 style.css의 'check-css-scope 공유 클래스' 주석에 적는다 (줄마다 '이름들 — 이유').
// '만든 클래스' = @scope 안 선택자의 맨 끝 덩어리(주어)의 첫 클래스. 전역 쪽은 선택자의 모든 덩어리의 첫 클래스.
// 한계: 정규식으로 읽는다 (주석·문자열·괄호 깊이만 따짐). 덩어리의 둘째 이후 클래스(.ritem.on의 on 같은 상태 클래스)는 보지 않고,
// 마크업은 모른다 — 다른 이름의 전역 규칙이 화면 안 요소에 맞는 것, 특이성·순서의 결과는 화면 시험(test:screens)이 본다.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '../../src/renderer/style.css');
const MARK = 'check-css-scope 공유 클래스';

/** 주석을 지운 CSS에서 규칙을 읽는다: [{ selectors, scope (뿌리 선택자 또는 null), line }] */
function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const rules = [];
  const stack = []; // 열린 묶음: { scope } 또는 { other }
  let start = 0;
  let quote = null;
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') {
      const head = text.slice(start, i).trim();
      const at = head.match(/^@([\w-]+)/);
      if (at && /^(keyframes|font-face|-webkit-keyframes|property|counter-style|page)$/.test(at[1])) {
        let depth = 1; // 안을 통째로 건너뛴다
        while (depth && ++i < text.length) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; }
        start = i + 1;
        continue;
      }
      if (at) {
        const root = at[1] === 'scope' ? (head.match(/^@scope\s*\(([^)]*)\)/) || [])[1]?.trim() : null;
        if (at[1] === 'scope' && !root) throw new Error(`줄 ${lineAt(start)}: @scope (뿌리) 형식이 아님 — ${head}`);
        if (at[1] === 'scope' && /\bto\s*\(/.test(head)) throw new Error(`줄 ${lineAt(start)}: @scope … to (…)는 이 검사가 모름`);
        stack.push(root ? { scope: root } : {});
      } else {
        const scope = [...stack].reverse().find((s) => s.scope)?.scope ?? null;
        if (stack.filter((s) => s.scope).length > 1) throw new Error(`줄 ${lineAt(start)}: @scope 안의 @scope`);
        rules.push({ selectors: splitList(head), scope, line: lineAt(start + (text.slice(start, i).length - text.slice(start, i).trimStart().length)) });
        let depth = 1; // 선언 블록 (중첩 규칙은 쓰지 않는다)
        while (depth && ++i < text.length) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; }
      }
      start = i + 1;
    } else if (c === '}') {
      stack.pop();
      start = i + 1;
    } else if (c === ';' && !stack.length) start = i + 1; // @import 같은 맨 위 문장
  }
  return rules;
}

/** 괄호 밖의 쉼표로 나눈다 */
function splitList(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 선택자를 덩어리(조합자 사이)로: 괄호 안((:not(.a .b) 등)과 [속성]은 지운다 */
const compounds = (sel) => sel.replace(/\[[^\]]*\]/g, '').replace(/\((?:[^()]|\([^()]*\))*\)/g, '').split(/\s*[\s>+~]\s*/).filter(Boolean);
/** 덩어리의 첫 클래스 (.a.b → a, li.todo → todo) */
const firstClass = (compound) => (compound.match(/\.([\w-]+)/) || [])[1] ?? null;
/** 덩어리의 단순 선택자들 (.a.b#c → ['.a', '.b', '#c']) */
const simples = (compound) => compound.match(/[.#][\w-]+/g) ?? [];

/** 'check-css-scope 공유 클래스' 주석의 이름들 */
function sharedOf(css) {
  const shared = new Set();
  for (const m of css.matchAll(/\/\*([\s\S]*?)\*\//g)) {
    const body = m[1];
    const at = body.indexOf(MARK);
    if (at < 0) continue;
    for (const line of body.slice(at).split('\n').slice(1)) {
      const names = line.split(' — ')[0];
      for (const n of names.trim().split(/\s+/)) if (/^[a-z][\w-]*$/.test(n)) shared.add(n);
    }
  }
  return shared;
}

/** 어기는 곳 목록 */
function check(css) {
  const rules = rulesOf(css);
  const shared = sharedOf(css);
  const made = new Map(); // 클래스 → Map(뿌리 → 줄)
  const global = new Map(); // 클래스 → 줄
  const problems = [];
  for (const r of rules) {
    for (const sel of r.selectors) {
      const cs = compounds(sel);
      if (r.scope) {
        const root = simples(r.scope);
        if (root.length && cs.some((c) => root.every((x) => simples(c).includes(x)))) problems.push(`줄 ${r.line}: @scope (${r.scope}) 안에서 뿌리 자신을 씀 — '${sel}'는 맞는 곳이 없다 (뿌리 아래만 본다)`);
        const cls = firstClass(cs[cs.length - 1] ?? '');
        if (!cls) continue;
        if (!made.has(cls)) made.set(cls, new Map());
        if (!made.get(cls).has(r.scope)) made.get(cls).set(r.scope, r.line);
      } else {
        for (const c of cs) {
          const cls = firstClass(c);
          if (cls && !global.has(cls)) global.set(cls, r.line);
        }
      }
    }
  }
  for (const [cls, roots] of made) {
    if (shared.has(cls)) continue;
    const where = [...roots].map(([root, line]) => `@scope (${root}) 줄 ${line}`).join(', ');
    if (global.has(cls)) problems.push(`.${cls}: ${where}에서 만든 클래스가 밖(전역) 줄 ${global.get(cls)}에도 나온다 — 그 화면 @scope로 옮기거나, 정말 같이 쓰면 '${MARK}' 주석에`);
    if (roots.size > 1) problems.push(`.${cls}: 서로 다른 @scope에서 만든다 (${where}) — 이름을 나누거나, 정말 같이 쓰면 '${MARK}' 주석에`);
  }
  return problems;
}

module.exports = { check, rulesOf, sharedOf };

if (require.main === module) {
  const css = fs.readFileSync(FILE, 'utf8');
  const problems = check(css);
  if (problems.length) {
    console.error('화면 스타일 @scope 나눔을 어겼습니다 (src/renderer/style.css):');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  const rules = rulesOf(css);
  console.log(`화면 스타일 @scope 검사 통과 (규칙 ${rules.length}개 중 @scope 안 ${rules.filter((r) => r.scope).length}개)`);
}
