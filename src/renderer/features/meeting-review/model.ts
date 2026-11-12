// 확인 필요(review.json) 화면이 쓰는 모양
export interface ReviewItem {
  readonly id: string;
  readonly kind: 'word' | 'name' | 'meaning' | 'lost' | string;
  readonly at: string | null;
  readonly heard: string | null;
  readonly heardNote: string | null;
  readonly guess: string | null;
  readonly note: string;
  /** open · applied · kept · resolved */
  readonly status: string;
  readonly source?: string;
  readonly applied?: string;
  readonly count?: number;
  readonly resolution?: string;
  readonly chat?: readonly unknown[];
  readonly redo?: { readonly start: number; readonly end: number; readonly appliedAt?: string; readonly replaced?: unknown } | null;
}
export interface Review {
  readonly items: readonly ReviewItem[];
  readonly finalizedAt?: string | null;
  readonly finalize?: { readonly applied?: number; readonly kept?: number; readonly rewritten?: boolean } | null;
}
/** 적용할 것 하나: 고칠 말(guess, heard를 주면 그 글자를) · 그대로 두기(keep) · 확인됨(resolve) */
export type Fix = { readonly id: string; readonly heard?: string | null; readonly guess?: string; readonly keep?: boolean; readonly resolve?: string };

/** 확인을 마칠 때 회의록 문장을 고쳐 써야 하나: 채팅으로 밝혀진 것, 단어가 아닌 고침(이름·뜻·구간), 사람이 직접·회의록 안에서 고친 것 */
export const needsRewrite = (items: readonly ReviewItem[]): boolean =>
  items.some((it) => it.chat?.length || (it.status === 'applied' && (it.kind !== 'word' || it.source === 'user' || it.source === 'inline')));
