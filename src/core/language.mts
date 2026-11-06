// 자동 감지를 쓰는 언어 후보로 좁히기 (결정 55). 파일·네트워크를 쓰지 않는다. src/dictation.js가 불러 쓴다.
// Whisper 서버는 후보 목록을 받지 않지만 verbose_json에 모든 언어의 확률(language_probabilities)을 준다.
// → 후보(한국어·영어·일본어) 가운데 가장 높은 언어를 고르고, Whisper가 후보 밖 언어로 받아썼으면 그 언어로 한 번 더 받아쓴다.
// 아주 짧은 말("네")은 후보 안에서도 엉뚱하게 잡혀(측정: "네" → 일본어 0.26 · 한국어 0.05) 첫 후보(한국어)로 받아쓴다.

export const AUTO_LANGUAGES = ['ko', 'en', 'ja'] as const;
export const SHORT_VOICED_MS = 1500; // 말소리가 이보다 짧으면 감지하지 않고 첫 후보로

export interface LanguageChoice {
  detected: string | null; // Whisper가 고른 언어 (모든 언어 중 가장 높은 것)
  pick: string | null; // 후보 중 가장 높은 언어
  rerun: boolean; // 후보 밖 언어로 받아써서 pick으로 다시 받아써야 하는지
}

export function chooseLanguage(probs: Record<string, number> | null | undefined, candidates: readonly string[] = AUTO_LANGUAGES): LanguageChoice {
  const entries = Object.entries(probs ?? {}).filter(([, p]) => typeof p === 'number' && Number.isFinite(p));
  if (!entries.length) return { detected: null, pick: null, rerun: false };
  const top = (list: [string, number][]) => list.reduce<[string, number] | null>((best, x) => (!best || x[1] > best[1] ? x : best), null)?.[0] ?? null;
  const detected = top(entries);
  const pick = top(entries.filter(([code]) => candidates.includes(code)));
  return { detected, pick, rerun: Boolean(pick && detected !== pick) };
}
