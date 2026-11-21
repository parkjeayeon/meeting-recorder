// ── 회의 녹음 재생용 rec:// ──────────────────────────────────────────────
// src/main.js에서 옮김 (결정 70). rec://m/<회의 폴더 이름>/<파일>. 2시간 WAV(수백 MB)도 원하는 곳부터 재생되게 Range 요청을 받는다.
// 녹음 폴더 바로 아래 회의 폴더의 .wav·.m4a만 내준다. 본체가 앱이 준비되기 전에 scheme을 등록하고(registerSchemesAsPrivileged),
// init()에서 protocol.handle('rec', serveRecording)으로 잇는다.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const REC_SCHEME = { scheme: 'rec', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } };

// 쓰는 것만 (Electron protocol.handle이 넘기는 Request)
export interface RecRequest {
  url: string;
  headers: { get(name: string): string | null };
}

export function createServeRecording(recordingsDir: () => string): (request: RecRequest) => Response {
  return function serveRecording(request: RecRequest): Response {
    const RECORDINGS_DIR = recordingsDir();
    const [, folder = '', name = ''] = new URL(request.url).pathname.split('/');
    const file = path.resolve(RECORDINGS_DIR, decodeURIComponent(folder), decodeURIComponent(name));
    if (path.dirname(path.dirname(file)) !== RECORDINGS_DIR || !/\.(wav|m4a)$/i.test(file) || !fs.existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    const size = fs.statSync(file).size;
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
    const start = range?.[1] ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    const headers: Record<string, string> = { 'Content-Type': /\.m4a$/i.test(file) ? 'audio/mp4' : 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    // node:stream/web의 ReadableStream과 전역 Response가 받는 ReadableStream은 같은 것인데 @types/node에서 타입만 갈린다
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as globalThis.ReadableStream<Uint8Array<ArrayBuffer>>, { status: range ? 206 : 200, headers });
  };
}
