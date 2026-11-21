// ── 메뉴바 (창을 닫아도 앱은 여기서 계속 실행된다) ─────────────────────────
// src/main.js에서 옮김 (결정 70). 메뉴바 아이콘(tray)과 녹음 시간 타이머(trayTimer)는 여기만 갖는다.
// 메뉴 모양은 trayMenu()가 녹음 상태로 정하고(시험이 바로 부른다), 누르면 하는 일은 본체가 넘긴 것을 그때 부른다.
// Electron은 가져오지 않는다(타입만) — Tray·Menu·nativeImage·shell·app은 본체가 넘긴다. 메뉴바는 init()에서 만든다.
import type * as Electron from 'electron';
import { created } from './windows.mjs';

// 메뉴를 고르는 데 쓰는 녹음 상태 (메뉴를 만들 때의 것)
export interface TrayRecording {
  mode: string;
  pausedAt: number | null;
}

// 메뉴 항목을 눌렀을 때 하는 일 (누를 때의 녹음 상태를 읽는다)
export interface TrayActions {
  togglePause: () => void; // 일시정지 ↔ 녹음 재개
  stopMeeting: () => void; // 종료하고 저장
  confirmCancel: () => unknown; // 녹음 취소 (버리기)…
  stopDictation: () => void; // 받아쓰기 정지
  startDictation: () => void;
  pasteLast: () => void;
  startMeeting: () => void;
  showWindow: () => void;
  openRecordings: () => void;
  setOpenAtLogin: (on: boolean) => void;
  quit: () => void;
}

// 녹음 상태마다 메뉴 위쪽이 다르고, 아래쪽(창 열기·녹음 폴더·로그인 시 자동 실행·종료)은 같다
export function trayMenu(recording: TrayRecording | null, login: { isPackaged: boolean; openAtLogin: () => boolean }, act: TrayActions): Electron.MenuItemConstructorOptions[] {
  const menu: Electron.MenuItemConstructorOptions[] = recording?.mode === 'meeting'
    ? [
        { label: recording.pausedAt ? '녹음 재개' : '일시정지', click: act.togglePause },
        { label: '종료하고 저장', click: act.stopMeeting },
        { label: '녹음 취소 (버리기)…', click: act.confirmCancel },
      ]
    : recording
    ? [{ label: '받아쓰기 정지', click: act.stopDictation }]
    : [
        { label: '받아쓰기 시작 (fn 꾹 누르기)', click: act.startDictation },
        { label: '마지막 받아쓰기 붙여넣기', click: act.pasteLast },
        { label: '회의 녹음 시작', click: act.startMeeting },
      ];
  return [
    ...menu,
    { type: 'separator' },
    { label: '창 열기', click: act.showWindow },
    { label: '녹음 폴더 열기', click: act.openRecordings },
    {
      label: '로그인 시 자동 실행',
      type: 'checkbox',
      enabled: login.isPackaged,
      checked: login.isPackaged && login.openAtLogin(),
      click: (item) => act.setOpenAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: '종료', accelerator: 'Command+Q', click: act.quit },
  ];
}

// 메뉴바 제목: 녹음 중이면 ● 회의 03:07 (일시정지면 ❚❚)
export function trayTitle(recording: TrayRecording | null, elapsedMs: number): string {
  if (!recording) return '🎙';
  const label = recording.mode === 'meeting' ? '회의' : '메모';
  const s = Math.floor(elapsedMs / 1000);
  return `${recording.pausedAt ? '❚❚' : '●'} ${label} ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export interface TrayContext {
  Tray: typeof Electron.Tray;
  nativeImage: Pick<typeof Electron.nativeImage, 'createEmpty'>;
  Menu: Pick<typeof Electron.Menu, 'buildFromTemplate'>;
  shell: { openPath(p: string): unknown };
  app: Pick<Electron.App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings' | 'quit'>;
  recording: () => TrayRecording | null; // 지금 녹음 (부를 때 읽는다)
  elapsedMs: () => number;
  setPaused: (on: boolean) => void;
  uiToggle: (mode: string | undefined) => void;
  confirmCancel: () => unknown;
  pasteLast: () => void;
  showWindow: () => void;
  recordingsDir: () => string;
  sendOverlayState: () => void;
}

export interface TrayMenu {
  create(): void; // init()에서 한 번
  updateTray(): void;
}

export function createTray(ctx: TrayContext): TrayMenu {
  const { app } = ctx;
  let tray: Electron.Tray | undefined;
  let trayTimer: ReturnType<typeof setInterval> | undefined;

  const actions: TrayActions = {
    togglePause: () => ctx.setPaused(!ctx.recording()?.pausedAt),
    stopMeeting: () => ctx.uiToggle('meeting'),
    confirmCancel: () => ctx.confirmCancel(),
    stopDictation: () => ctx.uiToggle(ctx.recording()?.mode),
    startDictation: () => ctx.uiToggle('memo'),
    pasteLast: () => ctx.pasteLast(),
    startMeeting: () => ctx.uiToggle('meeting'),
    showWindow: () => ctx.showWindow(),
    openRecordings: () => ctx.shell.openPath(ctx.recordingsDir()),
    setOpenAtLogin: (on) => app.setLoginItemSettings({ openAtLogin: on }),
    quit: () => app.quit(),
  };

  function updateTray(): void {
    clearInterval(trayTimer);
    ctx.sendOverlayState();
    const recording = ctx.recording();
    created(tray, '메뉴바').setContextMenu(ctx.Menu.buildFromTemplate(trayMenu(recording, { isPackaged: app.isPackaged, openAtLogin: () => app.getLoginItemSettings().openAtLogin }, actions)));

    if (!recording) {
      created(tray, '메뉴바').setTitle(trayTitle(null, 0));
      return;
    }
    const tick = (rec: TrayRecording) => created(tray, '메뉴바').setTitle(trayTitle({ mode: recording.mode, pausedAt: rec.pausedAt }, ctx.elapsedMs()));
    tick(recording);
    trayTimer = setInterval(() => {
      const rec = ctx.recording();
      if (rec) tick(rec);
    }, 1000);
  }

  return {
    create: () => {
      tray = new ctx.Tray(ctx.nativeImage.createEmpty());
    },
    updateTray,
  };
}
