// 시각이 붙은 스크립트 줄 다루기 ([mm:ss] …). 파일을 읽거나 쓰지 않는다.

// "1:24:53" → 5093 (초). 숫자가 아니면 NaN
export const parseClock = (t: unknown): number => String(t).split(':').reduce((a, n) => a * 60 + Number(n), 0);

// 줄 맨 앞 시각 표시 "[12:30]" (없으면 undefined)
export const stampOf = (line: string): string | undefined => /^\[[\d:]+\]/.exec(line)?.[0];

// 되돌리기용 기록: 같은 자리의 줄 중 바뀐 것만 (고칠 말 적용은 줄 수를 바꾸지 않는다)
export type Change = { from: string; to: string };
export function changedLines(a: string, b: string): Change[] {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length !== y.length) return [];
  return x.map((from, i) => ({ from, to: y[i] as string })).filter((c) => c.from !== c.to);
}

// 시각이 start 이상 end 미만인 줄을 빼고 그 자리에 newLines를 넣는다. 새 줄은 구간이 끝난 뒤 첫 줄 앞에 (줄은 시각 순서다)
export function spliceLines(text: string, start: number, end: number, newLines: readonly string[]): string {
  const at = (l: string): number | null => {
    const m = /^\[([\d:]+)\]/.exec(l);
    return m ? parseClock(m[1]) : null;
  };
  const inRange = (l: string): boolean => {
    const t = at(l);
    return t !== null && t >= Math.floor(start) && t < end;
  };
  const kept = text.replace(/\n$/, '').split('\n').filter((l) => !inRange(l));
  let pos = kept.findIndex((l) => {
    const t = at(l);
    return t !== null && t >= end;
  });
  if (pos === -1) pos = kept.length;
  kept.splice(pos, 0, ...newLines);
  return `${kept.join('\n')}\n`;
}
