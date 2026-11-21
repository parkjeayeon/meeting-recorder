// macOS: 소리 변환은 기본 변환기 afconvert, 길이·표본율은 afinfo (결정 78).
// src/meeting/audio.mts(16kHz로 풀기)·import-audio.mts(가져오기)·compress.mts(압축)에 있던 명령과 인자를 글자 그대로 옮겼다.
// 실행(샌드박스·시간 제한·오류 문장)과 afconvert가 쓰는 확장 WAV 머리 고쳐 쓰기는 부르는 쪽에 남는다.
import type { AudioTools } from '../types.mjs';

const AFCONVERT = '/usr/bin/afconvert';
const AFINFO = '/usr/bin/afinfo';

export const audio: AudioTools = {
  convert(src, dst, to) {
    if (to.format === 'wav') return [AFCONVERT, ['-f', 'WAVE', '-d', `LEI16@${to.rate}`, '-c', String(to.channels), src, dst]];
    return [AFCONVERT, ['-f', 'm4af', '-d', to.codec, '-b', String(to.bitrate), src, dst]];
  },
  info(file) {
    return [AFINFO, [file]];
  },
};
