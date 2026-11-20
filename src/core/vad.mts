// 회의 녹취용 Whisper 서버의 VAD(말소리 구간만 받아쓰기) 설정을 환경 변수에서 읽는다 — 재 보기 위한 개발자용 스위치, 기본은 끈다.
// MR_MEETING_VAD = Silero VAD ggml 모델 파일의 절대 경로. 없거나 파일이 없으면 끈다(지금과 같다).
// 나머지 값은 숫자가 아니면 기본값으로
export interface MeetingVad {
  readonly model: string;
  readonly threshold: number;
  readonly padMs: number;
  readonly minSilenceMs: number;
}

export const VAD_THRESHOLD = 0.3;
export const VAD_PAD_MS = 200;
export const VAD_MIN_SILENCE_MS = 500;

const num = (v: string | undefined, fallback: number): number => {
  if (v == null || v.trim() === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function meetingVad(env: Readonly<Record<string, string | undefined>>, exists: (file: string) => boolean): MeetingVad | null {
  const model = env.MR_MEETING_VAD;
  if (!model || !exists(model)) return null;
  return {
    model,
    threshold: num(env.MR_MEETING_VAD_THRESHOLD, VAD_THRESHOLD),
    padMs: num(env.MR_MEETING_VAD_PAD_MS, VAD_PAD_MS),
    minSilenceMs: num(env.MR_MEETING_VAD_MIN_SILENCE_MS, VAD_MIN_SILENCE_MS),
  };
}
