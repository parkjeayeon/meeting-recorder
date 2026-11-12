// 스크립트 줄(`[mm:ss] [화자 1] 말`) 읽기와 화자별 말한 시간.
// 회의 화면도 이 모듈을 그대로 쓴다 (한 벌).

export interface ScriptLine {
  at: number | null; // 초
  stamp: string;
  who: string | null;
  said: string;
}

export const parseStamp = (t: string) => t.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);

export function clock(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function parseScript(text: string | null | undefined): ScriptLine[] {
  return (text ?? '').trim().split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^\[([\d:]+)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/);
    return m ? { at: parseStamp(m[1]!), stamp: m[1]!, who: m[2] ?? null, said: m[3] ?? '' } : { at: null, stamp: '', who: null, said: line };
  });
}

export interface SpeakerStat {
  who: string;
  sec: number;
  lines: number;
  first: string;
}

// 말한 시간은 다음 줄까지의 간격(최대 30초)으로 어림한다
export function speakerStats(lines: ScriptLine[], total: number): SpeakerStat[] {
  const map = new Map<string, SpeakerStat>();
  lines.forEach((l, i) => {
    if (!l.who || l.at === null) return;
    const next = lines.slice(i + 1).find((n) => n.at !== null)?.at ?? total;
    const s = map.get(l.who) ?? { who: l.who, sec: 0, lines: 0, first: l.stamp };
    s.sec += Math.max(0, Math.min(next - l.at, 30));
    s.lines++;
    map.set(l.who, s);
  });
  return [...map.values()].sort((a, b) => b.sec - a.sec);
}

// 복사용 마크다운: 한 줄에 목록 한 칸 (`- **00:02 민준** 말`). 줄바꿈 하나는 마크다운에서 한 문단으로 붙어 버리기 때문.
// 말 속의 마크다운 글자(* _ ` ~ [ ] < > & \)는 글자 그대로 보이게 막는다. 앞에 시각이 없는 줄은 줄머리 표시(# > - + 1.)도 막는다
const escapeMd = (t: string) => t.replace(/[\\`*_~[\]<>&|]/g, '\\$&');
const escapeLead = (t: string) => t.replace(/^(\s*)([#>+=-]|\d+(?=[.)]))/, (_m, sp: string, mark: string) => `${sp}${/\d/.test(mark) ? `${mark}\\` : `\\${mark}`}`);

export function scriptMarkdown(text: string | null | undefined): string {
  return linesMarkdown(parseScript(text));
}

export function linesMarkdown(lines: Pick<ScriptLine, 'stamp' | 'who' | 'said'>[]): string {
  return lines.map((l) => {
    const said = escapeMd(l.said.trim());
    if (!l.stamp) return `- ${escapeLead(said)}`;
    const head = `**${l.stamp}${l.who ? ` ${escapeMd(l.who)}` : ''}**`;
    return said ? `- ${head} ${said}` : `- ${head}`;
  }).join('\n');
}
