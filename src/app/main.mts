// ── 본체(메인 프로세스) 시작: 구역을 만들어 잇고, 앱이 준비되면 init()으로 창을 띄운다 ───────────
// src/main.js의 본문을 옮김 (결정 70). 진입점 src/main.js(CommonJS)는 electron과 CommonJS 연결 파일(dictation·minutes·usage·ask·compress·setup)을
// require로 불러 start()에 넘긴다 — scripts/dev 시험이 그 연결 파일을 require·require.cache로 바꿔 끼우고, 동기 require(esm)라 시작 시각도 예전 그대로다.
// 여기는 Electron을 가져오지 않는다(타입만). 불러올 때 하던 일(Chromium 스위치, exit 처리, IPC 처리기 등록, rec:// 등록,
// 한 번만 실행·whenReady·activate·before-quit)은 start() 안에서 예전 순서대로 한 번에 한다.
// 구역마다 자기 상태를 갖는다: 녹음 폴더·설정 백업(folders), 창 둘(windows), 메뉴바(tray), 녹음(recording), 받아쓰기 처리(dictation-run),
// 회의록 실행(minutes-run), fn 키 도우미(fn-keys), 파일 지켜보기(watch). 여기서 갖는 것은 끝내는 중인지(quitting)뿐이다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type * as Electron from 'electron';
import { platform } from '../platform/index.mjs';
import { registerHistory } from './history.mjs';
import { registerAsk } from './ask.mjs';
import { registerTokens, type AnthropicClient } from './tokens.mjs';
import { registerPermissions } from './permissions.mjs';
import { registerOnboarding, type OnboardingState } from './onboarding.mjs';
import { registerRecordingsFolder } from './recordings.mjs';
import { registerInbox } from './inbox.mjs';
import { createFolders, readJson } from './folders.mjs';
import { registerWindows } from './windows.mjs';
import { createTray } from './tray.mjs';
import { createFnKeys } from './fn-keys.mjs';
import { registerRecording } from './recording.mjs';
import { registerDictationRun } from './dictation-run.mjs';
import { createMinutesRun } from './minutes-run.mjs';
import { registerMeeting } from './meeting.mjs';
import { registerWatchers } from './watch.mjs';
import { registerReview } from './review.mjs';
import { registerSettings } from './settings.mjs';
import { appendCaptureSwitches, createPermissionHelpers, installDisplayMediaHandler } from './system.mjs';
import { REC_SCHEME, createServeRecording } from './protocol.mjs';
import type { AskEngine, CompressModule, Dictation, MinutesModule, Setup, UsageModule } from './connectors.mjs';

export interface StartDeps {
  electron: typeof Electron;
  dictation: Dictation; // src/dictation.js
  minutes: MinutesModule; // src/minutes.js
  usage: UsageModule; // src/usage.js
  ask: AskEngine; // src/ask.js
  compress: CompressModule; // src/compress.js
  setup: Setup; // src/setup.js
  srcDir: string; // src/ (진입점의 __dirname) — preload.js·overlay/·renderer/·../native·../build가 여기서 정해진다
  anthropic: () => AnthropicClient; // require('@anthropic-ai/sdk').default — 키를 확인할 때만 불러온다
}

export function start(deps: StartDeps): void {
  const { dictation, minutes, compress, setup, srcDir } = deps;
  const usageMod = deps.usage;
  const askMod = deps.ask;
  const { app, BrowserWindow, ipcMain, session, desktopCapturer, Tray, Menu, nativeImage, shell, screen, systemPreferences, clipboard, nativeTheme, protocol, dialog, net } = deps.electron;

  const SELFTEST = process.argv.includes('--selftest');
  const log = (...args: unknown[]) => console.log(...args);

  // 녹음 폴더·받아쓰기 기록 경로·설정 백업. 폴더를 바꾸면 지켜보던 녹음 폴더도 바꾼다
  const folders = createFolders({ dictation, onDirChanged: () => watchers.dirChanged() });

  // ── 시스템 오디오 캡처 경로 (Wispr Flow와 같은 분기) ──────────────────────
  // macOS 14.4+ : Core Audio Process Tap / 13~14.3 : ScreenCaptureKit / 그 이하 : 미지원. 고르는 일은 src/platform/system-audio.mts
  const capability = platform.systemAudio();
  appendCaptureSwitches(app.commandLine, capability);

  let quitting = false;

  // before-quit 없이 끝나면(강제 종료·크래시) fn-listener가 고아로 남는다. 종료 때 끄고, 시작할 때 남은 것을 정리한다 (fn-keys.mts)
  // 예전처럼 IPC 처리기를 등록하기 전에 붙인다
  process.on('exit', () => fnKeys.killListener());

  function helperPath(name: string): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, name)
      : path.join(srcDir, '..', 'native', name);
  }

  // ── 창 둘 (메인 창·플로팅 독) ──────────────────────────────────────────
  const windows = registerWindows(ipcMain, {
    BrowserWindow,
    screen,
    nativeTheme,
    srcDir,
    recording: () => recorder.get(),
    transcribing: () => dictRun.transcribing(),
    clockInfo: () => recorder.clockInfo(),
    fnState: () => fnKeys.machine.state(),
    language: () => dictation.getSettings().language,
  });
  function send(channel: string, payload?: unknown): void {
    windows.send(channel, payload);
  }
  const uiToggle = (mode: string | undefined) => fnKeys.machine.uiToggle(mode);

  // ── fn 키 동작: 받아쓰기 전용 (회의 녹음은 창·독·메뉴바 버튼으로만) ────────────
  const fnKeys = createFnKeys({
    selftest: SELFTEST,
    recording: () => recorder.get(),
    transcribing: () => dictRun.transcribing(),
    dictation,
    quitting: () => quitting,
    helperPath,
    send,
    sendOverlay: windows.sendOverlay,
    sendOverlayState: windows.sendOverlayState,
    quit: () => app.quit(),
    log,
  });

  // 권한 상태 읽기와 권한 도우미는 녹음 시작(rec:start)·창 띄우기(init)·권한 처리기가 같이 쓴다
  const { runPermissionsHelper, permissionStatus } = createPermissionHelpers({
    helperBin: () => helperPath('permissions'),
    getMediaAccessStatus: (mediaType) => systemPreferences.getMediaAccessStatus(mediaType),
    capability,
    selftest: SELFTEST,
    startFnListener: () => fnKeys.startFnListener(),
  });

  // ── 녹음 파일 저장·녹음 버튼·참석 인원 ─────────────────────────────────────
  const recorder = registerRecording(ipcMain, {
    recordingsDir: folders.recordingsDir,
    tempDir: () => app.getPath('temp'),
    fn: fnKeys.machine,
    dictation,
    runPermissionsHelper,
    runDictation: (job) => dictRun.runDictation(job),
    runMinutes: (dir, speakers, opts) => minutesRun.runMinutes(dir, speakers, opts),
    // 회의 녹음 중 미리 받아쓰기 (결정 83). 회의 모듈의 Whisper 서버·설정은 src/minutes.js가 이어 둔 것을 쓴다
    createPretranscriber: (dir, tracks) => minutes.createPretranscriber({ dir, tracks, log }),
    updateTray: () => tray.updateTray(),
    send,
    sendOverlay: windows.sendOverlay,
    dialog,
    selftest: SELFTEST,
    log,
  });

  // ── 받아쓰기 처리·기록 지우기·다시 붙여넣기 ─────────────────────────────────
  const dictRun = registerDictationRun(ipcMain, {
    dictation,
    fn: fnKeys.machine,
    recordingsDir: folders.recordingsDir,
    dictationLog: folders.dictationLog,
    helperPath,
    listHistory: (limit) => listHistory(limit),
    send,
    sendOverlay: windows.sendOverlay,
    sendOverlayState: windows.sendOverlayState,
    updateTray: () => tray.updateTray(),
    hideWindow: () => windows.mainWindow().hide(),
    showOverlay: windows.showOverlay,
    app,
    clipboard,
    selftest: SELFTEST,
    log,
  });

  // ── 회의록 ──────────────────────────────────────────────────────────────
  const minutesRun = createMinutesRun({ minutes, isOnline: () => net.isOnline(), send, sendOverlay: windows.sendOverlay });
  const { activeMinutes, waitingOnline, waitForOnline } = minutesRun;
  registerMeeting(ipcMain, {
    recordingsDir: folders.recordingsDir,
    recordingDir: folders.recordingDir,
    recording: () => recorder.get(),
    activeMinutes,
    runMinutes: minutesRun.runMinutes,
    minutes,
    compress,
    dialog,
    shell,
    win: windows.win,
    downloads: () => app.getPath('downloads'),
  });
  const watchers = registerWatchers(ipcMain, { recordingsDir: folders.recordingsDir, recordingDir: folders.recordingDir, send });
  registerReview(ipcMain, { recordingDir: folders.recordingDir, minutes, dictation, writePortableSettings: folders.writePortableSettings });

  // ── 기록 (녹음 폴더를 읽어 창에 보여 준다) ─────────────────────────────────
  // 받아쓰기 기록·회의 목록 읽기(읽어 둔 것 포함)와 history:list·recordings:stray·recordings:access·dict:page·dict:stats는 src/app/history.mts.
  // 녹음 폴더·받아쓰기 기록 경로·녹음 중인 것은 부를 때 읽게 getter로 넘긴다. 목록 둘은 메뉴바(pasteLast)와 질문으로 찾기가 쓴다
  const { listFolders, listHistory } = registerHistory(ipcMain, {
    recordingsDir: folders.recordingsDir,
    dictationLog: folders.dictationLog,
    recording: () => recorder.get(),
    activeMinutes,
    waitingOnline,
    waitForOnline,
    readJson,
    compress,
  });

  // ── 받아쓰기 설정·음성 인식 설치·다듬기 계정·앱 정보·떠 있는 막대의 버튼 ─────────
  registerSettings(ipcMain, {
    dictation,
    minutes,
    setup,
    usage: usageMod,
    writePortableSettings: folders.writePortableSettings,
    recordingsDir: folders.recordingsDir,
    defaultRecordingsDir: folders.defaultRecordingsDir,
    capability,
    fnUsageWarning: fnKeys.fnUsageWarning,
    micAccess: () => (platform.shell.micAccessFromSystem ? systemPreferences.getMediaAccessStatus('microphone') : 'granted'),
    selftest: SELFTEST,
    log,
    send,
    sendOverlayState: windows.sendOverlayState,
    showWindow: windows.showWindow,
    uiToggle,
    showItemInFolder: (p) => shell.showItemInFolder(p),
  });

  // ── 질문으로 회의 찾기 (src/ask.js, 결정 51): 메인 프로세스에서 돌아 화면을 옮기거나 창을 닫아도 이어진다 ──
  // 처리기와 엔진에 넘길 회의 목록(askMeetings)은 src/app/ask.mts. 엔진은 init()에서 켠다
  const { askMeetings } = registerAsk(ipcMain, { ask: askMod, listFolders });

  // ── 연결 설정 창: 토큰·키 저장, 삭제, 확인 (src/app/tokens.mts) ──────────────
  registerTokens(ipcMain, { dictation, shell, anthropic: deps.anthropic });

  // ── 권한 확인 / 요청 (src/app/permissions.mts) ──────────────────────────
  registerPermissions(ipcMain, { permissionStatus, runPermissionsHelper, fnUsageWarning: fnKeys.fnUsageWarning, systemPreferences, shell });

  // ── 처음 설정(온보딩): 처리기는 src/app/onboarding.mts. fn 키 확인 단계 표시(fnTestMode)는 fn 상태 머신이 갖는다 ──
  // 저장된 onboarding 값은 settings 타입에 칸이 없어(unknown) 화면이 적는 모양으로 읽는다. 부를 때 dictation 객체에서 찾는 것은 예전과 같다
  const onboardingDictation = {
    storedSettings: () => dictation.storedSettings() as { onboarding?: OnboardingState },
    saveSettings: (patch: { onboarding: OnboardingState }) => dictation.saveSettings(patch),
  };
  registerOnboarding(ipcMain, { dictation: onboardingDictation, setFnTestMode: (on) => fnKeys.machine.setFnTestMode(on), win: windows.mainWindow, app });

  // ── 녹음 폴더 바꾸기 (src/app/recordings.mts): 녹음 폴더·녹음 중인지·창은 부를 때 읽게, 폴더 바꾸기·설정 백업·메뉴바 갱신은 함수로 ──
  registerRecordingsFolder(ipcMain, {
    recordingsDir: folders.recordingsDir,
    defaultRecordingsDir: folders.defaultRecordingsDir,
    setRecordingsDir: folders.setRecordingsDir,
    recording: () => recorder.get(),
    activeMinutes,
    mergePortableSettings: folders.mergePortableSettings,
    writePortableSettings: folders.writePortableSettings,
    updateTray: () => tray.updateTray(),
    win: windows.win,
    dialog,
    shell,
    dictation,
  });

  // ── 설정 › 폰 녹음: 받을 폴더 고르기·열기 (src/app/inbox.mts, 결정 84). 폴더를 지켜보는 일은 아직 없다 ──
  registerInbox(ipcMain, {
    recordingsDir: folders.recordingsDir,
    inboxDir: () => dictation.getSettings().inboxDir ?? null,
    home: () => os.homedir(),
    win: windows.win,
    dialog,
    shell,
  });

  // ── 메뉴바 (창을 닫아도 앱은 여기서 계속 실행된다) ─────────────────────────
  const tray = createTray({
    Tray,
    nativeImage,
    Menu,
    shell,
    app,
    recording: () => recorder.get(),
    elapsedMs: () => recorder.elapsedMs(),
    setPaused: recorder.setPaused,
    uiToggle,
    confirmCancel: recorder.confirmCancel,
    pasteLast: dictRun.pasteLast,
    showWindow: windows.showWindow,
    recordingsDir: folders.recordingsDir,
    sendOverlayState: windows.sendOverlayState,
  });

  // 회의 녹음 재생용: rec://m/<회의 폴더 이름>/<파일> (src/app/protocol.mts)
  protocol.registerSchemesAsPrivileged([REC_SCHEME]);
  const serveRecording = createServeRecording(folders.recordingsDir);

  if (!SELFTEST && !app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', () => windows.win() && windows.showWindow());
    app.whenReady().then(init);
  }

  async function init() {
    protocol.handle('rec', serveRecording);
    // 개발 모드에서도 Dock에 앱 아이콘을 쓴다 (설치본은 build/icon.icns가 앱에 들어간다)
    if (!app.isPackaged && platform.shell.devDockIcon) app.dock?.setIcon(path.join(srcDir, '..', 'build', 'icon.png'));
    const saved = dictation.getSettings().recordingsDir as string | null | undefined;
    if (saved && fs.existsSync(saved)) folders.setRecordingsDir(saved); // 지정한 폴더가 사라졌으면(외장 디스크 분리 등) 기본 폴더를 쓴다
    // 셀프테스트는 실제 녹음 폴더·받아쓰기 기록에 쓰지 않는다 (예전에는 끝나고 손으로 지워야 했다)
    if (SELFTEST) {
      folders.setRecordingsDir(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-selftest-')));
      console.log('SELFTEST recordings', folders.recordingsDir());
    }
    folders.mergePortableSettings();
    folders.writePortableSettings();
    askMod.init({ getMeetings: askMeetings, onChange: (job) => send('ask:update', job) }); // 질문으로 찾기: 회의 목록과 진행 소식을 화면에
    // 권한 대화상자를 기다리느라 fn 감지·독·로그인 항목 설정이 멈추지 않게 await하지 않는다
    if (platform.shell.askMicAtLaunch) systemPreferences.askForMediaAccess('microphone');
    fs.mkdirSync(folders.recordingsDir(), { recursive: true });
    watchers.watchRecordings();

    // 패키징된 앱은 처음 실행할 때 로그인 항목에 등록
    const FIRST_RUN_FLAG = path.join(app.getPath('userData'), '.login-item-configured');
    if (app.isPackaged && !fs.existsSync(FIRST_RUN_FLAG)) {
      app.setLoginItemSettings({ openAtLogin: true });
      fs.writeFileSync(FIRST_RUN_FLAG, '');
    }
    const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;

    installDisplayMediaHandler(session.defaultSession, desktopCapturer, capability);
    dictation.init({ onEngineStatus: (status) => send('dict:engine', status) });
    setup.init({ onStatus: (list) => send('setup:status', list) });

    const overlay = windows.createOverlay();
    if (!SELFTEST) overlay.once('ready-to-show', windows.showOverlay);
    tray.create();
    tray.updateTray();

    const win = windows.createMainWindow();
    if (openedAtLogin) windows.hideWindow();
    let shown = false;
    const showOnce = () => {
      if (shown || openedAtLogin || SELFTEST) return;
      shown = true;
      win.show();
    };
    ipcMain.once('app:ready', showOnce);
    setTimeout(showOnce, 4000); // 렌더러가 늦거나 오류가 나도 창은 띄운다
    if (SELFTEST) app.dock?.hide();
    // X 버튼은 창만 숨긴다. 종료는 메뉴바 › 종료 또는 ⌘Q
    win.on('close', (e) => {
      if (quitting) return;
      e.preventDefault();
      windows.hideWindow();
    });
    win.on('swipe', (_e, dir) => send('nav:swipe', dir)); // 트랙패드로 페이지 넘기기 (시스템 설정에서 켠 경우)
    win.loadFile(path.join(srcDir, 'renderer', 'index.html'));
    win.webContents.once('did-finish-load', () => {
      if (SELFTEST) fnKeys.runFnSimulation();
      else permissionStatus(); // 입력 모니터링이 허용돼 있으면 fn 감지 시작
      // 개발용: SCREENSHOT=경로 를 주면 창을 캡처해 저장
      if (!app.isPackaged && process.env.SCREENSHOT) {
        setTimeout(async () => fs.writeFileSync(process.env.SCREENSHOT as string, (await win.webContents.capturePage()).toPNG()), 2500);
      }
    });
  }

  app.on('activate', () => windows.win() && windows.showWindow()); // Dock 아이콘 클릭
  app.on('before-quit', () => {
    quitting = true;
    fnKeys.killListener();
    dictation.stopServer();
    recorder.closeOnQuit();
  });
}
