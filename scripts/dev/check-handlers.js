// 빌드 전 검사: 키보드 처리기를 값을 돌려주는 화살표 함수로 쓰지 않았는지.
// `onkeydown = (e) => e.key === 'Enter' && go()`는 Enter가 아닐 때 false를 돌려주고, on* 처리기의 false는
// 기본 동작을 막아 영어·Backspace 입력이 안 된다 (한글 IME만 됨). 두 번 겪었다 (CHANGELOG 2026-11-02, 2026-11-04).
const fs = require('fs');
const path = require('path');

const dirs = ['src/renderer', 'src/overlay'];
const bad = /\bon(keydown|keypress|keyup)\s*(=|:)\s*(\([^)]*\)|[a-z]+)\s*=>(?!\s*\{)/;
const found = [];
for (const d of dirs) {
  for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.js'))) {
    fs.readFileSync(path.join(d, f), 'utf8').split('\n').forEach((line, i) => bad.test(line) && found.push(`${d}/${f}:${i + 1}  ${line.trim()}`));
  }
}
if (found.length) {
  console.error('키보드 처리기를 블록 { } 으로 써 주세요 (값을 돌려주면 영어·Backspace 입력이 막힙니다):');
  for (const l of found) console.error(`  ${l}`);
  process.exit(1);
}
console.log('키보드 처리기 검사 통과');
