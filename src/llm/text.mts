// LLM에 보내기 전·받은 뒤의 글 다루기. 파일·네트워크·프로세스를 쓰지 않는다.

export const CHUNK_CHARS = 600; // 이보다 길면 나눠서 다듬는다

// 문장 끝(. ? ! 。)에서 잘라 CHUNK_CHARS 안팎의 조각으로 나눈다
export function splitChunks(text: string, max = CHUNK_CHARS): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.?!。]+[.?!。]+\s*|[^.?!。]+$/g) ?? [text];
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) {
      chunks.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

// 다듬은 조각을 다시 잇는다. 주제별로 정리한 조각(여러 줄)이 있으면 줄을 바꿔 잇는다 — 띄어쓰기로 이으면 목록이 한 줄로 뭉친다
export function joinCleaned(cleaned: readonly string[]): string {
  return cleaned.join(cleaned.length < 2 ? '' : cleaned.some((c) => c.includes('\n')) ? '\n\n' : ' ');
}

// 한 번에 limit개까지만 동시에 돌리고, 결과는 입력 순서대로
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// LLM 답에서 JSON 꺼내기 (```json 블록이나 본문의 첫 {…})
export function parseJson(text: string): any {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  try {
    return JSON.parse(m ? (m[1] as string) : text);
  } catch {
    return null;
  }
}
