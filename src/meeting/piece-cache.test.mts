// 조각 결과 보관함 (결정 83) — 임시 폴더에만 쓴다
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpDir } from '../test/meeting.mjs';
import { CACHE_FORMAT, contextString, getPiece, pieceKey, preDir, putPiece, removeCache, type CachedPiece, type PieceContext } from './piece-cache.mjs';

const BASE: PieceContext = { model: 'ggml-large-v3.bin', modelBytes: 3_000_000_000, language: 'ko', vocabulary: 'PJY, Whisper', vad: null };
const VAD = { model: '/models/ggml-silero.bin', threshold: 0.3, padMs: 200, minSilenceMs: 500 };
const BYTES = Buffer.from('RIFF....WAVEfmt 조각 바이트');
const VALUE: CachedPiece = {
  segs: [
    { start: 0.1, end: 2.345678901234, text: '첫 줄' },
    { start: 3, end: 4.5, text: '둘째 줄' },
  ],
  redone: [{ start: 10, end: 30, stillLooping: false, ms: 812 }],
};

let dir = '';
beforeEach(() => {
  dir = tmpDir('mr-piece-cache-');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('pieceKey', () => {
  it('같은 바이트·같은 설정이면 같은 열쇠, 바이트나 결과를 바꾸는 것이 하나라도 다르면 다른 열쇠', () => {
    const key = pieceKey(BYTES, BASE);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(pieceKey(Buffer.from(BYTES), { ...BASE })).toBe(key);
    const changed = [
      pieceKey(Buffer.concat([BYTES, Buffer.from([0])]), BASE), // 바이트
      pieceKey(Buffer.from(BYTES).fill(1, 3, 4), BASE),
      pieceKey(BYTES, { ...BASE, model: 'ggml-large-v3-turbo-q8_0.bin' }), // 모델
      pieceKey(BYTES, { ...BASE, modelBytes: 1 }),
      pieceKey(BYTES, { ...BASE, language: 'en' }), // 녹취 언어
      pieceKey(BYTES, { ...BASE, vocabulary: '' }), // 사전
      pieceKey(BYTES, { ...BASE, vocabulary: 'PJY,Whisper' }),
      pieceKey(BYTES, { ...BASE, vad: VAD }), // VAD
      pieceKey(BYTES, { ...BASE, vad: { ...VAD, threshold: 0.5 } }),
      pieceKey(BYTES, { ...BASE, vad: { ...VAD, model: '/other.bin' } }),
    ];
    expect(new Set([key, ...changed]).size).toBe(changed.length + 1);
  });

  it('설정 문자열은 칸 순서를 고정하고 형식 번호를 넣는다', () => {
    const reordered: PieceContext = { vad: null, vocabulary: BASE.vocabulary, language: 'ko', modelBytes: BASE.modelBytes, model: BASE.model };
    expect(contextString(reordered)).toBe(contextString(BASE));
    expect(JSON.parse(contextString(BASE))[0]).toBe(CACHE_FORMAT);
  });
});

describe('getPiece · putPiece · removeCache', () => {
  it('쓰고 읽으면 같은 값 (숫자도 그대로), .pre/<열쇠>.json 하나만 남는다', () => {
    const key = pieceKey(BYTES, BASE);
    expect(getPiece(dir, key)).toBe(null);
    putPiece(dir, key, VALUE);
    expect(getPiece(dir, key)).toEqual(VALUE);
    expect(fs.readdirSync(preDir(dir))).toEqual([`${key}.json`]);
    expect(getPiece(dir, pieceKey(BYTES, { ...BASE, language: 'en' }))).toBe(null);
  });

  it('깨진 파일·모양이 다른 파일·열쇠가 아닌 이름은 null', () => {
    const key = pieceKey(BYTES, BASE);
    fs.mkdirSync(preDir(dir));
    const file = path.join(preDir(dir), `${key}.json`);
    const bad: string[] = [
      '{"segs": [',
      '',
      'null',
      '[]',
      '{"segs": []}',
      '{"segs": {}, "redone": []}',
      '{"segs": [{"start": 0, "end": 1}], "redone": []}',
      '{"segs": [{"start": "0", "end": 1, "text": "x"}], "redone": []}',
      '{"segs": [null], "redone": []}',
      '{"segs": [], "redone": [{"start": 0, "end": 1, "stillLooping": "no", "ms": 1}]}',
      '{"segs": [], "redone": [{"start": 0, "end": 1, "stillLooping": false}]}',
    ];
    for (const text of bad) {
      fs.writeFileSync(file, text);
      expect(getPiece(dir, key), text).toBe(null);
    }
    fs.writeFileSync(file, '{"segs": [], "redone": []}');
    expect(getPiece(dir, key)).toEqual({ segs: [], redone: [] });
    expect(getPiece(dir, '../meta')).toBe(null);
    expect(() => putPiece(dir, '../meta', VALUE)).toThrow();
  });

  it('덧붙은 칸은 버리고 녹취가 만드는 모양으로 돌려준다', () => {
    const key = pieceKey(BYTES, BASE);
    fs.mkdirSync(preDir(dir));
    fs.writeFileSync(path.join(preDir(dir), `${key}.json`), JSON.stringify({ segs: [{ start: 0, end: 1, text: 'x', extra: 1 }], redone: [], more: true }));
    expect(getPiece(dir, key)).toEqual({ segs: [{ start: 0, end: 1, text: 'x' }], redone: [] });
  });

  it('removeCache는 .pre를 폴더째 지운다 (없어도 된다)', () => {
    putPiece(dir, pieceKey(BYTES, BASE), VALUE);
    fs.mkdirSync(path.join(preDir(dir), 'work'));
    fs.writeFileSync(path.join(preDir(dir), 'work', 'x.wav'), 'x');
    removeCache(dir);
    expect(fs.existsSync(preDir(dir))).toBe(false);
    expect(() => removeCache(dir)).not.toThrow();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('회의 폴더가 지워졌으면(녹음 버리기) 다시 만들지 않고 실패한다', () => {
    const gone = path.join(dir, 'discarded');
    expect(() => putPiece(gone, pieceKey(BYTES, BASE), VALUE)).toThrow();
    expect(fs.existsSync(gone)).toBe(false);
  });
});
