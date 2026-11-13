// 화자 구분(pyannote) 결과 다듬기: 같은 사람이 이어 말하는 중에 몇 초만 다른 사람으로 잡힌 조각을 앞뒤 사람으로 되돌린다.
// 억양이 잠깐 바뀌면(남의 말을 흉내 내듯 말할 때 등) pyannote가 다른 사람으로 착각한다 — 실제 회의에서 확인(2026-11-13, 11:40~12:57).
// 진짜로 다른 사람이 끼어든 짧은 말도 앞뒤 사람 것이 될 수 있으므로 좁게 잡는다: 같은 사람 사이에 끼어 있고, 앞뒤 틈이 짧고, 짧을 때만.
export interface Turn {
  readonly start: number;
  readonly end: number;
  readonly speaker: string;
}

export const ISLAND_MAX_SEC = 5;
export const ISLAND_GAP_SEC = 1.5;

export function smoothTurns(turns: readonly Turn[], { maxSec = ISLAND_MAX_SEC, maxGap = ISLAND_GAP_SEC } = {}): Turn[] {
  let runs: Turn[] = [];
  for (const t of [...turns].sort((a, b) => a.start - b.start)) {
    const last = runs.at(-1);
    // 같은 사람의 이어진 조각은 한 덩어리로 (틈이 짧으면)
    if (last && last.speaker === t.speaker && t.start - last.end < maxGap) runs[runs.length - 1] = { ...last, end: Math.max(last.end, t.end) };
    else runs.push({ ...t });
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 1; i < runs.length - 1; i++) {
      const [a, b, c] = [runs[i - 1]!, runs[i]!, runs[i + 1]!];
      if (a.speaker === c.speaker && b.speaker !== a.speaker && b.end - b.start < maxSec && b.start - a.end < maxGap && c.start - b.end < maxGap) {
        runs = [...runs.slice(0, i - 1), { start: a.start, end: Math.max(c.end, b.end), speaker: a.speaker }, ...runs.slice(i + 2)];
        changed = true;
        break;
      }
    }
  }
  return runs;
}
