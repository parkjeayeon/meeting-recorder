// 다듬기 전/후를 단어 단위로 비교해 지운 말(취소선)과 넣은 말(밑줄)을 표시한다
export const PUNCT = /^[.,!?…·:;"'“”‘’()]$/;
const tokenize = (s: string): string[] => s.match(/[^\s.,!?…·:;"'“”‘’()]+|[.,!?…·:;"'“”‘’()]/g) ?? [];
const joinTokens = (tokens: readonly string[]): string => tokens.reduce((out, t, i) => (i && !PUNCT.test(t) ? `${out} ${t}` : out + t), '');

export type DiffOp = 'eq' | 'del' | 'ins';
export interface DiffPart {
  readonly op: DiffOp;
  readonly tokens: string[];
}

export function diffWords(a: string, b: string): DiffPart[] {
  const x = tokenize(a);
  const y = tokenize(b);
  if (x.length * y.length > 250000) return [{ op: 'eq', tokens: y }];
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const out: DiffPart[] = [];
  const push = (op: DiffOp, token: string) => {
    const last = out.at(-1);
    if (last?.op === op) last.tokens.push(token);
    else out.push({ op, tokens: [token] });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('eq', x[i++]!);
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) push('del', x[i++]!);
    else push('ins', y[j++]!);
  }
  while (i < x.length) push('del', x[i++]!);
  while (j < y.length) push('ins', y[j++]!);
  return out;
}

/** 교정 부호를 붙인 글의 조각들. 고친 게 없거나 너무 많이 고쳤으면(넣은 말 비율 > 40%) 글 하나(text)만.
 *  space: 앞 조각과 사이에 빈칸을 넣는지 (문장 부호 앞에는 안 넣는다) */
export type Marked =
  | { readonly text: string; readonly heavy: boolean; readonly parts?: undefined }
  | { readonly parts: readonly { readonly op: DiffOp; readonly words: string; readonly space: boolean }[]; readonly heavy: false; readonly text?: undefined };

export function markParts(raw: string, text: string | undefined): Marked {
  if (!text || raw === text) return { text: text ?? raw, heavy: false };
  const parts = diffWords(raw, text);
  const inserted = parts.filter((p) => p.op === 'ins').reduce((n, p) => n + p.tokens.length, 0);
  const kept = parts.filter((p) => p.op !== 'del').reduce((n, p) => n + p.tokens.length, 0);
  if (inserted / Math.max(1, kept) > 0.4) return { text, heavy: true };
  return { heavy: false, parts: parts.map((p, k) => ({ op: p.op, words: joinTokens(p.tokens), space: k > 0 && !PUNCT.test(p.tokens[0]!) })) };
}
