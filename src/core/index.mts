// 코어: Electron 없이 도는 회의 데이터 읽기. 메인 프로세스(CommonJS)는 require('../lib/core/index.mjs')로 불러 쓴다
export { nameSpeakers, type SpeakerNames } from './names.mjs';
export { parseScript, speakerStats, parseStamp, clock, scriptMarkdown, linesMarkdown } from './script.mjs';
export { MeetingError, findRoot, settingsFile, defaultRecordingsDir, durationOf, readSummary, reviewSummary, readActionsNamed, resolveMeeting, listMeetings, readMinutes, readActions, readScript, readSpeakers } from './meetings.mjs';
export { writeFileAtomic, writeJsonAtomic, copyFileAtomic } from './write.mjs';
export * as schema from './schema.mjs';
