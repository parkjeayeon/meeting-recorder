// scripts/dev/check-ipc.js — 화면(preload)과 본체의 IPC 채널 맞추기 검사
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { check, sources, channelList, readList, codeLines } = createRequire(import.meta.url)('./check-ipc.js');

// 메인 창 preload 하나, 독 preload 하나, 본체 파일들로 검사한다
const run = (main, preload = '', overlay = '', opts) =>
  check(
    {
      main: Object.entries(main).map(([file, text]) => ({ file, text })),
      preloads: [
        { window: '메인 창', file: 'src/preload.js', text: preload },
        { window: '플로팅 독', file: 'src/overlay/preload.js', text: overlay },
      ],
    },
    opts,
  );

const MAIN = `
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function sendOverlay(channel, payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
}
ipcMain.handle('a:get', () => 1);
ipcMain.on('a:tap', () => send('a:changed', {}));
`;
const PRELOAD = `
  get: () => ipcRenderer.invoke('a:get'),
  tap: () => ipcRenderer.send('a:tap'),
  onChanged: (cb) => ipcRenderer.on('a:changed', (_e, s) => cb(s)),
`;

describe('check-ipc', () => {
  it('짝이 다 맞으면 통과하고 받는 곳·요청·알림을 센다', () => {
    const r = run({ 'src/main.js': MAIN }, PRELOAD);
    expect(r.problems).toEqual([]);
    expect(channelList(r.registered)).toEqual(['handle a:get', 'on a:tap']);
    expect([...r.requests.keys()]).toEqual(['a:get', 'a:tap']);
    expect([...r.events.keys()]).toEqual(['메인 창 a:changed']);
  });

  it('preload가 부르는데 받는 곳이 없으면 걸린다', () => {
    const r = run({ 'src/main.js': MAIN }, `${PRELOAD}  more: () => ipcRenderer.invoke('a:more'),\n`);
    expect(r.problems).toEqual([expect.stringMatching(/^'a:more'을\(를\) preload가 부르지만 본체에 받는 곳이 없음: src\/preload\.js:5 \(invoke\)/)]);
  });

  it('같은 채널을 두 번 받으면 걸린다 (다른 파일로 옮긴 뒤 옛 줄을 남긴 경우도)', () => {
    const r = run({ 'src/main.js': MAIN, 'src/app/a.mts': `ipc.handle('a:get', () => 2);` }, PRELOAD);
    expect(r.problems).toEqual([expect.stringContaining("'a:get'을(를) 본체가 2번 받음: src/main.js:8 (handle), src/app/a.mts:1 (handle)")]);
  });

  it('invoke를 on으로 받으면(또는 send를 handle로) 걸린다', () => {
    const r = run({ 'src/main.js': MAIN.replace("ipcMain.handle('a:get'", "ipcMain.on('a:get'") }, PRELOAD);
    expect(r.problems).toEqual([expect.stringContaining("'a:get': preload는 invoke(src/preload.js:2)인데 본체는 ipcMain.on(src/main.js:8)")]);
  });

  it('아무 preload도 부르지 않는 받는 곳은 걸리고, UNUSED_OK에 적으면 통과', () => {
    const main = `${MAIN}ipcMain.handle('a:old', () => null);\n`;
    expect(run({ 'src/main.js': main }, PRELOAD).problems).toEqual([expect.stringContaining("'a:old'을(를) 본체가 받지만(src/main.js:10) 어느 preload도 부르지 않음")]);
    expect(run({ 'src/main.js': main }, PRELOAD, '', { unusedOk: { 'a:old': '시험용' } }).problems).toEqual([]);
  });

  it('창으로 보내는 알림을 그 창 preload가 받지 않으면 걸린다 — 다른 창이 받는 것은 소용없다', () => {
    const main = `${MAIN}sendOverlay('a:level', { db: 0 });\n`;
    const r = run({ 'src/main.js': main }, `${PRELOAD}  onLevel: (cb) => ipcRenderer.on('a:level', cb),\n`);
    expect(r.problems).toEqual([
      expect.stringContaining("'a:level'을(를) 본체가 플로팅 독으로 보내지만(src/main.js:10) 그 창의 preload가 받지 않음"),
      expect.stringContaining("'a:level'을(를) 메인 창의 preload가 받지만(src/preload.js:5) 본체가 그 창으로 보내는 곳이 없음"),
    ]);
  });

  it('preload가 받는 알림을 본체가 보내지 않으면 걸린다', () => {
    const r = run({ 'src/main.js': MAIN.replace("send('a:changed', {})", 'null') }, PRELOAD);
    expect(r.problems).toEqual([expect.stringContaining("'a:changed'을(를) 메인 창의 preload가 받지만(src/preload.js:4) 본체가 그 창으로 보내는 곳이 없음")]);
  });

  it('src/app 모듈의 ipc.handle·ctx.send도 센다', () => {
    const main = MAIN.replace("ipcMain.on('a:tap', () => send('a:changed', {}));", '');
    const mod = `export function register(ipc, ctx) {\n  ipc.on('a:tap', () => ctx.send('a:changed', {}));\n}\n`;
    expect(run({ 'src/main.js': main, 'src/app/a.mts': mod }, PRELOAD).problems).toEqual([]);
  });

  it('채널이 문자열이 아니면 어디인지 알리고 실패한다', () => {
    const r = run({ 'src/main.js': `${MAIN}const CH = 'a:x';\nipcMain.handle(CH, () => 1);\nipcMain.on(\`a:\${n}\`, () => 1);\n` }, `${PRELOAD}  x: (c) => ipcRenderer.invoke(c),\n`);
    expect(r.problems).toEqual([
      expect.stringContaining('src/preload.js:5: ipcRenderer.invoke의 채널이 문자열이 아님 (c)'),
      expect.stringContaining('src/main.js:11: ipcMain.handle의 채널이 문자열이 아님 (CH, () => 1);)'),
      expect.stringContaining('src/main.js:12: ipcMain.on의 채널이 문자열이 아님'),
    ]);
    expect(run({ 'src/main.js': `${MAIN}send(name, 1);\n` }, PRELOAD).problems).toEqual([expect.stringContaining('src/main.js:10: send(의 채널이 문자열이 아님 (name, 1);)')]);
  });

  it('어느 창인지 모르는 webContents.send는 걸린다', () => {
    const r = run({ 'src/main.js': `${MAIN}other.webContents.send('a:changed');\n` }, PRELOAD);
    expect(r.problems).toEqual([expect.stringContaining('src/main.js:10: other.webContents.send — 어느 창인지 모름')]);
  });

  it('주석 줄과, 창 도우미가 아닌 다른 파일의 send(…)는 세지 않는다', () => {
    const usage = `function start() {\n  const send = (msg) => child.stdin.write(JSON.stringify(msg));\n  send({ id: 1 });\n  send('raw');\n}\n`;
    const main = `${MAIN}// ipcMain.handle('a:gone', () => 1);\n/*\nipcMain.handle('a:gone2', () => 1);\n*/\n`;
    expect(run({ 'src/main.js': main, 'src/llm/usage.mts': usage }, PRELOAD).problems).toEqual([]);
    expect(codeLines('a\n// b\n/* c\n d */\ne')).toEqual(['a', '', '', '', 'e']);
  });
});

describe('저장소의 실제 소스', () => {
  const src = sources();
  const r = check(src);

  it('검사에 걸리는 곳이 없다 (npm run typecheck와 같은 결과)', () => {
    expect([...src.problems, ...r.problems]).toEqual([]);
    expect(src.preloads.map((p) => p.file)).toEqual(['src/preload.js', 'src/overlay/preload.js']);
  });

  it('본체가 받는 채널은 ipc-channels.txt와 정확히 같다 (main.js를 나눠도 사라지거나 늘거나 방식이 바뀌지 않음)', () => {
    expect(channelList(r.registered)).toEqual(readList());
  });
});
