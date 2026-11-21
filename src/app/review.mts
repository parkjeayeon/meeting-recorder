// ── 회의 페이지의 확인 필요 처리기 (review:*) ───────────────────────────────
// src/main.js에서 옮김 (결정 70). 확인 필요 자체는 src/review(src/minutes.js가 이어 준다).
// 여기서 더하는 것은 하나: 오인식 단어·이름을 고치면 고친 말을 받아쓰기 사전에 넣고(review:apply), 되돌리면 뺀다(review:revert).
// 사전은 받아쓰기 설정(dictation.js)에 있고, 바꾸면 녹음 폴더의 설정 백업도 다시 쓴다 (folders.mts의 writePortableSettings).
import type { Fix, Review } from '../review/index.mjs';
import type { Dictation } from '../dictation/index.mjs';
import { vocabList } from './folders.mjs';
import type { MinutesModule } from './connectors.mjs';
import type { Ipc } from './ipc.mjs';

export interface ReviewContext {
  recordingDir: (dir: unknown) => string; // 녹음 폴더 안이 아니면 던진다
  minutes: Pick<
    MinutesModule,
    'makeReview' | 'addReview' | 'applyReview' | 'readReview' | 'revertReview' | 'markReviewItems' | 'setReviewStatus' | 'finalizeReview' | 'reopenReview' | 'retranscribeRange' | 'applyRetranscribe' | 'chatReview'
  >;
  dictation: Pick<Dictation, 'getSettings' | 'saveSettings'>;
  writePortableSettings: () => void;
}

// 확인 필요에서 오인식 단어·이름을 고치면 고친 말을 사전에 넣는다 → 다음 녹음부터 Whisper가 그 말을 더 잘 알아듣는다.
// 짧은 낱말만 (문장·설명은 넣지 않음). 사전 화면에서 언제든 지울 수 있다
export const VOCAB_KINDS = new Set(['word', 'name']);

export function registerReview(ipc: Ipc, ctx: ReviewContext): void {
  const { minutes, dictation, recordingDir } = ctx;

  function addCorrectionsToVocab(review: Review, fixes: readonly Fix[]): string[] {
    const words = vocabList(dictation.getSettings().vocabulary);
    const have = new Set(words.map((w) => w.toLowerCase()));
    const added: string[] = [];
    for (const f of fixes) {
      const it = review.items.find((x) => x.id === f.id);
      const w = it?.status === 'applied' && VOCAB_KINDS.has(it.kind) ? String(it.applied ?? '').trim() : '';
      if (!w || w.length > 30 || w.split(/\s+/).length > 4 || /[.,!?。\n]/.test(w) || have.has(w.toLowerCase())) continue;
      have.add(w.toLowerCase());
      added.push(w);
    }
    if (added.length) {
      dictation.saveSettings({ vocabulary: [...words, ...added].join(', ') });
      ctx.writePortableSettings();
    }
    return added;
  }

  ipc.handle('review:make', (_e, dir) => minutes.makeReview(recordingDir(dir)));
  ipc.handle('review:add', (_e, dir, request) => minutes.addReview(recordingDir(dir), request as Parameters<MinutesModule['addReview']>[1]));
  ipc.handle('review:apply', (_e, dir, fixesArg) => {
    const fixes = fixesArg as Fix[];
    const d = recordingDir(dir);
    const review = minutes.applyReview(d, fixes);
    const addedWords = addCorrectionsToVocab(review, fixes);
    const ids = review.items.filter((it) => fixes.some((f) => f.id === it.id) && addedWords.includes(String(it.applied ?? '').trim())).map((it) => it.id);
    if (ids.length) minutes.markReviewItems(d, ids, { vocabAdded: true });
    return { ...review, addedWords };
  });
  // 확인 마치기 전 되돌리기: 사전에 자동으로 넣었던 단어도 뺀다
  ipc.handle('review:revert', (_e, dir, idArg) => {
    const id = idArg as string;
    const d = recordingDir(dir);
    const before = minutes.readReview(d)?.items.find((it) => it.id === id);
    const review = minutes.revertReview(d, id);
    const word = before?.vocabAdded ? String(before.applied ?? '').trim() : '';
    if (word) {
      const words = vocabList(dictation.getSettings().vocabulary);
      const next = words.filter((w) => w.toLowerCase() !== word.toLowerCase());
      if (next.length !== words.length) {
        dictation.saveSettings({ vocabulary: next.join(', ') });
        ctx.writePortableSettings();
      }
      minutes.markReviewItems(d, [id], { vocabAdded: false });
    }
    return { ...review, removedWord: word || null };
  });
  ipc.handle('review:status', (_e, dir, ids, status) => minutes.setReviewStatus(recordingDir(dir), ids as string[], status === 'open' ? 'open' : 'kept'));
  ipc.handle('review:finalize', (_e, dir) => minutes.finalizeReview(recordingDir(dir)));
  ipc.handle('review:reopen', (_e, dir) => minutes.reopenReview(recordingDir(dir)));
  ipc.handle('review:redo', (_e, dir, id, start, end) => minutes.retranscribeRange(recordingDir(dir), id as string, start as number, end as number));
  ipc.handle('review:redoApply', (_e, dir, id) => minutes.applyRetranscribe(recordingDir(dir), id as string));
  ipc.handle('review:chat', (_e, dir, ids, messages) => minutes.chatReview(recordingDir(dir), ids as string[], messages as Parameters<MinutesModule['chatReview']>[2]));
}
