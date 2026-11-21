// ── 창 둘: 메인 창과 플로팅 독 (Wispr Flow처럼 화면 왼쪽 가장자리에 붙는 작은 알약) ───────────
// src/main.js에서 옮김 (결정 70). 두 창(win·overlay)은 여기만 갖고, 창으로 보내기(send·sendOverlay·sendOverlayState)와
// 보이기·숨기기도 여기. 두 창은 init()에서 만들어진다 — 그 전에 보내기는 예전처럼 아무 일도 하지 않고, 창을 바로 쓰는 일
// (보이기·숨기기)은 예전처럼 TypeError로 실패한다(created()).
// Electron은 가져오지 않는다(타입만) — BrowserWindow·screen·nativeTheme과 파일 자리(srcDir)는 본체가 넘긴다.
import path from 'node:path';
import type * as Electron from 'electron';
import { platform } from '../platform/index.mjs';
import type { ClockInfo } from './recording.mjs';
import type { FnState } from './fn.mjs';
import type { Ipc } from './ipc.mjs';

// 플로팅 독 (Wispr Flow처럼 화면 왼쪽 가장자리에 붙는 작은 알약)
const OVERLAY_SIZE = { width: 320, height: 200 }; // 독(받아쓰기·회의·기록·언어 버튼, 펼치면 약 165px) + 오른쪽으로 펼쳐지는 진행 띠

// init()에서 만드는 것(창·독·메뉴바)을 그 전에 쓰면: 예전 `win.show()`가 undefined에서 던지던 TypeError를 그대로 던진다
export function created<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new TypeError(`${what}이(가) 아직 만들어지지 않았습니다`);
  return value;
}

export interface WindowsContext {
  BrowserWindow: typeof Electron.BrowserWindow;
  screen: Pick<Electron.Screen, 'on' | 'getPrimaryDisplay'>;
  nativeTheme: Pick<Electron.NativeTheme, 'shouldUseDarkColors'>;
  srcDir: string; // src/ (preload.js·overlay/·renderer/가 있는 곳)
  // 독 상태 (부를 때 읽는다)
  recording: () => { mode: string } | null;
  transcribing: () => number;
  clockInfo: () => ClockInfo | null;
  fnState: () => FnState;
  language: () => string;
}

export interface Windows {
  overlaySize: { width: number; height: number };
  win(): Electron.BrowserWindow | undefined; // 아직 없으면 undefined (예전 `win`을 그대로 넘기던 곳)
  mainWindow(): Electron.BrowserWindow; // 아직 없으면 TypeError
  send: (channel: string, payload?: unknown) => void;
  sendOverlay: (channel: string, payload?: unknown) => void;
  sendOverlayState(): void;
  showWindow(): void;
  hideWindow(): void;
  showOverlay(): void;
  createOverlay(): Electron.BrowserWindow;
  createMainWindow(): Electron.BrowserWindow;
}

export function registerWindows(ipc: Ipc, ctx: WindowsContext): Windows {
  const { BrowserWindow, screen } = ctx;
  let win: Electron.BrowserWindow | undefined;
  let overlay: Electron.BrowserWindow | undefined;

  function send(channel: string, payload?: unknown): void {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  // 플로팅 독은 앱이 켜져 있는 동안 창을 열든 닫든 항상 보인다
  function showWindow(): void {
    created(win, '메인 창').show();
    created(win, '메인 창').focus();
  }

  function hideWindow(): void {
    created(win, '메인 창').hide(); // Dock 아이콘은 남겨 둔다 (클릭하면 창 열기, 우클릭 › 종료)
    showOverlay();
  }

  function createOverlay(): Electron.BrowserWindow {
    overlay = new BrowserWindow({
      ...OVERLAY_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false, // 클릭해도 지금 쓰던 앱의 포커스를 빼앗지 않는다
      // macOS: 앱을 깨우지 않는 패널(NSPanel). 일반 창이면 막대를 마우스로 누를 때 앱 전체가 활성화되며 메인 창까지 올라온다
      // (fn으로는 안 올라오고 마우스로 누를 때만 그랬다). Wispr Flow의 막대("Flow Status Indicator")도 type: 'panel'
      ...platform.shell.overlayWindow,
      acceptFirstMouse: true, // 다른 앱을 쓰던 중 첫 클릭도 버튼으로 받는다
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: { preload: path.join(ctx.srcDir, 'overlay', 'preload.js') },
    });
    overlay.setAlwaysOnTop(true, 'floating');
    // skipTransformProcessType: 이게 없으면 macOS에서 앱이 UIElement로 바뀌어 Dock 아이콘이 사라진다
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.loadFile(path.join(ctx.srcDir, 'overlay', 'index.html'));
    overlay.webContents.on('did-finish-load', sendOverlayState);
    screen.on('display-metrics-changed', positionOverlay);
    screen.on('display-removed', positionOverlay);
    return overlay;
  }

  function positionOverlay(): void {
    if (!overlay) return;
    const { workArea } = screen.getPrimaryDisplay();
    overlay.setPosition(workArea.x, Math.round(workArea.y + (workArea.height - OVERLAY_SIZE.height) / 2));
  }

  function showOverlay(): void {
    positionOverlay();
    created(overlay, '플로팅 독').showInactive();
  }

  function sendOverlay(channel: string, payload?: unknown): void {
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send(channel, payload);
  }

  function sendOverlayState(): void {
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send('overlay:state', { recording: ctx.recording()?.mode ?? null, transcribing: ctx.transcribing() > 0, clock: ctx.clockInfo(), handsfree: ctx.recording()?.mode === 'memo' && ctx.fnState() === 'handsfree', language: ctx.language() });
    }
  }

  function createMainWindow(): Electron.BrowserWindow {
    win = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      show: false, // 렌더러가 보여 줄 화면(처음 설정 또는 본 화면)을 정한 뒤 app:ready에서 띄운다
      title: 'Meeting Recorder',
      backgroundColor: ctx.nativeTheme.shouldUseDarkColors ? '#111214' : '#eceef1',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 15 },
      webPreferences: {
        preload: path.join(ctx.srcDir, 'preload.js'),
        backgroundThrottling: false, // 창이 숨겨져도 녹음이 끊기지 않게
      },
    });
    return win;
  }

  ipc.on('overlay:interactive', (_e, on) => overlay?.setIgnoreMouseEvents(!on, { forward: true }));

  return {
    overlaySize: OVERLAY_SIZE,
    win: () => win,
    mainWindow: () => created(win, '메인 창'),
    send,
    sendOverlay,
    sendOverlayState,
    showWindow,
    hideWindow,
    showOverlay,
    createOverlay,
    createMainWindow,
  };
}
