// 받아쓰기 다듬기를 앱 없이 돌려 본다 — 앱(src/cleanup.js)과 같은 지시문·모델·옵션으로 Claude Code를 부른다. 앱·데이터는 건드리지 않는다.
//   npm run try:cleanup -- "음 라이브러리는 리액트 쿼리랑 저스탠드 쓰고 프레임워크는 넥스트로 할게요"
//   echo "…" | npm run try:cleanup
// 앱은 600자가 넘으면 문장 단위 조각으로 나눠 다듬는다 — 여기서는 나누지 않고 한 번에 보낸다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/cleanup.js'), 'utf8');
const grab = (name) => src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`))[1];
const minChars = Number(src.match(/const ORGANIZE_MIN_CHARS = (\d+);/)[1]);
const text = process.argv.slice(2).join(' ').trim() || fs.readFileSync(0, 'utf8').trim();
if (!text) throw new Error('다듬을 글을 넣어 주세요');
const system = grab('SYSTEM').replace('{{ORGANIZE}}', text.length >= minChars ? grab('ORGANIZE') : grab('LIST_ONLY')); // 앱과 같은 기준: 짧으면 정리 규칙을 넣지 않는다
const bin = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude')].find((p) => fs.existsSync(p));
if (!bin) throw new Error('Claude Code(claude)를 찾지 못했습니다');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-try-cleanup-')); // 설정 파일·CLAUDE.md를 읽지 않게 빈 폴더에서
const out = execFileSync(bin, ['-p', '--model', 'opus', '--effort', 'low', '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--output-format', 'text'], {
  cwd, input: `<transcript>\n${text}\n</transcript>`, encoding: 'utf8', timeout: 60000,
});
fs.rmSync(cwd, { recursive: true, force: true });
console.log(out.trim());
