// 회의 녹음 재생 rec:// (protocol.mts) — 임시 녹음 폴더의 지어낸 파일로
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { tmpDir } from '../test/ipc.mjs';
import { createServeRecording } from './protocol.mjs';

let root: string;
let serve: ReturnType<typeof createServeRecording>;
const BYTES = Buffer.from(Array.from({ length: 100 }, (_, i) => i));

const req = (url: string, range?: string) => ({ url, headers: new Headers(range ? { range } : {}) });
const body = async (res: Response) => Buffer.from(await res.arrayBuffer());

beforeEach(() => {
  root = tmpDir('mr-rec-proto-');
  const m = path.join(root, '2026-01-01_09-00-00_meeting');
  fs.mkdirSync(m);
  fs.writeFileSync(path.join(m, 'mic.wav'), BYTES);
  fs.writeFileSync(path.join(m, 'system.m4a'), BYTES.subarray(0, 10));
  fs.writeFileSync(path.join(m, 'meta.json'), '{}');
  fs.writeFileSync(path.join(root, 'top.wav'), BYTES);
  serve = createServeRecording(() => root);
});

describe('rec:// 재생', () => {
  it('전체: 200, 길이·형식·Accept-Ranges', async () => {
    const res = serve(req('rec://m/2026-01-01_09-00-00_meeting/mic.wav'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('100');
    expect(res.headers.get('content-range')).toBe(null);
    expect(await body(res)).toEqual(BYTES);
  });

  it('Range: 206과 Content-Range, 끝은 파일 크기로 자른다, 끝이 없으면 파일 끝까지', async () => {
    let res = serve(req('rec://m/2026-01-01_09-00-00_meeting/mic.wav', 'bytes=10-19'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(res.headers.get('content-length')).toBe('10');
    expect(await body(res)).toEqual(BYTES.subarray(10, 20));
    res = serve(req('rec://m/2026-01-01_09-00-00_meeting/mic.wav', 'bytes=90-500'));
    expect(res.headers.get('content-range')).toBe('bytes 90-99/100');
    expect(await body(res)).toEqual(BYTES.subarray(90));
    res = serve(req('rec://m/2026-01-01_09-00-00_meeting/mic.wav', 'bytes=95-'));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 95-99/100');
    expect(await body(res)).toEqual(BYTES.subarray(95));
  });

  it('m4a는 audio/mp4, 이름의 %인코딩을 푼다', async () => {
    const m = path.join(root, '2026-01-02_10-00-00 회의');
    fs.mkdirSync(m);
    fs.writeFileSync(path.join(m, 'mic.M4A'), BYTES.subarray(0, 3));
    const res = serve(req(`rec://m/${encodeURIComponent('2026-01-02_10-00-00 회의')}/mic.M4A`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mp4');
    expect(await body(res)).toEqual(BYTES.subarray(0, 3));
  });

  it('녹음 폴더 밖·깊이가 다른 곳·다른 확장자·없는 파일은 404', async () => {
    const outside = path.join(path.dirname(root), 'secret.wav');
    fs.writeFileSync(outside, BYTES);
    const bad = [
      'rec://m/..%2F..%2Fsecret.wav/x', // 밖으로
      `rec://m/..%2F${encodeURIComponent(path.basename(path.dirname(root)))}/secret.wav`,
      'rec://m/top.wav', // 녹음 폴더 바로 아래 (회의 폴더 안이 아님)
      'rec://m/2026-01-01_09-00-00_meeting/meta.json', // 소리 파일이 아님
      'rec://m/2026-01-01_09-00-00_meeting/none.wav', // 없음
      'rec://m/2026-01-01_09-00-00_meeting', // 파일 이름 없음
    ];
    for (const url of bad) {
      const res = serve(req(url));
      expect(res.status, url).toBe(404);
      expect(await res.text()).toBe('not found');
    }
    fs.rmSync(outside);
  });

  it('녹음 폴더를 바꾸면 새 폴더를 본다', () => {
    let dir = root;
    const s = createServeRecording(() => dir);
    expect(s(req('rec://m/2026-01-01_09-00-00_meeting/mic.wav')).status).toBe(200);
    dir = tmpDir('mr-rec-proto-other-');
    expect(s(req('rec://m/2026-01-01_09-00-00_meeting/mic.wav')).status).toBe(404);
  });
});
