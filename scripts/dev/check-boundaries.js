// 빌드 전 검사: 화면(src/renderer)의 가져오기 경계 (docs/renderer-architecture.md).
//   node scripts/dev/check-boundaries.js            → 어기는 곳이 있으면 끝 코드 1
// 규칙
//  1. FSD 층 순서: app > pages > widgets > features > entities > shared. 아래 층만 가져온다. 같은 층의 다른 조각은 못 가져온다.
//  2. 다른 조각은 공개 입구(그 조각 폴더의 index.ts/tsx)로만 — 안쪽 파일을 바로 가져오면 그게 공개 약속이 돼 버린다.
//  3. 화면 코드는 node:·electron·src/main 쪽을 못 가져온다 (코어는 src/core의 순수 모듈만, 상대 경로로).
// 정규식으로 가져오기 경로(import·export from·import())를 읽는다. 문자열이 아닌 동적 import는 금지.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const R = path.join(ROOT, 'src/renderer');
const LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];
const files = fs.readdirSync(R, { recursive: true }).map(String).filter((f) => /\.(ts|tsx)$/.test(f));
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*([^)]*)\)|import\s*['"]([^'"]+)['"]/g;

// src/renderer 안의 위치 → { layer, slice } (shared는 조각마다: shared/api, shared/page-host …)
const where = (rel) => {
  const [top, slice] = rel.split('/');
  if (!LAYERS.includes(top)) return { layer: null, slice: null };
  return { layer: top, slice: top === 'app' ? 'app' : slice ?? null };
};
const problems = [];
for (const f of files) {
  const from = where(f);
  const text = fs.readFileSync(path.join(R, f), 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    const raw = m[1] ?? m[3] ?? m[2];
    const spec = m[2] !== undefined ? m[2].trim().replace(/^['"`]|['"`]$/g, '') : raw;
    if (m[2] !== undefined && !/^['"][^'"]+['"]$/.test(m[2].trim())) {
      problems.push(`${f}: 문자열이 아닌 동적 import (${m[2].trim()})`);
      continue;
    }
    if (/^(node:|electron$|fs$|path$|child_process$)/.test(spec)) {
      problems.push(`${f}: 화면 코드가 Node·Electron 모듈을 가져옴 (${spec})`);
      continue;
    }
    if (!spec.startsWith('.')) continue; // react 등 패키지
    const abs = path.resolve(path.dirname(path.join(R, f)), spec);
    const rel = path.relative(R, abs).split(path.sep).join('/');
    if (rel.startsWith('../')) {
      // 화면 밖: src/core의 순수 모듈(.mts)과 preload 타입만
      const out = path.relative(path.join(ROOT, 'src'), abs).split(path.sep).join('/');
      const typeOnlyPreload = out === 'preload.js' && /import\(['"][^'"]*preload\.js['"]\)|import\s+type/.test(m[0]);
      if (!(out.startsWith('core/') && !out.includes('.test.')) && !typeOnlyPreload) problems.push(`${f}: 화면 밖을 가져옴 (${spec}) — src/core의 순수 모듈만`);
      continue;
    }
    const to = where(rel);
    if (!to.layer) continue; // main.ts·style.css 등 뿌리 파일
    if (from.layer && to.slice === from.slice && to.layer === from.layer) continue; // 같은 조각 안
    if (from.layer && LAYERS.indexOf(to.layer) <= LAYERS.indexOf(from.layer)) {
      problems.push(`${f}: ${from.layer}에서 ${to.layer === from.layer ? '같은 층의 다른 조각' : `위층(${to.layer})`}을 가져옴 (${spec})`);
      continue;
    }
    const inner = rel.split('/').slice(to.layer === 'app' ? 1 : 2).join('/');
    if (inner && !/^index(\.tsx?)?$/.test(inner)) problems.push(`${f}: ${to.layer}/${to.slice}의 안쪽 파일을 바로 가져옴 (${spec}) — 공개 입구(index)로`);
  }
}
if (problems.length) {
  console.error('화면 가져오기 경계를 어겼습니다:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`화면 경계 검사 통과 (${files.length}개 파일)`);
