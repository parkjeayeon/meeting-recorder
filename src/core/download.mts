// 파일을 진행률과 함께 내려받기 — 엔진 설치(src/setup/run.mts download: 모델·uv)와 받아쓰기 모델(src/dictation/server.mts downloadModel)이 같이 쓴다.
// <dest>.part에 쓰고 다 받으면 이름을 바꾼다. 어디서든 실패하면(응답이 OK가 아님·받는 도중 끊김·쓰기 실패) 쓰기 스트림을 닫고
// .part를 지운 뒤 처음 오류를 그대로 던진다. Electron을 가져오지 않고, fetch는 넘겨받는다 (시험은 가짜 fetch로).
import fs from 'node:fs';
import path from 'node:path';

export const PROGRESS_MS = 300; // 진행률은 0.3초에 한 번까지

// 받는 동안 바뀌는 값. 넘기면 그 객체를 그대로 고친다 (받아쓰기 모델은 이것을 engineStatus로 바로 읽는다)
export interface DownloadProgress {
  received: number;
  total: number; // content-length, 모르면 0
}

export interface DownloadOptions {
  fetch?: typeof fetch;
  httpError?: (status: number) => string; // 응답이 OK가 아닐 때 던지는 글
  progress?: DownloadProgress;
  // 0.3초에 한 번까지, 다 받으면 이름을 바꾸기 전에 한 번 더 (그때 total을 알면 received === total)
  onProgress?: (received: number, total: number) => void;
}

export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  const { fetch: fetchImpl = fetch, httpError = (status) => `다운로드 실패 (HTTP ${status})`, progress = { received: 0, total: 0 }, onProgress = () => {} } = opts;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(httpError(res.status));
  progress.total = Number(res.headers.get('content-length')) || 0;
  // 성공한 GET 응답은 몸이 있다. 없으면 예전처럼(for await … of null) TypeError로 끝난다 — .part를 만들기 전에
  if (!res.body) throw new TypeError('res.body is not async iterable');
  const part = `${dest}.part`;
  const out = fs.createWriteStream(part);
  // 쓰기 실패는 'error'로 온다. 받는 곳이 없으면 본체가 죽고, drain을 기다리던 곳은 영영 풀리지 않는다
  const failed = new Promise<never>((_, reject) => out.once('error', reject));
  failed.catch(() => {});
  try {
    let last = 0;
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await Promise.race([failed, new Promise<void>((r) => out.once('drain', () => r()))]); // drain은 인자가 없다
      progress.received += chunk.length;
      if (Date.now() - last > PROGRESS_MS) {
        last = Date.now();
        onProgress(progress.received, progress.total);
      }
    }
    await Promise.race([failed, new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))]);
    onProgress(progress.received, progress.total); // 다 받았다 (마지막 0.3초 안에 온 조각까지)
    fs.renameSync(part, dest);
  } catch (err) {
    out.destroy();
    try {
      fs.rmSync(part, { force: true });
    } catch {} // 지우지 못해도 처음 오류를 던진다
    throw err;
  }
}
