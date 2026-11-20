// 회의 녹음 압축 (WAV → AAC 96kbps). 구현은 src/meeting/compress.mts (TypeScript, 결정 70).
// 본체(main.js)와 scripts/dev/compress-check.js가 이 경로로 불러 쓴다.
const { compressMeeting, declineCompress, audioInfo, BITRATE } = require('../lib/meeting/compress.mjs');

module.exports = { compressMeeting, declineCompress, audioInfo, BITRATE };
