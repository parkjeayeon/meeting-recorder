// 회의 처리에서 동시에 돌릴 개수: 녹취 조각을 나눠 받을 Whisper 서버 수, 정리본 조각을 동시에 정리할 수.
// 순수 함수만 둔다 — 메모리 크기·환경 변수는 부르는 쪽이 읽어 넘긴다 (vad.mts와 같은 방식).

// 환경 변수의 정수 값. 비었거나, 정수가 아니거나, [min, max] 밖이면 null (→ 기본 규칙)
export function envCount(env: Readonly<Record<string, string | undefined>>, name: string, min: number, max: number): number | null {
  const v = env[name];
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// large-v3 서버 하나가 약 3GB를 잡고 화자 구분 모델도 함께 돈다 → 둘째 서버는 24GB 이상인 Mac에서만 (결정 82)
export const MEETING_SERVERS_MIN_MEM = 24 * 1024 ** 3;
export const MEETING_SERVERS_MAX = 4;

// 회의 녹취에 띄울 회의용 Whisper 서버 수. 조각이 하나면 언제나 1 (둘째 모델을 불러오지 않는다).
// MR_MEETING_SERVERS=<1..4> = 재 보기 위한 개발자용 스위치 (조각 수보다 많이는 띄우지 않는다)
export function meetingServers({ totalMemBytes, pieces, env }: { totalMemBytes: number; pieces: number; env: Readonly<Record<string, string | undefined>> }): number {
  if (pieces <= 1) return 1;
  const forced = envCount(env, 'MR_MEETING_SERVERS', 1, MEETING_SERVERS_MAX);
  const n = forced ?? (totalMemBytes >= MEETING_SERVERS_MIN_MEM ? 2 : 1);
  return Math.min(n, pieces);
}
