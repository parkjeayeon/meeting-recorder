// 같은 Whisper 서버를 받아쓰기와 나눠 쓰므로 회의록은 한 번에 하나씩 만든다.
// 회의록 만들기(pipeline.mts makeMinutes)·구간 다시 받아쓰기(retranscribe.mts)·정리본 따로 만들기(minutes.mts makeCleanScript)가 이 줄 하나에 선다.
// 앞 일이 실패해도 줄은 이어진다
let queue: Promise<unknown> = Promise.resolve();

export function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const job = queue.then(work);
  queue = job.catch(() => {});
  return job;
}
