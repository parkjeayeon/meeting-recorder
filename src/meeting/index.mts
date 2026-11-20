// 회의 녹음 → 스크립트의 Electron 없는 부분: 소리 변환·조각 내기(audio.mts)와 스크립트 조립(transcript.mts).
// 본체(CommonJS)는 src/minutes.js가 require('../lib/meeting/index.mjs')로 불러 쓴다 (결정 70).
export { PIECE_SEC, trackPath, recordedTracks, decodeTo16k, to16k, downsampleTo16k, splitAtPauses, writeWav, wav16k, sliceTo16k, type TrackMeta, type Piece } from './audio.mjs';
export { SPEAKER, LOOP_MIN_REPEATS, LOOP_MAX_PERIOD, LOOP_MIN_SEC, NEAREST_SPEAKER_SEC, findLoops, assignSpeakers, collapseRepeats, buildTranscript, formatLine, clock, type Segment, type LabeledLine, type TranscriptLine } from './transcript.mjs';
