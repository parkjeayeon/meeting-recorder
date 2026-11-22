// 녹취 조각 결과 보관함: 녹음 중에 미리 받아쓴 조각(pretranscribe.mts)을 회의가 끝난 뒤의 녹취(transcribe.mts)가 다시 쓴다 (결정 83).
// 열쇠 = 조각 파일 바이트의 sha256 + 결과를 바꾸는 모든 것(모델 파일·녹취 언어·사전·VAD·형식 번호).
// 바이트가 하나라도 다르거나 설정이 바뀌면 열쇠가 달라 그냥 못 찾는다 → 녹취는 예전처럼 받아쓴다. 그래서 미리 받아쓴 것을 믿을 필요가 없다.
// 값 = 녹취가 조각마다 만드는 것 그대로 ({ segs, redone } — 반복 구간 다시 받아쓰기까지 마친 것).
// 자리 = <회의 폴더>/.pre/<열쇠>.json. 녹취가 성공하면 폴더째 지운다. 파일만 다룬다 (Electron 없음).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../core/write.mjs';
import type { Segment } from './transcript.mjs';

// 받아쓰기·반복 구간 다시 받아쓰기(transcribeSegments·redoLoops·findLoops)의 결과가 같은 바이트에서도 달라지게 바꾸면 올린다
export const CACHE_FORMAT = 1;
export const PRE_DIR = '.pre';
export const preDir = (dir: string): string => path.join(dir, PRE_DIR);

export interface CachedRedone {
  start: number;
  end: number;
  stillLooping: boolean;
  ms: number;
}

export interface CachedPiece {
  segs: Segment[];
  redone: CachedRedone[];
}

// 결과를 바꾸는 것들. 값은 부르는 쪽(transcribe.mts pieceContext)이 녹취와 같은 규칙으로 만든다
export interface PieceContext {
  model: string; // 모델 파일 이름
  modelBytes: number; // 같은 이름으로 다른 모델을 받았을 때 (파일 크기)
  language: string; // 녹취 언어 (meetingAsr)
  vocabulary: string; // Whisper에 넘기는 사전 (prompt). 없으면 ''
  vad: { model: string; threshold: number; padMs: number; minSilenceMs: number } | null;
}

// 칸 순서를 고정한 문자열 (객체 칸 순서에 기대지 않는다)
export function contextString(c: PieceContext): string {
  const vad = c.vad ? [c.vad.model, c.vad.threshold, c.vad.padMs, c.vad.minSilenceMs] : null;
  return JSON.stringify([CACHE_FORMAT, c.model, c.modelBytes, c.language, c.vocabulary, vad]);
}

// 조각 파일 내용 + 결과를 바꾸는 것들 → 열쇠 (16진수 64자)
export function pieceKey(bytes: Uint8Array, c: PieceContext): string {
  const content = crypto.createHash('sha256').update(bytes).digest('hex');
  return crypto.createHash('sha256').update(`${contextString(c)}\n${content}`).digest('hex');
}

const KEY = /^[0-9a-f]{64}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isSeg = (s: unknown): s is Segment => {
  const x = s as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && isNum(x.start) && isNum(x.end) && typeof x.text === 'string';
};
const isRedone = (r: unknown): r is CachedRedone => {
  const x = r as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && isNum(x.start) && isNum(x.end) && typeof x.stillLooping === 'boolean' && isNum(x.ms);
};

// 없거나, 읽을 수 없거나, 모양이 다르면 null (→ 그 조각은 예전처럼 받아쓴다)
export function getPiece(dir: string, key: string): CachedPiece | null {
  if (!KEY.test(key)) return null;
  let v: unknown;
  try {
    v = JSON.parse(fs.readFileSync(path.join(preDir(dir), `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
  const x = v as Record<string, unknown> | null;
  if (typeof x !== 'object' || x === null || !Array.isArray(x.segs) || !Array.isArray(x.redone)) return null;
  if (!x.segs.every(isSeg) || !x.redone.every(isRedone)) return null;
  // 적힌 칸만 꺼낸다 (녹취가 만드는 것과 같은 모양으로)
  return {
    segs: x.segs.map((s) => ({ start: s.start, end: s.end, text: s.text })),
    redone: x.redone.map((r) => ({ start: r.start, end: r.end, stillLooping: r.stillLooping, ms: r.ms })),
  };
}

// 통째로 바꿔 쓴다 (반쯤 쓰인 파일이 남지 않게). .pre 폴더만 만든다 — 회의 폴더가 지워졌으면(녹음 버리기) 다시 만들지 않고 실패한다
export function putPiece(dir: string, key: string, value: CachedPiece): void {
  if (!KEY.test(key)) throw new Error('조각 열쇠가 아닙니다');
  ensurePreDir(dir);
  writeJsonAtomic(path.join(preDir(dir), `${key}.json`), { segs: value.segs, redone: value.redone }, 0);
}

export function ensurePreDir(dir: string): void {
  try {
    fs.mkdirSync(preDir(dir)); // recursive 아님: 회의 폴더가 없으면 ENOENT
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

export function removeCache(dir: string): void {
  fs.rmSync(preDir(dir), { recursive: true, force: true });
}
