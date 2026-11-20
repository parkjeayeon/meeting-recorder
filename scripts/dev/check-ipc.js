// 빌드 전 검사: 화면(preload)과 본체(메인 프로세스) 사이 IPC 채널 이름이 서로 맞는지.
//   node scripts/dev/check-ipc.js            → 어기는 곳이 있으면 끝 코드 1
// E2E 시험은 가짜 preload로 화면만 돌리고 본체(src/main.js)를 불러오지 않는다. 그래서 채널 이름이 한쪽만 바뀌면
// 시험은 다 통과하고 실제 앱에서만 버튼이 아무 일도 안 한다. 이 검사가 소스를 읽어 그 틈을 막는다.
// 규칙
//  1. preload가 부르는 채널(ipcRenderer.invoke / send)마다 본체에 받는 곳이 꼭 하나 있다 — invoke는 ipcMain.handle, send는 ipcMain.on·once.
//     없거나, 둘 이상이거나, 짝이 틀리면(invoke인데 on으로 받음) 걸린다.
//  2. 본체가 받는 채널을 어느 preload도 부르지 않으면(죽은 처리기) 걸린다. 일부러 남긴 것은 아래 UNUSED_OK에 이유와 함께 적는다.
//  3. 본체가 창으로 보내는 알림(webContents.send, 그것을 감싼 send·sendOverlay·ctx.send)을 그 창의 preload가 ipcRenderer.on으로 받지 않거나,
//     preload가 받는 알림을 본체가 그 창으로 보내지 않으면 걸린다. UNHEARD_OK에 적은 것만 예외.
//  4. 채널 이름은 문자열 그대로만 쓴다 — 변수·템플릿 문자열이면 따질 수 없으니 어디인지 알리고 실패한다.
// 본체 소스: src 아래 .js·.mts 중 화면(src/renderer, src/overlay)·preload·시험(*.test.*, src/test) 밖 전부 — IPC 처리기를 어느 파일로 옮겨도 찾는다.
// 받는 쪽 이름은 ipcMain 또는 ipc(src/app의 register(ipc, ctx)가 받는 이름)만 본다.
// 한계: 정규식으로 읽는다. 줄 전체가 주석인 줄(//, /* *)만 건너뛰고, 줄 끝 주석 안의 호출은 진짜로 센다.
// 창이 둘(메인 창·플로팅 독)이라고 알고 있다 — preload.js가 새로 생기면 WINDOWS에 더하라고 실패한다.
// 받는 쪽이 실제로 무엇을 돌려주는지, 인자 모양이 맞는지는 보지 않는다 (그건 단위 시험과 손으로 확인).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

// 창마다: preload 파일, 그 창의 BrowserWindow를 담은 변수 이름, 그 창으로 보내는 도우미 함수 이름
const WINDOWS = [
  { name: '메인 창', preload: 'src/preload.js', objects: ['win'], helpers: ['send'] },
  { name: '플로팅 독', preload: 'src/overlay/preload.js', objects: ['overlay'], helpers: ['sendOverlay'] },
];
const RENDERER_DIRS = ['src/renderer', 'src/overlay'];

// 본체가 받지만 preload가 부르지 않아도 되는 채널: '채널': '이유'
const UNUSED_OK = {};
// 창으로 보내지만 preload가 받지 않아도 되는(또는 받지만 보내지 않아도 되는) 알림: '창 이름 채널': '이유'
const UNHEARD_OK = {};

const KIND = { handle: 'invoke', handleOnce: 'invoke', on: 'send', once: 'send' };
// '창 이름 채널' 열쇠 → [창 이름, 채널] (창 이름에는 빈칸이 있고 채널 이름에는 없다)
const splitKey = (k) => [k.slice(0, k.lastIndexOf(' ')), k.slice(k.lastIndexOf(' ') + 1)];
const QUOTED = /^(['"])([^'"\n]+)\1\s*[,)]/;

// 줄 번호를 지키면서 줄 전체가 주석인 줄만 비운다
function codeLines(text) {
  let inBlock = false;
  return text.split('\n').map((line) => {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      return '';
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      return '';
    }
    if (t.startsWith('//') || t.startsWith('*')) return '';
    return line;
  });
}

// 줄마다 정규식에 맞는 곳을 찾고, 여는 괄호 뒤가 문자열 채널인지 본다
function* calls(file, text, re) {
  const lines = codeLines(text);
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(re)) {
      const rest = lines[i].slice(m.index + m[0].length).trimStart();
      const q = QUOTED.exec(rest);
      yield { m, channel: q ? q[2] : null, raw: rest.slice(0, 40), at: `${file}:${i + 1}`, line: lines[i] };
    }
  }
}

/**
 * @param {{ main: {file: string, text: string}[], preloads: {window: string, file: string, text: string}[] }} src
 * @returns {{ problems: string[], registered: {method: string, channel: string, at: string}[], requests: Map<string, object[]>, events: Map<string, object> }}
 */
function check(src, { unusedOk = UNUSED_OK, unheardOk = UNHEARD_OK, windows = WINDOWS } = {}) {
  const problems = [];
  // 1) preload: 부르는 채널·받는 알림
  const requests = new Map(); // 채널 → [{ kind, at }]
  const listens = new Map(); // '창 채널' → [{ at }]
  for (const p of src.preloads) {
    for (const c of calls(p.file, p.text, /\bipcRenderer\.(invoke|send|sendSync|on|once)\(/g)) {
      if (!c.channel) {
        problems.push(`${c.at}: ipcRenderer.${c.m[1]}의 채널이 문자열이 아님 (${c.raw}) — 검사할 수 없음`);
        continue;
      }
      if (c.m[1] === 'on' || c.m[1] === 'once') {
        const k = `${p.window} ${c.channel}`;
        listens.set(k, [...(listens.get(k) ?? []), { at: c.at }]);
      } else {
        const kind = c.m[1] === 'invoke' ? 'invoke' : 'send';
        requests.set(c.channel, [...(requests.get(c.channel) ?? []), { kind, at: c.at, window: p.window }]);
      }
    }
  }
  // 2) 본체: 받는 곳·보내는 곳
  const registered = [];
  const sent = new Map(); // '창 채널' → [{ at }]
  const byObject = new Map(windows.flatMap((w) => w.objects.map((o) => [o, w.name])));
  const byHelper = new Map(windows.flatMap((w) => w.helpers.map((h) => [h, w.name])));
  const addSent = (win, channel, at) => {
    const k = `${win} ${channel}`;
    sent.set(k, [...(sent.get(k) ?? []), { at }]);
  };
  for (const f of src.main) {
    for (const c of calls(f.file, f.text, /\b(ipcMain|ipc)\.(handle|handleOnce|on|once)\(/g)) {
      if (!c.channel) {
        problems.push(`${c.at}: ${c.m[1]}.${c.m[2]}의 채널이 문자열이 아님 (${c.raw}) — 검사할 수 없음, 채널 이름을 문자열 그대로 써 주세요`);
        continue;
      }
      registered.push({ method: c.m[2], channel: c.channel, at: c.at });
    }
    // 창으로 직접 보내기: <창 변수>.webContents.send('x', …)
    for (const c of calls(f.file, f.text, /\b([\w$]+)\.webContents\.send\(/g)) {
      const win = byObject.get(c.m[1]);
      // 도우미 함수 정의 안의 webContents.send(channel, …)는 그 도우미를 부르는 곳에서 센다
      const inHelper = !c.channel && /^channel\b/.test(c.raw) && [...byHelper].some(([h, w]) => w === win && new RegExp(`function\\s+${h}\\s*\\(\\s*channel\\b`).test(f.text));
      if (inHelper) continue;
      if (!win) problems.push(`${c.at}: ${c.m[1]}.webContents.send — 어느 창인지 모름 (check-ipc.js의 WINDOWS에 변수 이름을 더해 주세요)`);
      else if (!c.channel) problems.push(`${c.at}: ${c.m[1]}.webContents.send의 채널이 문자열이 아님 (${c.raw}) — 검사할 수 없음`);
      else addSent(win, c.channel, c.at);
    }
    // 도우미로 보내기: 그 파일에 도우미 정의(function send(channel …)가 있으면 맨 이름 send(…)를, 어디서나 ctx.send(…)를 센다
    const local = [...byHelper.keys()].filter((h) => new RegExp(`function\\s+${h}\\s*\\(\\s*channel\\b`).test(f.text));
    const helperRe = new RegExp(`(?<![\\w$.])(ctx\\.)?(${[...byHelper.keys()].join('|')})\\(`, 'g');
    for (const c of calls(f.file, f.text, helperRe)) {
      if (!c.m[1] && !local.includes(c.m[2])) continue; // 그 파일의 다른 send (예: src/llm/usage.mts의 JSON-RPC send)
      if (/\bfunction\s+$/.test(c.line.slice(0, c.m.index))) continue; // 정의 줄
      if (!c.channel) {
        problems.push(`${c.at}: ${c.m[0]}의 채널이 문자열이 아님 (${c.raw}) — 검사할 수 없음`);
        continue;
      }
      addSent(byHelper.get(c.m[2]), c.channel, c.at);
    }
  }
  // 3) 맞춰 보기
  const regBy = new Map();
  for (const r of registered) regBy.set(r.channel, [...(regBy.get(r.channel) ?? []), r]);
  for (const [channel, regs] of regBy) {
    if (regs.length > 1) problems.push(`'${channel}'을(를) 본체가 ${regs.length}번 받음: ${regs.map((r) => `${r.at} (${r.method})`).join(', ')} — 하나만 남겨 주세요`);
  }
  for (const [channel, reqs] of requests) {
    const regs = regBy.get(channel) ?? [];
    if (!regs.length) {
      problems.push(`'${channel}'을(를) preload가 부르지만 본체에 받는 곳이 없음: ${reqs.map((r) => `${r.at} (${r.kind})`).join(', ')}`);
      continue;
    }
    for (const r of reqs) {
      for (const g of regs) {
        if (KIND[g.method] !== r.kind) problems.push(`'${channel}': preload는 ${r.kind}(${r.at})인데 본체는 ipcMain.${g.method}(${g.at}) — invoke는 handle, send는 on으로 받아야 합니다`);
      }
    }
  }
  for (const [channel, regs] of regBy) {
    if (requests.has(channel) || channel in unusedOk) continue;
    problems.push(`'${channel}'을(를) 본체가 받지만(${regs.map((r) => r.at).join(', ')}) 어느 preload도 부르지 않음 — 지우거나, 일부러 남기면 check-ipc.js의 UNUSED_OK에 이유를`);
  }
  for (const [k, list] of sent) {
    if (listens.has(k) || k in unheardOk) continue;
    const [win, channel] = splitKey(k);
    problems.push(`'${channel}'을(를) 본체가 ${win}으로 보내지만(${list.map((s) => s.at).join(', ')}) 그 창의 preload가 받지 않음`);
  }
  for (const [k, list] of listens) {
    if (sent.has(k) || k in unheardOk) continue;
    const [win, channel] = splitKey(k);
    problems.push(`'${channel}'을(를) ${win}의 preload가 받지만(${list.map((s) => s.at).join(', ')}) 본체가 그 창으로 보내는 곳이 없음`);
  }
  return { problems, registered, requests, events: sent };
}

// 저장소의 실제 소스를 모은다
function sources(root = ROOT) {
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const problems = [];
  const all = fs.readdirSync(path.join(root, 'src'), { recursive: true }).map(String).map((f) => `src/${f.split(path.sep).join('/')}`);
  const preloads = all.filter((f) => path.basename(f) === 'preload.js');
  for (const p of preloads) {
    if (!WINDOWS.some((w) => w.preload === p)) problems.push(`${p}: 모르는 preload — check-ipc.js의 WINDOWS에 어느 창의 것인지 더해 주세요`);
  }
  for (const w of WINDOWS) if (!preloads.includes(w.preload)) problems.push(`${w.preload}: preload 파일이 없음 — check-ipc.js의 WINDOWS를 맞춰 주세요`);
  const isMain = (f) =>
    /\.(js|mts)$/.test(f) &&
    !RENDERER_DIRS.some((d) => f.startsWith(`${d}/`)) &&
    path.basename(f) !== 'preload.js' &&
    !/\.test\.[cm]?[jt]s$/.test(f) &&
    !f.startsWith('src/test/');
  const read = (f) => ({ file: rel(path.join(root, f)), text: fs.readFileSync(path.join(root, f), 'utf8') });
  return {
    problems,
    main: all.filter(isMain).map(read),
    preloads: WINDOWS.filter((w) => preloads.includes(w.preload)).map((w) => ({ window: w.name, ...read(w.preload) })),
  };
}

// 받는 곳을 '방식 채널' 한 줄씩, 채널 이름 순으로 (ipc-channels.txt와 같은 모양, 글자 코드 순)
const LIST_FILE = path.join(__dirname, 'ipc-channels.txt');
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const channelList = (registered) =>
  registered
    .map((r) => [r.channel, r.method])
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]))
    .map(([c, m]) => `${m} ${c}`);
// ipc-channels.txt의 줄 ('#' 주석·빈 줄 빼고)
const readList = (file = LIST_FILE) => fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

module.exports = { check, sources, codeLines, channelList, readList, LIST_FILE, WINDOWS, UNUSED_OK, UNHEARD_OK };

if (require.main === module) {
  const src = sources();
  const { problems, registered, requests, events } = check(src);
  problems.unshift(...src.problems);
  if (problems.length) {
    console.error('화면(preload)과 본체의 IPC 채널이 맞지 않습니다:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  if (process.argv.includes('--write-list')) {
    // 채널을 일부러 더하거나 지웠을 때 목록을 새로 쓴다 (머리 주석은 그대로)
    const head = fs.existsSync(LIST_FILE) ? fs.readFileSync(LIST_FILE, 'utf8').split('\n').filter((l) => l.startsWith('#')) : [];
    fs.writeFileSync(LIST_FILE, [...head, ...channelList(registered)].map((l) => `${l}\n`).join(''));
    console.log(`${path.relative(ROOT, LIST_FILE)}에 받는 곳 ${registered.length}개를 썼습니다`);
    process.exit(0);
  }
  const invokes = [...requests.values()].filter((r) => r[0].kind === 'invoke').length;
  console.log(
    `IPC 검사 통과 (요청 채널 ${requests.size}개: invoke↔handle ${invokes}개, send↔on ${requests.size - invokes}개 · 창으로 보내는 알림 ${events.size}개 · 본체 소스 ${src.main.length}개 파일)`,
  );
}
