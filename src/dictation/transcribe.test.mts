// 받아쓰기·회의용 구간 받아쓰기의 언어 규칙과 지어낸 문장 거르기 (src/dictation/transcribe.mts)
// Whisper 서버 대신 127.0.0.1에 띄운 작은 가짜 HTTP 서버가 받은 칸을 적고 정해 둔 JSON을 돌려준다.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SHORT_VOICED_MS } from '../core/language.mjs';
import { createTranscriber, isHallucination, type PortSource, type WhisperResponse } from './transcribe.mjs';

describe('isHallucination', () => {
  it('비었으면 지어낸 것', () => {
    expect(isHallucination('')).toBe(true);
    expect(isHallucination(null)).toBe(true);
    expect(isHallucination(undefined)).toBe(true);
  });
  it('무음에서 자주 지어내는 문장 (끝 문장부호·공백은 빼고 본다)', () => {
    for (const t of ['감사합니다', '감사합니다.', '고맙습니다!', '시청해주셔서 감사합니다', '시청해 주셔서 고맙습니다.', 'MBC 뉴스입니다', '구독과 좋아요 부탁드려요', '한글자막 by', '...', 'Thank you.', 'thanks for watching', '감사합니다. 감사합니다.', '감사합니다 감사합니다!'])
      expect(isHallucination(t), t).toBe(true);
  });
  it('진짜 말은 지나간다', () => {
    for (const t of ['감사합니다 내일 봬요', '회의 시작하겠습니다', 'thank you for coming', '네'])
      expect(isHallucination(t), t).toBe(false);
  });
});

// ── 가짜 Whisper 서버 ──
interface Call {
  language: string;
  response_format: string;
  temperature: string;
  prompt: string | null;
  max_context: string | null;
  file: number; // 받은 음성 바이트 수
}
let calls: Call[];
let reply: (language: string) => WhisperResponse | { status: number };
let srv: http.Server;
let port: number;
let dir: string;
let wav: string;

beforeAll(async () => {
  srv = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
    const f = form.get('file');
    const call: Call = {
      language: String(form.get('language')),
      response_format: String(form.get('response_format')),
      temperature: String(form.get('temperature')),
      prompt: form.has('prompt') ? String(form.get('prompt')) : null,
      max_context: form.has('max_context') ? String(form.get('max_context')) : null,
      file: f instanceof Blob ? f.size : -1,
    };
    calls.push(call);
    const out = reply(call.language);
    if ('status' in out) {
      res.writeHead(out.status).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  port = (srv.address() as AddressInfo).port;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-dictation-transcribe-'));
  wav = path.join(dir, 'a.wav');
  fs.writeFileSync(wav, Buffer.alloc(44 + 320));
});
afterAll(async () => {
  await new Promise((r) => srv.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  calls = [];
  reply = () => ({ text: ' 안녕하세요 ' });
});

// 받아쓰기 서버: 이미 떠 있으면 그 포트, 아니면 띄우기 (몇 번 띄웠는지 센다)
function source(ready: number | null, started: Promise<number> | null = null) {
  let starts = 0;
  const s: PortSource = {
    port: () => ready,
    startServer: () => {
      starts++;
      return started;
    },
  };
  return { s, starts: () => starts };
}

const PROBS_KO = { ko: 0.9, en: 0.05, ja: 0.01, zh: 0.04 };
const PROBS_ZH = { zh: 0.6, ja: 0.3, ko: 0.05, en: 0.05 }; // 후보 밖(중국어)이 가장 높고 후보 중에서는 일본어

describe('transcribe', () => {
  it('언어를 정했으면 한 번, json으로, 앞뒤 공백을 뺀 글', async () => {
    const { s } = source(port);
    const out = await createTranscriber(s).transcribe(wav, { language: 'en', vocabulary: '회의록, Whisper' });
    expect(out).toEqual({ text: '안녕하세요', language: 'en', detected: null });
    expect(calls).toEqual([{ language: 'en', response_format: 'json', temperature: '0', prompt: '회의록, Whisper', max_context: null, file: 364 }]);
  });

  it('용어가 비었으면 prompt를 보내지 않는다, 글이 없으면 빈 글', async () => {
    reply = () => ({});
    const out = await createTranscriber(source(port).s).transcribe(wav, { language: 'ko', vocabulary: '' });
    expect(out.text).toBe('');
    expect(calls[0]?.prompt).toBeNull();
  });

  it('자동 + 말소리가 짧으면 감지하지 않고 첫 후보(ko)로, short 표시', async () => {
    const out = await createTranscriber(source(port).s).transcribe(wav, { language: 'auto' }, { voicedMs: SHORT_VOICED_MS - 1 });
    expect(out).toEqual({ text: '안녕하세요', language: 'ko', detected: null, short: true });
    expect(calls.map((c) => [c.language, c.response_format])).toEqual([['ko', 'json']]);
  });

  it('자동 + 후보 안 언어로 받아썼으면 한 번 (verbose_json)', async () => {
    reply = () => ({ text: '네 좋아요', language_probabilities: PROBS_KO });
    const out = await createTranscriber(source(port).s).transcribe(wav, { language: 'auto' }, { voicedMs: SHORT_VOICED_MS });
    expect(out).toEqual({ text: '네 좋아요', language: 'ko', detected: 'ko' });
    expect(calls.map((c) => [c.language, c.response_format])).toEqual([['auto', 'verbose_json']]);
  });

  it('자동 + 후보 밖 언어면 후보 중 가장 높은 언어로 한 번 더', async () => {
    reply = (lang) => (lang === 'auto' ? { text: '你好', language_probabilities: PROBS_ZH } : { text: ' こんにちは ' });
    const out = await createTranscriber(source(port).s).transcribe(wav, { language: 'auto' });
    expect(out).toEqual({ text: 'こんにちは', language: 'ja', detected: 'zh' });
    expect(calls.map((c) => [c.language, c.response_format])).toEqual([
      ['auto', 'verbose_json'],
      ['ja', 'json'],
    ]);
  });

  it('자동 + 확률이 없으면 다시 받아쓰지 않고 언어는 auto', async () => {
    reply = () => ({ text: 'x' });
    const out = await createTranscriber(source(port).s).transcribe(wav, { language: 'auto' });
    expect(out).toEqual({ text: 'x', language: 'auto', detected: null });
    expect(calls).toHaveLength(1);
  });

  it('포트: 넘긴 것 → 떠 있는 서버 → 띄우기 차례, 없으면 던진다', async () => {
    const a = source(1); // 떠 있는 서버(1번)보다 넘긴 포트가 먼저
    await createTranscriber(a.s).transcribe(wav, { language: 'ko' }, { port });
    expect(a.starts()).toBe(0);

    const b = source(null, Promise.resolve(port));
    await createTranscriber(b.s).transcribe(wav, { language: 'ko' });
    expect(b.starts()).toBe(1);

    const c = source(null, null);
    await expect(createTranscriber(c.s).transcribe(wav, { language: 'ko' })).rejects.toThrow('받아쓰기 엔진이 준비되지 않았습니다');
  });

  it('서버 오류는 HTTP 상태와 함께 던진다', async () => {
    reply = () => ({ status: 500 });
    await expect(createTranscriber(source(port).s).transcribe(wav, { language: 'ko' })).rejects.toThrow('Whisper 오류 (HTTP 500)');
  });
});

describe('transcribeSegments', () => {
  const SEGS = [
    { start: 0, end: 1.5, text: ' 회의 시작합니다 ' },
    { start: 1.5, end: 2, text: '감사합니다.' }, // 지어낸 문장 → 빠짐
    { start: 2, end: 3, text: '   ' }, // 빈 글 → 빠짐
    { text: '시각 없음' }, // 시각이 없으면 0
  ];

  it('언어를 정했으면 한 번 (verbose_json), 구간을 다듬고 거른다', async () => {
    reply = () => ({ segments: SEGS });
    const out = await createTranscriber(source(port).s).transcribeSegments(wav, { language: 'ko', vocabulary: 'v' });
    expect(out).toEqual([
      { start: 0, end: 1.5, text: '회의 시작합니다' },
      { start: 0, end: 0, text: '시각 없음' },
    ]);
    expect(calls).toEqual([{ language: 'ko', response_format: 'verbose_json', temperature: '0', prompt: 'v', max_context: null, file: 364 }]);
  });

  it('noContext면 max_context 0', async () => {
    reply = () => ({});
    expect(await createTranscriber(source(null).s).transcribeSegments(wav, { language: 'ko' }, port, { noContext: true })).toEqual([]);
    expect(calls[0]?.max_context).toBe('0');
  });

  it('자동: 후보 밖이면 후보 중 가장 높은 언어로 다시, 후보 안이면 한 번', async () => {
    reply = (lang) => (lang === 'auto' ? { language_probabilities: PROBS_ZH, segments: [{ start: 0, end: 1, text: '你好' }] } : { segments: [{ start: 0, end: 1, text: 'こんにちは' }] });
    expect(await createTranscriber(source(port).s).transcribeSegments(wav, { language: 'auto' })).toEqual([{ start: 0, end: 1, text: 'こんにちは' }]);
    expect(calls.map((c) => c.language)).toEqual(['auto', 'ja']);

    calls = [];
    reply = () => ({ language_probabilities: PROBS_KO, segments: [{ start: 0, end: 1, text: '네' }] });
    expect(await createTranscriber(source(port).s).transcribeSegments(wav, { language: 'auto' })).toEqual([{ start: 0, end: 1, text: '네' }]);
    expect(calls.map((c) => c.language)).toEqual(['auto']);
  });

  it('포트가 없고 띄우지도 못하면 던진다', async () => {
    await expect(createTranscriber(source(null, null).s).transcribeSegments(wav, { language: 'ko' })).rejects.toThrow('음성 인식 엔진이 준비되지 않았습니다');
  });
});
