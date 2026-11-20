// 회의록: 회의 녹음 → 16kHz로 줄여 로컬 Whisper로 녹취 → 로그인된 Claude Code / Codex / API로 회의록 작성.
// 결과는 녹음 폴더에 transcript.txt(원본 대화 스크립트), script-clean.txt(가지치기한 정리본),
// minutes.md(회의록), minutes.json(상태)으로 남는다.
// 구현은 TypeScript로 옮겼다 — 녹취·화자 구분·회의록은 src/meeting, 확인 필요는 src/review (결정 70).
// 이 파일은 Electron과 본체 모듈(설정·Whisper·LLM·샌드박스)을 거기에 이어 주고 예전 이름 그대로 내보낸다.
// 용어 설명·흐름도·액션(src/meeting)도 여기서 넘긴 LLM 호출·지금 설정·API 키를 쓴다 (본체가 시작할 때 이 파일을 불러와 이어 둔다).
const { app, net } = require('electron');
const dictation = require('./dictation');
// 시험(scripts/dev)이 cleanup.js의 complete를 가짜로 바꿔 끼우므로 예전처럼 불러올 때의 것을 넘긴다
const { complete } = require('./cleanup');
const sandbox = require('./sandbox');
const glossary = require('../lib/meeting/glossary.mjs');
const { nameSpeakers } = require('../lib/core/index.mjs');
const meeting = require('../lib/meeting/index.mjs');
const review = require('../lib/review/index.mjs');

// 예전 minutes.js가 부를 때마다 읽던 것은 함수로 넘겨 부를 때 읽는다 (앱 데이터 폴더, 지금 설정, 바꿔 끼운 함수)
meeting.configure({
  userData: () => app.getPath('userData'),
  isPackaged: () => app.isPackaged,
  resourcesPath: () => process.resourcesPath,
  isOnline: () => net.isOnline(),
  getSettings: () => dictation.getSettings(),
  apiKey: () => dictation.apiKey(),
  transcribeSegments: (...args) => dictation.transcribeSegments(...args),
  startDedicatedServer: (...args) => dictation.startDedicatedServer(...args),
  complete,
  makeGlossary: (dir) => glossary.makeGlossary(dir),
  sandboxWrap: (cmd, args, opts) => sandbox.wrap(cmd, args, opts),
  sandboxCacheEnv: (dir) => sandbox.cacheEnv(dir),
});
// 확인 필요에는 LLM 호출과 지금 설정만 넘긴다
review.configure({ complete, credentials: () => ({ choice: dictation.getSettings().provider, apiKey: dictation.apiKey() }) });

const { minutesSystem, decodeTo16k, findLoops, buildTranscript, makeMinutes, transcribeMeeting, canResume, makeCleanScript, renameSpeaker, diarizeAvailable, retranscribeRange, applyRetranscribe, speakerTurns } = meeting;
const { addCheckItems, readReview, makeReview, addReview, applyReview, setReviewStatus, chatReview, finalizeReview, revertReview, markReviewItems, reopenReview } = review;

module.exports = {
  minutesSystem,
  decodeTo16k,
  findLoops, nameSpeakers, buildTranscript, makeMinutes, transcribeMeeting, canResume, addCheckItems, makeCleanScript, renameSpeaker, diarizeAvailable, readReview, makeReview, addReview, applyReview, setReviewStatus, chatReview, finalizeReview, retranscribeRange, applyRetranscribe, speakerTurns, revertReview, markReviewItems, reopenReview };
