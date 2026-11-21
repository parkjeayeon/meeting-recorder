// 빌드 전 검사: 운영체제에 묶인 코드는 플랫폼 층(src/platform)에만 (결정 78).
//   node scripts/dev/check-platform.js            → 어기는 곳이 있으면 끝 코드 1
// 규칙
//  1. src 아래 .js·.mts·.ts·.tsx 중 src/platform/**, 시험(*.test.*, src/test/**), src/core/sandbox.mts(샌드박스 구현 — 시험과
//     src/sandbox.js가 그 경로로 부른다) 밖에서 아래 TOKENS가 나오면 걸린다: process.platform, macOS 도구 이름·자리
//     (afconvert·afinfo·afplay·sandbox-exec·osascript·/opt/homebrew·/usr/local/bin·/usr/bin/·/System/Library·/Applications/·
//     ~/Library/Application Support), 시스템 설정 주소(x-apple.), uv 같은 내려받기의 macOS 이름(apple-darwin), macOS 버전 읽기
//     (getSystemVersion), NSPanel 창 종류(type: 'panel'), macOS 단축키 표기(Command+), Homebrew 환경 변수(HOMEBREW_),
//     ps·defaults 같은 macOS 명령을 바로 띄우는 호출(execFile('ps', …) 등).
//  2. 일부러 남긴 것은 아래 ALLOW에 '파일:토큰 이름': '이유'로 적는다. 하나하나가 아직 하지 않은 플랫폼 일(phase 0b)이다.
//     적어 둔 것이 더는 나오지 않으면 그것도 걸린다 — 옮긴 뒤 목록에서 지우라고.
// 주석은 지우고 본다(줄 번호는 그대로) — 주석에 "afconvert"라고 설명하는 것은 괜찮다. 문자열 안은 진짜로 센다.
// 한계: 정규식으로 읽는다. 토큰을 변수로 조립하면(예: 'af' + 'convert') 못 본다. 화면(src/renderer)도 같은 규칙으로 본다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const MAC_COMMANDS = ['ps', 'defaults', 'osascript', 'open', 'say', 'pmset', 'caffeinate', 'xattr', 'codesign', 'tccutil', 'launchctl', 'sw_vers', 'sysctl', 'pkill', 'killall', 'lsof', 'afconvert', 'afinfo', 'afplay', 'mdfind', 'mdls', 'security', 'plutil'];
const TOKENS = {
  'process.platform': /\bprocess\.platform\b/,
  'getSystemVersion': /\bgetSystemVersion\b/,
  afconvert: /afconvert/,
  afinfo: /afinfo/,
  afplay: /afplay/,
  'sandbox-exec': /sandbox-exec/,
  osascript: /osascript/,
  '/opt/homebrew': /\/opt\/homebrew/,
  '/usr/local/bin': /\/usr\/local\/bin/,
  '/usr/bin/': /\/usr\/bin\//,
  '/System/Library': /\/System\/Library/,
  '/Applications/': /\/Applications\//,
  'Library/Application Support': /Library\/Application Support/,
  'x-apple.': /x-apple\./,
  'apple-darwin': /apple-darwin/,
  "type: 'panel'": /\btype:\s*['"`]panel['"`]/,
  'Command+': /['"`]Command\+/,
  HOMEBREW_: /\bHOMEBREW_/,
  'mac command': new RegExp(`\\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\\(\\s*['"\`](?:${MAC_COMMANDS.join('|')})['"\`]`),
};

// 일부러 남긴 것: '파일:토큰 이름': '이유'. 짧게 — 하나하나가 phase 0b에 할 일이다
const ALLOW = {
  'src/setup/diarize.mts:/usr/bin/': "엔진 설치의 uv 압축 풀기('/usr/bin/tar'). 엔진 설치 전체(Homebrew·uv·venv 자리)를 EngineInstaller 포트로 옮길 때 같이",
  'src/setup/index.mts:HOMEBREW_': '엔진 설치 방법 자체(brew install whisper-cpp와 그 환경 변수). Windows에서는 설치 방법이 달라 포트 모양을 그때 정한다',
  "src/main.js:Command+": "메뉴바 '종료'의 단축키 표기. 메뉴바·트레이(setTitle 등) 전체가 macOS 모양이라 Windows 트레이를 만들 때 같이",
  'src/cli/mr.mts:/Applications/': '명령줄 도구 설치 안내 문장 속 앱 자리. 화면·안내 글은 이번에 바꾸지 않는다',
  'src/renderer/features/configuration/settings/setup.ts:Library/Application Support': "설정 › 앱 폴더 사용량에 보이는 '~/Library/Application Support/meeting-recorder' 글. 화면 글은 이번에 바꾸지 않는다 — 본체가 앱 데이터 폴더를 넘겨 주게 할 때 같이",
};

const EXCLUDE = [/^src\/platform\//, /\.test\.[^/]+$/, /^src\/test\//, /^src\/core\/sandbox\.mts$/];

function sourceFiles(root = ROOT) {
  return fs
    .readdirSync(path.join(root, 'src'), { recursive: true })
    .map((f) => `src/${String(f).split(path.sep).join('/')}`)
    .filter((f) => /\.(js|mts|ts|tsx)$/.test(f) && !EXCLUDE.some((re) => re.test(f)));
}

// 주석만 빈칸으로 바꾼다(줄바꿈은 남겨 줄 번호를 지킨다). 문자열('…', "…", `…`)과 정규식 리터럴 안의 // 는 주석으로 보지 않는다
function stripComments(text) {
  let out = '';
  let i = 0;
  let quote = null; // ' " `
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  let prev = ''; // 마지막으로 낸 공백 아닌 글자 (정규식 리터럴인지 나눗셈인지 가리기)
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev))) {
      // 정규식 리터럴: 끝 / 까지 그대로 (문자 집합 [...] 안의 / 는 끝이 아니다)
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') j++;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      prev = '/';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    if (!/\s/.test(c)) prev = c;
    out += c;
    i++;
  }
  return out;
}

// files: [{ file, text }] → { problems, used }
function check(files, allow = ALLOW) {
  const problems = [];
  const used = new Set();
  for (const { file, text } of files) {
    const lines = stripComments(text).split('\n');
    for (const [name, re] of Object.entries(TOKENS)) {
      const hits = [];
      lines.forEach((line, i) => {
        if (re.test(line)) hits.push(i + 1);
      });
      if (!hits.length) continue;
      const key = `${file}:${name}`;
      if (key in allow) {
        used.add(key);
        continue;
      }
      problems.push(`${file} 줄 ${hits.join(', ')}: '${name}' — 운영체제에 묶인 코드는 src/platform에 (결정 78). 일부러 남기면 check-platform.js의 ALLOW에 이유를`);
    }
  }
  for (const key of Object.keys(allow)) {
    if (!used.has(key)) problems.push(`ALLOW의 '${key}'가 더는 나오지 않는다 — 목록에서 지우라`);
  }
  return problems;
}

module.exports = { check, stripComments, sourceFiles, TOKENS, ALLOW };

if (require.main === module) {
  const files = sourceFiles().map((file) => ({ file, text: fs.readFileSync(path.join(ROOT, file), 'utf8') }));
  const problems = check(files);
  if (problems.length) {
    console.error('운영체제에 묶인 코드가 플랫폼 층 밖에 있습니다:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`플랫폼 경계 검사 통과 (파일 ${files.length}개, 일부러 남긴 것 ${Object.keys(ALLOW).length}개)`);
}
