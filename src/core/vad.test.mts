import { describe, expect, it } from 'vitest';
import { meetingVad } from './vad.mjs';

const model = '/models/ggml-silero.bin';
const yes = () => true;

describe('meetingVad', () => {
  it('변수가 없으면 끈다', () => {
    expect(meetingVad({}, yes)).toBeNull();
    expect(meetingVad({ MR_MEETING_VAD: '' }, yes)).toBeNull();
  });

  it('모델 파일이 없으면 끈다', () => {
    expect(meetingVad({ MR_MEETING_VAD: model }, () => false)).toBeNull();
  });

  it('모델만 주면 기본값', () => {
    expect(meetingVad({ MR_MEETING_VAD: model }, yes)).toEqual({ model, threshold: 0.3, padMs: 200, minSilenceMs: 500 });
  });

  it('값을 바꿀 수 있다', () => {
    const env = { MR_MEETING_VAD: model, MR_MEETING_VAD_THRESHOLD: '0.5', MR_MEETING_VAD_PAD_MS: '100', MR_MEETING_VAD_MIN_SILENCE_MS: '800' };
    expect(meetingVad(env, yes)).toEqual({ model, threshold: 0.5, padMs: 100, minSilenceMs: 800 });
  });

  it('숫자가 아닌 값은 무시하고 기본값으로', () => {
    const env = { MR_MEETING_VAD: model, MR_MEETING_VAD_THRESHOLD: 'abc', MR_MEETING_VAD_PAD_MS: 'Infinity', MR_MEETING_VAD_MIN_SILENCE_MS: ' ' };
    expect(meetingVad(env, yes)).toEqual({ model, threshold: 0.3, padMs: 200, minSilenceMs: 500 });
  });
});
