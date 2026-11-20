// 확인 필요 항목의 적용과 되돌리기. 녹취·정리본·회의록 본문에서 같은 글자를 모두 바꾸고, 항목마다 바꾼 줄을 기억해 그 항목만 되돌린다.
// 지켜야 할 성질: 어떤 순서로 적용하고 되돌려도 전부 되돌리면 세 파일이 처음과 같다 (scripts/dev/formal/review-undo.js가 실제 이 코드로 확인).
import fs from 'node:fs';
import path from 'node:path';
import { copyFileAtomic, writeFileAtomic, writeJsonAtomic } from '../core/write.mjs';
import { noteVariants, stampFor } from '../core/review.mjs';
import { clock } from '../core/script.mjs';
import { changedLines, parseClock, spliceLines, stampOf } from './lines.mjs';
import { CONTENT_FILES, backupName, readJsonFile, readReview, readText, writeReview, type ContentFile, type Item, type Redo, type Review, type Undo } from './store.mjs';

// 화면이 보내는 처리 하나: 그대로 두기(keep) · 확인됨(resolve) · 고칠 말(heard → guess)
export type Fix = { id: string; keep?: boolean; resolve?: string; heard?: string | null; guess?: string | null };
export type Skipped = { id: string; reason: 'same' | 'notfound'; heard: string };

// 되돌리기 기능 전에 고친 단어 항목: 처음 고치기 전에 보관한 파일(*.before-review.*)과 지금 파일을 맞대어 이 항목이 바꾼 줄을 다시 찾는다.
// 보관본에서 들은 말이 있던 줄만 본다 — 녹취·정리본은 같은 시각 줄, 회의록은 들은 말을 고친 말로 바꾼 줄이 지금 그대로 있는 줄.
// 원래부터 고친 말이 있던 줄은 건드리지 않는다.
function legacyUndo(dir: string, item: { heard?: string | null; applied?: string }): Undo | null {
  const { heard, applied } = item;
  if (!heard || !applied) return null;
  const undo: Undo = {};
  let found = 0;
  for (const f of CONTENT_FILES) {
    const backup = path.join(dir, backupName(f));
    if (!fs.existsSync(backup) || !fs.existsSync(path.join(dir, f))) continue;
    const all = fs.readFileSync(backup, 'utf8').split('\n');
    const cur = readText(dir, f).split('\n');
    // 시각이 없는 줄(회의록)은 같은 자리의 줄로 맞춘다: 고칠 말 적용은 줄 수를 바꾸지 않아서, 보관본과 지금 파일의 줄 수가 같으면 자리가 같다.
    // 같은 줄을 다른 항목도 고쳤으면 글자째 비교로는 못 찾는다 ("랩캐시도 … 넥스트" → "Memcached … Next.js")
    const aligned = all.length === cur.length;
    const changed: { from: string; to: string }[] = [];
    all.forEach((o, i) => {
      if (!o.includes(heard) || o.includes(applied)) return;
      const at = stampOf(o);
      const fixed = o.split(heard).join(applied);
      let to: string | null = null;
      if (at) to = cur.find((l) => l.startsWith(at) && l.includes(applied) && !changed.some((c) => c.to === l)) ?? null;
      else if (aligned) to = cur[i]?.includes(applied) ? (cur[i] as string) : null;
      else to = cur.includes(fixed) ? fixed : null;
      if (to) changed.push({ from: to.split(applied).join(heard), to });
    });
    found += changed.length;
    undo[f] = { changed, inserted: [] };
  }
  return found ? undo : null;
}

// 다시 받아쓴 구간을 원래 줄·녹취 구간으로 돌린다 (반영이 끝났든 도중에 끊겼든, 같은 구간을 다시 바꿔도 결과가 같다)
// 2026-11-20 전에 반영한 항목은 앞 여유분에서 시작한 새 줄(10~15초 구간에 9.7초)이 구간 밖에 들어가 있을 수 있다 — 지금은 반영할 때 구간 시작으로 당긴다
// (src/meeting/retranscribe.mts clampToRange). 그런 줄은 구간으로 지워지지 않으므로, 기록해 둔 새 줄(redo.lines)과 똑같은 줄·녹취 구간을 하나씩 뺀다.
// 하나씩만: 원래 녹취에 같은 시각·같은 말 줄이 따로 있었으면 그 줄은 남아야 한다
const lineText = (l: { start: number; label?: string | null; text: string }) => `[${clock(l.start)}]${l.label ? ` [${l.label}]` : ''} ${l.text}`; // src/meeting formatLine과 같게
function dropOnce<T>(list: T[], same: (x: T) => boolean): T[] {
  const i = list.findIndex(same);
  return i === -1 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

// 다시 받아쓴 구간을 원래 줄·녹취 구간으로 돌린다 (반영이 끝났든 도중에 끊겼든, 같은 구간을 다시 바꿔도 결과가 같다)
export function restoreRedoRange(dir: string, r: Redo): void {
  const replaced = r.replaced ?? {};
  const early = (r.lines ?? []).filter((l) => l.start < r.start);
  for (const f of ['transcript.txt', 'script-clean.txt'] as const) {
    const p = path.join(dir, f);
    const lines = replaced[f];
    if (!fs.existsSync(p) || !lines) continue;
    let text = readText(dir, f);
    for (const l of early.filter((x) => Math.floor(x.start) < Math.floor(r.start))) {
      const kept = dropOnce(text.split('\n'), (x) => x === lineText(l));
      text = kept.join('\n');
    }
    writeFileAtomic(p, spliceLines(text, r.start, r.end, lines));
  }
  const segFile = path.join(dir, 'segments.json');
  const seg = readJsonFile(segFile);
  if (seg?.segments && replaced.segments) {
    type S = { track?: string; start: number; text?: string };
    let rest: S[] = seg.segments.filter((x: S) => x.track !== r.track || x.start < r.start || x.start >= r.end);
    for (const l of early) rest = dropOnce(rest, (x) => x.track === r.track && x.start === l.start && x.text === l.text);
    seg.segments = [...rest, ...replaced.segments].sort((a, b) => a.start - b.start);
    writeJsonAtomic(segFile, seg, 0);
  }
}

// 확인 마치기 전에 처리한 항목을 되돌린다: 바뀐 줄만 원래대로 (다른 항목이 고친 줄은 건드리지 않는다)
export function revertReview(dir: string, id: string, { cascade = true }: { cascade?: boolean } = {}): Review & { reapplied?: string[]; reopened?: string[] } {
  const review = readReview(dir);
  const item = review?.items.find((it) => it.id === id);
  if (!review || !item) throw new Error('확인 항목이 없습니다');
  if (review.finalizedAt) throw new Error('확인을 마친 뒤에는 되돌릴 수 없습니다 (회의록이 이미 다시 쓰였습니다)');
  // 이 항목이 바꾼 줄을 나중에 다른 항목이 또 고쳤으면: 그 항목들을 먼저 되돌리고 → 이 항목을 되돌리고 → 그 항목들을 다시 적용한다.
  // 결과는 "이 항목만 적용한 적 없는 것처럼". 예전에는 줄을 못 찾아 그냥 넘어가거나(이어지는 항목, F1) 그 줄의 고친 말을
  // 전부 되돌려 원래 있던 같은 말까지 바꿨다(F2). 다시 적용할 때 들린 말이 이제 없으면 그 항목은 다시 확인 전으로 연다
  if (cascade && item.status === 'applied' && item.undo && !item.redo?.appliedAt) {
    const later = laterOnSameLines(review, item);
    if (later.length) {
      const redo: Fix[] = later.map((it) => ({ id: it.id, heard: it.heard, guess: it.applied }));
      for (const it of later) revertReview(dir, it.id, { cascade: false });
      revertReview(dir, id, { cascade: false });
      const reapplied: string[] = [];
      const reopened: string[] = [];
      for (const fix of redo.reverse()) {
        const after = applyReview(dir, [fix]);
        (after.items.find((it) => it.id === fix.id)?.status === 'applied' ? reapplied : reopened).push(fix.id);
      }
      return { ...(readReview(dir) as Review), reapplied, reopened };
    }
  }
  if (item.status === 'kept') {
    item.status = 'open';
    return writeReview(dir, review);
  }
  if (item.status !== 'applied') return review;
  if (item.redo?.appliedAt) {
    const r = item.redo;
    if (!r.replaced) throw new Error('이 항목은 되돌릴 기록이 없습니다 (되돌리기 기능 전에 반영함)');
    restoreRedoRange(dir, r);
    delete r.appliedAt;
    delete r.replaced;
    item.chat = (item.chat ?? []).filter((c) => !/구간을 다시 받아써 녹취에 반영함/.test(c.user));
  } else {
    if (!item.undo) item.undo = legacyUndo(dir, item);
    if (!item.undo) throw new Error('이 항목은 되돌릴 기록이 없습니다 (되돌리기 기능 전에 고쳤고, 고치기 전 보관본에서도 찾지 못함)');
    const applied = item.applied as string;
    const heard = item.heard as string;
    for (const [f, u] of Object.entries(item.undo)) {
      const p = path.join(dir, f);
      if (!fs.existsSync(p)) continue;
      let lines = readText(dir, f).split('\n');
      for (const c of u.changed) {
        const i = lines.indexOf(c.to);
        if (i !== -1) lines[i] = c.from;
        else {
          // 그 줄을 다른 항목이 또 고쳤으면, 같은 시각 줄에서 이 항목이 바꾼 말만 되돌린다
          const at = stampOf(c.to);
          const j = lines.findIndex((l) => (at ? l.startsWith(at) : true) && l.includes(applied));
          if (j !== -1) lines[j] = (lines[j] as string).split(applied).join(heard);
        }
      }
      lines = lines.filter((l) => !u.inserted.includes(l));
      writeFileAtomic(p, lines.join('\n'));
    }
  }
  delete item.applied;
  delete item.count;
  delete item.undo;
  delete item.seq;
  item.status = 'open';
  return writeReview(dir, review);
}

// 고칠 말 적용: 녹취·정리본·회의록 본문에서 같은 글자를 모두 바꾼다 (처음 고치기 전에 원본을 한 번 보관)
export function applyReview(dir: string, fixes: readonly Fix[]): Review & { skipped: Skipped[] } {
  const review = readReview(dir);
  if (!review) throw new Error('확인 항목이 없습니다');
  const files = CONTENT_FILES;
  for (const f of files) {
    const p = path.join(dir, f);
    const backup = path.join(dir, backupName(f));
    if (fs.existsSync(p) && !fs.existsSync(backup)) copyFileAtomic(p, backup); // 반쯤 복사된 보관본은 되돌리기를 엉뚱하게 만든다
  }
  const texts: Record<ContentFile, string> = { 'transcript.txt': readText(dir, 'transcript.txt'), 'script-clean.txt': readText(dir, 'script-clean.txt'), 'minutes.md': readText(dir, 'minutes.md') };
  // 같은 글자를 모두 바꾼다. 회의록의 확인 필요 섹션은 원래 기록으로 남기고 본문만 고친다. 바꾼 개수를 돌려준다
  const replaceAll = (f: ContentFile, heard: string, guess: string): number => {
    const [body = '', ...rest] = f === 'minutes.md' ? texts[f].split(/(?=^## 확인 필요)/m) : [texts[f]];
    texts[f] = body.split(heard).join(guess) + rest.join('');
    return body.split(heard).length - 1;
  };
  const resumed: { item: Item; heard: string; guess: string }[] = [];
  const skipped: Skipped[] = []; // 바꾸지 못한 항목과 이유 (화면에 알린다, 기록에는 남기지 않는다)
  for (const fix of fixes) {
    const item = review.items.find((it) => it.id === fix.id);
    if (!item) continue;
    if (fix.keep) {
      Object.assign(item, { status: 'kept' });
      continue;
    }
    // 확인됨: 녹취 글자는 그대로, 확인한 내용만 남긴다 (확인 마치기에서 회의록 문장에 반영)
    if (fix.resolve) {
      Object.assign(item, { status: 'resolved', resolution: String(fix.resolve).trim().slice(0, 200) });
      continue;
    }
    let heard = fix.heard ?? item.heard;
    const guess = (fix.guess ?? '').trim();
    if (!heard || !guess) continue;
    // 고칠 말을 들린 말과 똑같이 넣으면 '이 표기가 맞다'는 뜻: 메모에 적힌 다른 표기를 이 말로 바꾼다
    // ("화자 2의 이름이 '원성'과 '원석'으로 혼재" 항목에 '원석'을 넣으면 원성 → 원석). 다른 표기가 없으면 바꿀 게 없다고 알린다
    if (heard === guess) {
      const other = noteVariants(item.note, texts['transcript.txt']).find((v) => v !== guess);
      if (!other) {
        skipped.push({ id: item.id, reason: 'same', heard });
        continue;
      }
      heard = other;
    }
    if (!texts['transcript.txt'].includes(heard)) {
      // 지난번 적용이 녹취를 고쳐 쓴 뒤 기록(review.json)을 쓰기 전에 끊긴 경우: 녹취에 고칠 말은 없고 고친 말이 있으며
      // 고치기 전 보관본에는 고칠 말이 있었다 → 남은 파일(정리본·회의록)을 마저 고치고, 되돌리기 기록은 파일을 쓴 뒤 보관본과 맞대어 채운다
      const backup = readText(dir, 'transcript.before-review.txt');
      if (item.status === 'open' && texts['transcript.txt'].includes(guess) && backup.includes(heard) && changedByThisItem(review, item, texts['transcript.txt'], backup, heard, guess)) {
        for (const f of files.slice(1)) replaceAll(f, heard, guess);
        resumed.push({ item, heard, guess });
      } else skipped.push({ id: item.id, reason: 'notfound', heard });
      continue;
    }
    let count = 0;
    const cleanHad = texts['script-clean.txt'].includes(heard);
    const before: Record<ContentFile, string> = { ...texts }; // 되돌리기용: 바뀐 줄만 기억한다
    for (const f of files) count += replaceAll(f, heard, guess);
    // 유실 구간을 채운 경우: 정리본이 그 줄('아 그렇구나' 같은 맞장구)을 쳐내 바꿀 글자가 없으면,
    // 원본에서 고쳐진 줄을 정리본의 같은 시각 자리에 넣는다 (오인식 단어는 쳐낸 줄이면 그대로 둔다)
    const cleanUndo = { changed: changedLines(before['script-clean.txt'], texts['script-clean.txt']), inserted: [] as string[] };
    const undo: Undo = {
      'transcript.txt': { changed: changedLines(before['transcript.txt'], texts['transcript.txt']), inserted: [] },
      'script-clean.txt': cleanUndo,
      'minutes.md': { changed: changedLines(before['minutes.md'], texts['minutes.md']), inserted: [] },
    };
    if (item.kind === 'lost' && !cleanHad && texts['script-clean.txt']) {
      for (const line of texts['transcript.txt'].split('\n').filter((l) => l.includes(guess))) {
        const at = /^\[([\d:]+)\]/.exec(line)?.[1];
        if (!at || texts['script-clean.txt'].includes(line)) continue;
        texts['script-clean.txt'] = spliceLines(texts['script-clean.txt'], parseClock(at), parseClock(at), [line]);
        cleanUndo.inserted.push(line);
      }
    }
    // 시각이 비어 있던 항목은 고치기 전 녹취로 시각을 남긴다 (고친 뒤에는 고칠 말이 녹취에 없다)
    // seq: 적용한 순번 — 되돌릴 때 '이 항목 다음에 같은 줄을 고친 항목'을 가린다(줄 글자만으로는 순서를 모른다: 나중 항목이 줄을 원래 글자로 되돌려 놓기도 한다)
    review.applySeq = (review.applySeq ?? 0) + 1;
    Object.assign(item, { status: 'applied', at: item.at ?? stampFor(item, before['transcript.txt']), heard, applied: guess, count, undo, seq: review.applySeq });
  }
  // 내용 파일 먼저, 기록(review.json)은 마지막에: 그 사이에 끊기면 "고쳤는데 기록이 없음"이 남고, 다시 적용하면 이어서 기록한다 (아래 resumed).
  // 반대 순서면 "기록은 있는데 안 고쳐짐"이 되어 되돌리기가 엉뚱한 줄을 건드린다
  for (const f of files) if (fs.existsSync(path.join(dir, f))) writeFileAtomic(path.join(dir, f), texts[f]);
  for (const { item, heard, guess } of resumed) {
    // 다른 항목이 같은 말을 같은 말로 고쳐 둔 줄은 그 항목 몫이다 (이 항목 기록에 넣으면 이걸 되돌릴 때 그것까지 되돌아간다).
    // 다른 말을 고친 항목과 한 줄을 같이 고친 경우는 둘 다의 몫이라 빼지 않는다
    const same = review.items.filter((it) => it !== item && it.status === 'applied' && it.heard === heard && it.applied === guess);
    const taken = new Set(same.flatMap((it) => Object.values(it.undo ?? {}).flatMap((u) => u.changed.map((c) => c.to))));
    const undo = legacyUndo(dir, { heard, applied: guess });
    for (const u of Object.values(undo ?? {})) u.changed = u.changed.filter((c) => !taken.has(c.to));
    const count = Object.values(undo ?? {}).reduce((n, u) => n + u.changed.length, 0);
    if (count) {
      review.applySeq = (review.applySeq ?? 0) + 1;
      Object.assign(item, { status: 'applied', heard, applied: guess, count, undo, seq: review.applySeq });
    }
  }
  return { ...writeReview(dir, review), skipped };
}

// 끊긴 적용인가: 보관본에서 들린 말이 있던 줄과 같은 시각의 지금 줄에 고칠 말이 있고, 그 줄이 다른 항목이 고친 결과(그 항목의
// 되돌리기 기록의 '바꾼 뒤' 줄)가 아니어야 한다. 앞서 적용한 다른 항목이 같은 들린 말(또는 그 말을 품은 말)을 이미 바꿔
// 녹취에서 들린 말이 사라진 경우를 끊긴 적용으로 잘못 보고 적용됨으로 표시하던 것 (verify-review-undo F3)
function changedByThisItem(review: Review, item: Item, transcript: string, backup: string, heard: string, guess: string): boolean {
  const others = new Set(review.items.filter((it) => it !== item && it.status === 'applied').flatMap((it) => (it.undo?.['transcript.txt']?.changed ?? []).map((c) => c.to)));
  const now = new Map(transcript.split('\n').map((l) => [stampOf(l), l]));
  return backup.split('\n').some((l) => {
    const at = stampOf(l);
    const cur = at && now.get(at);
    return Boolean(at && l.includes(heard) && cur && cur.includes(guess) && !others.has(cur));
  });
}

// 되돌리려는 항목이 바꾼 줄을 나중에 다른 항목이 또 고친 경우: 그 항목들(과 그 위에 또 고친 항목들). 줄로 잇는다 —
// 다른 항목의 '바꾸기 전' 줄이 이 항목의 '바꾼 뒤' 줄이면 그 항목은 이 항목 다음에 그 줄을 고쳤다
function laterOnSameLines(review: Review, item: Item): Item[] {
  // b가 a 다음에 적용됐고(순번), a가 바꾼 뒤의 줄을 b가 다시 바꿨다. 순번이 없는 예전 항목은 잇지 않는다(예전처럼 그 자리에서 되돌림)
  const touched = (a: Item, b: Item): boolean => a.seq !== undefined && b.seq !== undefined && b.seq > a.seq
    && (Object.entries(a.undo ?? {}) as [ContentFile, { changed: { from: string; to: string }[] }][]).some(([f, u]) => u.changed.some((c) => (b.undo?.[f]?.changed ?? []).some((d) => d.from === c.to)));
  const out: Item[] = [];
  const queue: Item[] = [item];
  while (queue.length) {
    const cur = queue.shift() as Item;
    for (const it of review.items) {
      if (it === item || out.includes(it) || it.status !== 'applied' || !it.undo || it.redo?.appliedAt) continue;
      if (touched(cur, it)) {
        out.push(it);
        queue.push(it);
      }
    }
  }
  // 되돌릴 순서: 자기 줄을 또 고친 항목이 남아 있지 않은 것부터 (맨 나중에 고친 것부터)
  const order: Item[] = [];
  const left = [...out];
  while (left.length) {
    const i = left.findIndex((a) => !left.some((b) => b !== a && touched(a, b)));
    order.push(...left.splice(i === -1 ? left.length - 1 : i, 1));
  }
  return order;
}
