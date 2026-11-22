// 본체 시작 (main.mts의 start·init) — 가짜 Electron으로 불러올 때와 init()에서 하는 일의 차례를 본다.
// 예전 src/main.js가 불러올 때 하던 차례: Chromium 스위치 → exit 처리 → IPC 처리기 → rec:// 등록 → 한 번만 실행 → whenReady → activate → before-quit.
// init()은 예전 문장 차례 그대로. 녹음 폴더는 가짜 설정으로 임시 폴더를 쓴다 (실제 녹음 폴더·앱 데이터는 건드리지 않는다).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Electron from 'electron';
import { tmpDir } from '../test/ipc.mjs';
import { platform } from '../platform/index.mjs';
import { start, type StartDeps } from './main.mjs';

const { readList } = createRequire(import.meta.url)('../../scripts/dev/check-ipc.js') as { readList: () => string[] };
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let order: string[];
let ready: (() => Promise<void>) | null;
let home: string;
let rec: string;

function fakeElectron(): typeof Electron {
  const log = (s: string) => void order.push(s);
  const rel = (f: string) => path.relative(SRC, f);
  class WebContents {
    send() {}
    on() {}
    once(ev: string) {
      log(`webContents.once ${ev}`);
    }
  }
  class BrowserWindow {
    webContents = new WebContents();
    constructor(opts: { width: number; height: number }) {
      log(`new BrowserWindow ${opts.width}x${opts.height}`);
    }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    isDestroyed() {
      return false;
    }
    loadFile(f: string) {
      log(`loadFile ${rel(f)}`);
    }
    once(ev: string) {
      log(`window.once ${ev}`);
    }
    on(ev: string) {
      log(`window.on ${ev}`);
    }
    show() {}
    hide() {}
    focus() {}
    showInactive() {}
    setPosition() {}
  }
  class Tray {
    constructor() {
      log('new Tray');
    }
    setContextMenu() {
      log('tray.setContextMenu');
    }
    setTitle() {}
  }
  const fake = {
    app: {
      commandLine: { appendSwitch: (k: string) => log(`appendSwitch ${k}`) },
      isPackaged: false,
      requestSingleInstanceLock: () => (log('requestSingleInstanceLock'), true),
      quit: () => log('app.quit'),
      on: (ev: string) => log(`app.on ${ev}`),
      whenReady: () => {
        log('whenReady');
        return { then: (fn: () => Promise<void>) => void (ready = fn) };
      },
      dock: { setIcon: (f: string) => log(`dock.setIcon ${rel(f)}`), hide: () => log('dock.hide') },
      getPath: () => home,
      getLoginItemSettings: () => ({ wasOpenedAtLogin: false, openAtLogin: false }),
      setLoginItemSettings: () => log('setLoginItemSettings'),
    },
    BrowserWindow,
    ipcMain: {
      handle: (c: string) => log(`handle ${c}`),
      on: (c: string) => log(`on ${c}`),
      once: (c: string) => log(`once ${c}`),
    },
    session: { defaultSession: { setDisplayMediaRequestHandler: () => log('setDisplayMediaRequestHandler') } },
    desktopCapturer: {},
    Tray,
    Menu: { buildFromTemplate: (t: unknown) => t },
    nativeImage: { createEmpty: () => ({}) },
    shell: {},
    screen: { on: () => {}, getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 100, height: 100 } }) },
    systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: () => (log('askForMediaAccess'), Promise.resolve(true)) },
    clipboard: {},
    nativeTheme: { shouldUseDarkColors: false },
    protocol: {
      registerSchemesAsPrivileged: () => log('registerSchemesAsPrivileged'),
      handle: (s: string) => log(`protocol.handle ${s}`),
    },
    dialog: {},
    net: { isOnline: () => true },
  };
  return fake as unknown as typeof Electron;
}

function deps(): StartDeps {
  const log = (s: string) => void order.push(s);
  const settings = { recordingsDir: rec, language: 'ko', enabled: true, vocabulary: '' };
  return {
    electron: fakeElectron(),
    dictation: {
      getSettings: () => settings,
      storedSettings: () => ({}),
      saveSettings: () => settings,
      init: () => log('dictation.init'),
      stopServer: () => log('dictation.stopServer'),
    } as unknown as StartDeps['dictation'],
    minutes: {} as StartDeps['minutes'],
    usage: {} as StartDeps['usage'],
    ask: { init: (o: { getMeetings: unknown; onChange: unknown }) => log(`ask.init ${typeof o.getMeetings} ${typeof o.onChange}`) } as unknown as StartDeps['ask'],
    compress: {} as StartDeps['compress'],
    setup: { init: () => log('setup.init') } as unknown as StartDeps['setup'],
    srcDir: SRC,
    anthropic: () => {
      throw new Error('부르지 않는다');
    },
  };
}

beforeEach(() => {
  order = [];
  ready = null;
  home = tmpDir('mr-main-home-');
  rec = path.join(tmpDir('mr-main-rec-'), 'recordings');
  fs.mkdirSync(rec);
  // Electron이 process에 더하는 macOS 버전 (시스템 소리 방식 고르기가 읽는다)
  (process as unknown as { getSystemVersion: () => string }).getSystemVersion = () => '15.0.0';
  vi.spyOn(process, 'on').mockImplementation(((ev: string) => (order.push(`process.on ${ev}`), process)) as typeof process.on);
});

afterEach(() => {
  delete (process as unknown as { getSystemVersion?: unknown }).getSystemVersion;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('start()', () => {
  it('불러올 때 하던 일을 예전 차례로 한다: 스위치 → exit → IPC 85개 → rec:// → 한 번만 실행 → whenReady → activate → before-quit', () => {
    start(deps());
    const cap = platform.systemAudio();
    const switches = cap === 'process_tap' || cap === 'screen_capture_kit' ? ['appendSwitch enable-features'] : [];
    const ipc = order.filter((s) => /^(handle|on|once) /.test(s));
    const first = order.findIndex((s) => /^(handle|on) /.test(s));
    const last = order.length - 1 - [...order].reverse().findIndex((s) => /^(handle|on) /.test(s));
    expect(order.slice(0, first)).toEqual([...switches, 'process.on exit']);
    expect(order.slice(first, last + 1).every((s) => /^(handle|on) /.test(s))).toBe(true); // 처리기 사이에 다른 일이 끼지 않는다
    expect(order.slice(last + 1)).toEqual(['registerSchemesAsPrivileged', 'requestSingleInstanceLock', 'app.on second-instance', 'whenReady', 'app.on activate', 'app.on before-quit']);
    // 받는 곳은 ipc-channels.txt와 같다 (once app:ready는 init()에서)
    expect([...ipc].sort()).toEqual(readList().filter((l) => l !== 'once app:ready').sort());
    expect(new Set(ipc).size).toBe(ipc.length);
  });

  it('init(): 예전 문장 차례 그대로', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    start(deps());
    order = [];
    if (!ready) throw new Error('whenReady().then(init)을 부르지 않음');
    await ready();
    expect(order).toEqual([
      'protocol.handle rec',
      ...(platform.shell.devDockIcon ? [`dock.setIcon ${path.join('..', 'build', 'icon.png')}`] : []),
      'ask.init function function',
      ...(platform.shell.askMicAtLaunch ? ['askForMediaAccess'] : []),
      'setDisplayMediaRequestHandler',
      'dictation.init',
      'setup.init',
      'new BrowserWindow 320x200',
      `loadFile ${path.join('overlay', 'index.html')}`,
      'window.once ready-to-show',
      'new Tray',
      'tray.setContextMenu',
      'new BrowserWindow 1240x820',
      'once app:ready',
      'window.on close',
      'window.on swipe',
      `loadFile ${path.join('renderer', 'index.html')}`,
      'webContents.once did-finish-load',
    ]);
    // 저장한 녹음 폴더를 쓰고, 설정 백업을 그 폴더에 쓴다
    expect(fs.existsSync(path.join(rec, 'settings.json'))).toBe(true);
  });

  it('init(): 녹음 폴더 설정 백업의 사전이 문자열이 아니어도 창까지 만든다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    for (const vocabulary of [42, ['가나'], { a: 1 }, null]) {
      fs.writeFileSync(path.join(rec, 'settings.json'), JSON.stringify({ vocabulary, language: 'ko' }));
      start(deps()); // whenReady().then(init)이 새 init을 ready에 넣는다
      order = [];
      if (!ready) throw new Error('whenReady().then(init)을 부르지 않음');
      await ready();
      expect(order).toContain('new BrowserWindow 1240x820');
    }
  });

  it('before-quit: 끝내는 중으로 두고 받아쓰기 서버를 내린다', () => {
    const d = deps();
    const handlers = new Map<string, () => void>();
    (d.electron.app as unknown as { on: (ev: string, fn: () => void) => void }).on = (ev, fn) => void handlers.set(ev, fn);
    start(d);
    order = [];
    handlers.get('before-quit')?.();
    expect(order).toEqual(['dictation.stopServer']);
  });
});
