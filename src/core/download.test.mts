// 진행률과 함께 내려받기 (src/core/download.mts) — 가짜 fetch와 임시 폴더로 (네트워크는 쓰지 않는다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download.mjs';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-core-download-'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.chmodSync(root, 0o755);
  for (const f of fs.readdirSync(root)) fs.chmodSync(path.join(root, f), 0o755);
  fs.rmSync(root, { recursive: true, force: true });
});

// 조각들을 차례로 내주는 몸. fail을 주면 그 조각들을 다 읽은 뒤 그 오류로 끊긴다
const body = (chunks: Uint8Array[], fail?: Error) => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      const ch = chunks[i++];
      if (ch) c.enqueue(ch);
      else if (fail) c.error(fail);
      else c.close();
    },
  });
};
const fakeFetch = (res: () => Response): typeof fetch => (async () => res()) as typeof fetch;
const openFds = () => fs.readdirSync('/dev/fd').length;
const settle = () => new Promise((r) => setTimeout(r, 50)); // 닫기는 비동기라 잠깐 기다린다

describe.runIf(process.platform !== 'win32')('downloadFile', () => {
  it('다 받으면 .part에서 이름을 바꾸고, 이름을 바꾸기 전에 진행률을 한 번 더 (received === total)', async () => {
    const dest = path.join(root, 'sub', 'model.bin'); // 폴더가 없으면 만든다
    const seen: [number, number, boolean][] = [];
    const data = [new Uint8Array(10).fill(1), new Uint8Array(5).fill(2)];
    await downloadFile('http://x/model.bin', dest, {
      fetch: fakeFetch(() => new Response(body(data), { headers: { 'content-length': '15' } })),
      onProgress: (got, total) => seen.push([got, total, fs.existsSync(dest)]),
    });
    expect(fs.readFileSync(dest)).toEqual(Buffer.concat(data));
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(seen[0]).toEqual([10, 15, false]); // 첫 조각은 바로 (0.3초 거르기의 처음)
    expect(seen.at(-1)).toEqual([15, 15, false]); // 마지막은 다 받은 값, 아직 이름을 바꾸기 전
    expect(seen).toHaveLength(2); // 두 번째 조각은 0.3초 안이라 거른다
  });

  it('progress 객체를 넘기면 그 객체를 받는 동안 고친다, 길이를 모르면 total 0', async () => {
    const progress = { received: 0, total: 99 };
    await downloadFile('http://x', path.join(root, 'a'), { fetch: fakeFetch(() => new Response(body([new Uint8Array(4)]))), progress });
    expect(progress).toEqual({ received: 4, total: 0 });
  });

  it('응답이 OK가 아니면 넘긴 글로 던지고 .part를 만들지 않는다', async () => {
    const dest = path.join(root, 'm.bin');
    await expect(downloadFile('http://x', dest, { fetch: fakeFetch(() => new Response('no', { status: 404 })) })).rejects.toThrow('다운로드 실패 (HTTP 404)');
    await expect(downloadFile('http://x', dest, { fetch: fakeFetch(() => new Response('no', { status: 503 })), httpError: (s) => `모델 다운로드 실패 (HTTP ${s})` })).rejects.toThrow('모델 다운로드 실패 (HTTP 503)');
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('받는 도중 끊기면 쓰기 스트림을 닫고 .part를 지운 뒤 그 오류를 그대로 던진다', async () => {
    const dest = path.join(root, 'm.bin');
    const cut = new Error('연결이 끊김');
    const before = openFds();
    const seen: number[] = [];
    const p = downloadFile('http://x', dest, { fetch: fakeFetch(() => new Response(body([new Uint8Array(8)], cut), { headers: { 'content-length': '100' } })), onProgress: (got) => seen.push(got) });
    await expect(p).rejects.toBe(cut);
    expect(fs.readdirSync(root)).toEqual([]); // .part도 dest도 없다
    expect(seen).toEqual([8]); // 다 받았다는 마지막 알림은 없다
    await settle();
    expect(openFds()).toBe(before); // 파일 핸들이 남지 않는다
  });

  it('쓰기가 실패하면(쓸 수 없는 폴더) 멈추지 않고 그 오류로 던진다, .part는 남지 않는다', async () => {
    const dir = path.join(root, 'ro');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o555);
    const dest = path.join(dir, 'm.bin');
    const before = openFds();
    // 큰 조각 여럿: write가 false를 돌려 drain을 기다리는 길도 지난다
    const chunks = Array.from({ length: 4 }, () => new Uint8Array(64 * 1024));
    const err = await downloadFile('http://x', dest, { fetch: fakeFetch(() => new Response(body(chunks))) }).catch((e: NodeJS.ErrnoException) => e);
    expect((err as NodeJS.ErrnoException).code).toBe('EACCES');
    expect(fs.readdirSync(dir)).toEqual([]);
    await settle();
    expect(openFds()).toBe(before);
  });

  it('몸이 없는 응답은 예전처럼 TypeError, .part를 만들지 않는다', async () => {
    await expect(downloadFile('http://x', path.join(root, 'm'), { fetch: fakeFetch(() => new Response(null)) })).rejects.toThrow(TypeError);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
