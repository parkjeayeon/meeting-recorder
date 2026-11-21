// 본체(메인 프로세스)를 구역별로 (결정 70). 모두 Electron을 가져오지 않고(타입만) register(ipc, ctx)·create…(ctx)로 받는다:
// ipc는 Electron의 ipcMain(시험에서는 가짜), ctx는 그 구역이 읽거나 부르는 것만 — 다른 구역이 갖고 있는 값(녹음 폴더·창·녹음 중인지)은
// 부를 때 읽는 getter로, 바꾸는 것은 그 구역의 함수로 받는다.
// 진입점 src/main.js(CommonJS)는 require('../lib/app/main.mjs')의 start()만 부르고, start()가 아래 구역을 만들어 잇는다:
// main.mts(start·init·앱 수명), folders(녹음 폴더·설정 백업), windows(메인 창·플로팅 독), tray(메뉴바), recording(녹음 저장), dictation-run(받아쓰기 처리),
// minutes-run(회의록 실행·인터넷 기다리기), meeting·review·watch(회의 페이지), settings(설정·설치·앱 정보), fn-keys(fn 도우미·셀프테스트, fn.mts의 상태 머신을 만든다),
// system(시스템 소리·권한 상태), protocol(rec://), 그리고 앞서 옮긴 history·ask·tokens·permissions·onboarding·recordings.
export type { Ipc, Handler } from './ipc.mjs';
export { start, type StartDeps } from './main.mjs';
export type { MinutesModule, UsageModule, CompressModule } from './connectors.mjs';
export { registerHistory, type HistoryContext, type History, type FolderItem, type FolderMeta, type MinutesState, type DictationItem } from './history.mjs';
export { registerAsk, type AskContext, type AskMeeting, type AskMeetingStatus } from './ask.mjs';
export { registerTokens, DIARIZE_MODEL, EXTERNAL_LINKS, type TokensContext, type TokenSources, type VerifyResult, type AnthropicClient } from './tokens.mjs';
export { registerPermissions, type PermissionsContext, type PermissionStatus } from './permissions.mjs';
export { registerOnboarding, type OnboardingContext, type OnboardingState } from './onboarding.mjs';
export { registerRecordingsFolder, moveEntry, type RecordingsFolderContext, type FolderDialog, type ChooseResult } from './recordings.mjs';
export { createFnMachine, type FnDeps, type FnMachine, type FnState } from './fn.mjs';
export { createFolders, readJson, vocabList, PORTABLE_KEYS, type Folders, type FoldersContext } from './folders.mjs';
export { registerWindows, created, type Windows, type WindowsContext } from './windows.mjs';
export { createTray, trayMenu, trayTitle, type TrayMenu, type TrayContext, type TrayActions, type TrayRecording } from './tray.mjs';
export { registerRecording, timestamp, VOICE_RMS, DICTATION_MAX_MS, type Recording, type RecordingSession, type RecordingContext, type ClockInfo } from './recording.mjs';
export { registerDictationRun, countWords, type DictationRun, type DictationRunContext, type DictationJob, type DictationLogEntry, type DictationOutcome, type FrontApp } from './dictation-run.mjs';
export { createMinutesRun, MIN_MEETING_SEC, type MinutesRun, type MinutesRunContext } from './minutes-run.mjs';
export { registerMeeting, type MeetingContext, type MeetingDialog } from './meeting.mjs';
export { registerReview, VOCAB_KINDS, type ReviewContext } from './review.mjs';
export { registerWatchers, WATCHED, type Watchers, type WatchContext } from './watch.mjs';
export { registerSettings, LANG_CYCLE, type SettingsContext } from './settings.mjs';
export { createFnKeys, DEBOUNCE_MS, type FnKeys, type FnKeysContext } from './fn-keys.mjs';
export { appendCaptureSwitches, installDisplayMediaHandler, createPermissionHelpers, type PermissionHelpers } from './system.mjs';
export { createServeRecording, REC_SCHEME, type RecRequest } from './protocol.mjs';
