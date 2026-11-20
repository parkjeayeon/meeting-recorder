// 본체(src/main.js)의 IPC 처리기를 구역별로 (결정 70). 모두 Electron을 가져오지 않고 register(ipc, ctx)로 받는다:
// ipc는 Electron의 ipcMain(시험에서는 가짜), ctx는 그 구역이 읽거나 부르는 것만 — 본체가 갖고 있는 값(녹음 폴더·창·녹음 중인지)은
// 부를 때 읽는 getter로, 바꾸는 것은 본체 함수로 받는다. 본체(CommonJS)는 require('../lib/app/index.mjs')로 불러 쓴다.
// fn 키 상태 머신(fn.mts)은 처리기가 아니라 본체가 createFnMachine(deps)로 한 번 만들어 부른다.
// 아직 main.js에 남은 것: fn-listener 실행·셀프테스트, 녹음 저장, 회의록 구역, 시스템 오디오, 메뉴바, 플로팅 독, 창·앱 수명.
export type { Ipc, Handler } from './ipc.mjs';
export { registerHistory, type HistoryContext, type History, type FolderItem, type FolderMeta, type MinutesState, type DictationItem } from './history.mjs';
export { registerAsk, type AskContext, type AskMeeting, type AskMeetingStatus } from './ask.mjs';
export { registerTokens, DIARIZE_MODEL, EXTERNAL_LINKS, type TokensContext, type TokenSources, type VerifyResult, type AnthropicClient } from './tokens.mjs';
export { registerPermissions, type PermissionsContext, type PermissionStatus } from './permissions.mjs';
export { registerOnboarding, type OnboardingContext, type OnboardingState } from './onboarding.mjs';
export { registerRecordingsFolder, moveEntry, type RecordingsFolderContext, type FolderDialog, type ChooseResult } from './recordings.mjs';
export { createFnMachine, type FnDeps, type FnMachine, type FnState } from './fn.mjs';
