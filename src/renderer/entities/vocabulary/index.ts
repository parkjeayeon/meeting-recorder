// 사전 단어 목록 (설정의 vocabulary 글자 하나에서 읽는다). 받아쓰기·회의 녹취의 Whisper 힌트로 쓰인다.
// 이 창구는 사본을 들지 않고, 앱이 넘긴 read·save로 설정 주인(entities/settings)을 읽고 쓴다.
// 주인은 settings가 바뀔 때마다 changed()를 부른다. 스냅샷은 글자가 바뀔 때만 새 배열이라 React가 쓸데없이 다시 그리지 않는다.
export interface VocabularyModel {
  /** React useSyncExternalStore용: 바뀌면 알림, 해제 함수를 돌려준다 */
  readonly subscribe: (onChange: () => void) => () => void;
  /** 지금 단어 목록 (같은 글자면 같은 배열) */
  readonly getSnapshot: () => readonly string[];
  /** 쉼표로 여러 개. 이미 있는 말은 빼고 더한다. 더한 게 있으면 true */
  readonly add: (typed: string) => Promise<boolean>;
  readonly remove: (word: string) => Promise<void>;
  /** 주인이 settings를 바꾼 뒤 부른다 */
  readonly changed: () => void;
}

/** 저장된 글자 → 단어 목록 (쉼표·줄바꿈으로 나눔) */
export const parseVocabulary = (text: string): string[] => text.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

/** 입력한 글자에서 새로 더할 단어 (쉼표로 여러 개, 이미 있는 말은 뺌 — 지금 목록 기준) */
export const newWords = (list: readonly string[], typed: string): string[] => typed.split(',').map((w) => w.trim()).filter((w) => w && !list.includes(w));

export function createVocabularyModel(owner: { readonly read: () => string; readonly save: (vocabulary: string) => Promise<void> }): VocabularyModel {
  const listeners = new Set<() => void>();
  let text: string | null = null;
  let snapshot: readonly string[] = [];
  const getSnapshot = () => {
    const now = owner.read();
    if (now !== text) {
      text = now;
      snapshot = Object.freeze(parseVocabulary(now));
    }
    return snapshot;
  };
  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot,
    add: async (typed) => {
      const list = getSnapshot();
      const fresh = newWords(list, typed);
      if (!fresh.length) return false;
      await owner.save([...list, ...fresh].join(', '));
      return true;
    },
    remove: async (word) => {
      await owner.save(getSnapshot().filter((x) => x !== word).join(', '));
    },
    changed: () => {
      for (const l of [...listeners]) l();
    },
  };
}
