// 본체 진입점(src/main.js)이 require로 불러 start()에 넘기는 CommonJS 연결 파일의 모양 (결정 70).
// 연결 파일은 scripts/dev 시험이 require·require.cache로 바꿔 끼우므로 진입점에 남고, 여기는 타입만 — 각 구현의 타입에서 뽑는다.
import type * as meeting from '../meeting/index.mjs';
import type * as review from '../review/index.mjs';
import type * as core from '../core/index.mjs';
import type * as llm from '../llm/index.mjs';
import type * as compressMod from '../meeting/compress.mjs';

export type { Dictation } from '../dictation/index.mjs';
export type { Setup } from '../setup/index.mjs';
export type { AskEngine } from '../ask/index.mjs';

// src/minutes.js가 내보내는 것 (src/meeting·src/review의 이름 그대로)
export type MinutesModule = Pick<
  typeof meeting,
  | 'minutesSystem'
  | 'decodeTo16k'
  | 'findLoops'
  | 'buildTranscript'
  | 'makeMinutes'
  | 'transcribeMeeting'
  | 'canResume'
  | 'makeCleanScript'
  | 'renameSpeaker'
  | 'diarizeAvailable'
  | 'retranscribeRange'
  | 'applyRetranscribe'
  | 'speakerTurns'
  | 'createPretranscriber'
> &
  Pick<
    typeof review,
    'addCheckItems' | 'readReview' | 'makeReview' | 'addReview' | 'applyReview' | 'setReviewStatus' | 'chatReview' | 'finalizeReview' | 'revertReview' | 'markReviewItems' | 'reopenReview'
  > & { nameSpeakers: typeof core.nameSpeakers };

// src/usage.js
export type UsageModule = Pick<typeof llm, 'usage' | 'fromClaudeText' | 'usedForRouting' | 'markExhausted'>;

// src/compress.js
export type CompressModule = Pick<typeof compressMod, 'compressMeeting' | 'declineCompress' | 'audioInfo' | 'BITRATE'>;
