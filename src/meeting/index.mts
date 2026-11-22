// 회의 녹음 → 녹취 → 회의록 (Electron 없이): 소리 변환·조각 내기(audio.mts), 스크립트 조립(transcript.mts), 화자 구분(diarize.mts),
// 녹취 실행(transcribe.mts), 구간 다시 받아쓰기(retranscribe.mts), 회의록 프롬프트·정리본·상태(minutes.mts), 전체 흐름(pipeline.mts).
// Electron·본체 모듈에서 받는 것은 deps.mts의 configure()로 넘긴다. 본체(CommonJS)는 src/minutes.js가 require('../lib/meeting/index.mjs')로 불러 쓴다 (결정 70).
export { PIECE_SEC, TAIL_SEC, cutTargets, pauseCuts, pieceBytes, wavBytes, wavPcm, trackPath, recordedTracks, decodeTo16k, to16k, downsampleTo16k, splitAtPauses, writeWav, wav16k, sliceTo16k, type TrackMeta, type Piece } from './audio.mjs';
export { SPEAKER, LOOP_MIN_REPEATS, LOOP_MAX_PERIOD, LOOP_MIN_SEC, NEAREST_SPEAKER_SEC, findLoops, assignSpeakers, collapseRepeats, buildTranscript, formatLine, clock, type Segment, type LabeledLine, type TranscriptLine } from './transcript.mjs';
export { configure, type MeetingDeps, type MeetingSettings, type DedicatedServer } from './deps.mjs';
export { DIARIZE_MODEL_DIR, MISSING_MIN_SEC, diarize, diarizeAvailable, hfCacheDir, labelRedoLines, speakerTurns, type Diarization } from './diarize.mjs';
export { MEETING_MODEL, meetingAsr, pieceContext, redoLoops, transcribeMeeting, type MeetingMeta, type Report, type DiarizeInfo, type Redone } from './transcribe.mjs';
export { REDO_PAD_SEC, retranscribeRange, applyRetranscribe } from './retranscribe.mjs';
export { LONG_TIMEOUT_MS, CLEAN_RATIO, MINUTES_BASE_CHARS, MINUTES_PER_CLEAN, MINUTES_MAX_CHARS, SCRIPT_CHUNK_CHARS, minutesTarget, minutesSystem, cleanScript, writeStatus, readStatus, canResume, renameSpeaker, makeCleanScript, type MinutesStatus } from './minutes.mjs';
export { makeMinutes, run, type OnStage } from './pipeline.mjs';
export { CACHE_FORMAT, PRE_DIR, contextString, pieceKey, getPiece, putPiece, removeCache, type PieceContext, type CachedPiece } from './piece-cache.mjs';
export { POKE_MS, createPretranscriber, snapshotWav, type Pretranscriber, type PretranscriberOptions, type PreRun } from './pretranscribe.mjs';
