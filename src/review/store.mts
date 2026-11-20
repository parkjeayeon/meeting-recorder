// 확인 필요 기록(review.json)과 회의 폴더의 글 파일 읽기·쓰기. Electron을 쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../core/write.mjs';
import type { ReviewItem } from '../core/review.mjs';
import type { Change } from './lines.mjs';

// 고칠 말을 바꾸는 파일 셋. 회의록의 '확인 필요' 섹션은 원래 기록으로 남기고 본문만 고친다
export const CONTENT_FILES = ['transcript.txt', 'script-clean.txt', 'minutes.md'] as const;
export type ContentFile = (typeof CONTENT_FILES)[number];

// 항목 하나가 파일마다 바꾼 줄과 끼워 넣은 줄 (되돌릴 때 쓴다)
export type FileUndo = { changed: Change[]; inserted: string[] };
export type Undo = Partial<Record<ContentFile, FileUndo>>;

export type Segment = { start: number; end: number; text: string; track?: string; [k: string]: unknown };
// 구간 다시 받아쓰기 결과 (본체가 채운다). replaced: 녹취에 반영할 때 갈아 낸 원래 줄·녹취 구간
export type Redo = {
  start: number;
  end: number;
  track?: string;
  lines?: { start: number; label?: string | null; text: string }[];
  appliedAt?: unknown;
  replaced?: { 'transcript.txt'?: string[]; 'script-clean.txt'?: string[]; segments?: Segment[] };
  [k: string]: unknown;
};

export interface Item extends ReviewItem {
  status: 'open' | 'applied' | 'kept' | 'resolved' | (string & {});
  source?: string;
  applied?: string;
  count?: number;
  undo?: Undo | null;
  seq?: number; // 적용한 순번
  redo?: Redo;
  chat?: { user: string; assistant: string }[];
  resolution?: string;
  request?: string;
}

export type Review = {
  items: Item[];
  provider?: string;
  applySeq?: number;
  finalizedAt?: unknown;
  finalize?: { rewritten: boolean; provider: string | null; applied: number; resolved: number; kept: number };
  check?: { at: string; issues: number };
  updatedAt?: unknown;
  [k: string]: unknown;
};

export const readText = (dir: string, f: string): string => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : '');
// 고치기 전 보관본 이름: transcript.txt → transcript.before-review.txt
export const backupName = (f: string): string => f.replace(/\.(\w+)$/, '.before-review.$1');
const reviewFile = (dir: string): string => path.join(dir, 'review.json');

// JSON 파일은 모양을 모르는 채로 읽는다 (없거나 깨졌으면 null)
export function readJsonFile(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function readReview(dir: string): Review | null {
  return readJsonFile(reviewFile(dir)) as Review | null;
}

export function writeReview(dir: string, review: Review): Review {
  if (review.finalizedAt && review.items.some((it) => it.status === 'open')) delete review.finalizedAt; // 다시 연 항목이 있으면 초안으로
  writeJsonAtomic(reviewFile(dir), { ...review, updatedAt: new Date() });
  return review;
}

export function setReviewStatus(dir: string, ids: readonly string[], status: string): Review {
  const review = readReview(dir);
  for (const it of review?.items ?? []) {
    if (!ids.includes(it.id) || it.status === 'applied') continue;
    it.status = status;
    if (status === 'open') delete it.resolution; // 확인됨을 다시 열면 확인한 내용도 지운다
  }
  return writeReview(dir, review as Review);
}

// 항목에 표시를 덧붙인다 (예: 사전에 자동으로 넣은 단어 — 되돌릴 때 사전에서도 뺀다)
export function markReviewItems(dir: string, ids: readonly string[], patch: Record<string, unknown>): void {
  const review = readReview(dir);
  for (const it of review?.items ?? []) if (ids.includes(it.id)) Object.assign(it, patch);
  if (review) writeReview(dir, review);
}
