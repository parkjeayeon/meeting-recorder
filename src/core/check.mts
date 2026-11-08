// 회의록 형식 검사: LLM이 쓴 회의록(minutes.md)이 틀을 지켰는지, 붙인 시각·담당·기한이 녹취에 근거가 있는지 코드로 본다.
// LLM을 부르지 않는다. 파일을 읽거나 쓰지 않는다. src/minutes.js가 회의록을 만든 뒤 불러, 걸린 것을 확인 필요에 올린다.
// 판단이 애매하면 걸지 않는다 — 엉뚱하게 걸리면 확인 필요가 소음이 된다 (실제 회의로 잰 결과는 docs/measurements.md)

export type CheckCode = 'section' | 'time-range' | 'ungrounded' | 'owner-unknown' | 'due-unknown';
export interface CheckIssue {
  code: CheckCode;
  at: string | null; // 관련 시각 (있으면)
  text: string; // 걸린 회의록 줄 (앞의 '- [ ] '는 뗌)
  note: string; // 확인 필요에 보일 한 문장
}

const REQUIRED = ['요약', '논의 내용', '결정 사항', '할 일'];
const WINDOW_SEC = 90; // 시각 앞뒤 이만큼의 녹취에서 근거를 찾는다 (회의록 시각은 그 이야기가 시작된 곳 근처)
// 근거 찾기에서 빼는 말: 회의록 문체·흔한 말이라 녹취에 있어도 근거가 못 된다
const STOP = new Set(['논의', '결정', '확인', '진행', '검토', '공유', '정리', '필요', '관련', '내용', '방식', '방안', '부분', '여부', '이후', '이전', '다음', '이번', '현재', '경우', '대한', '위해', '통해', '함께', '하기', '하고', '하는', '했다', '했음', '합니다', '있음', '없음', '있는', '없는', '것으로', '것을', '것이', '그리고', '또한', '담당', '기한', '화자']);

const sec = (t: string) => t.split(':').reduce((n, x) => n * 60 + Number(x), 0);
const TIME_RE = /\((\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[~–-]\s*\d{1,2}:\d{2}(?::\d{2})?)?\)/g;

// 낱말: 공백·문장부호로 나누고 흔한 조사를 뗀 두 글자 이상 (숫자가 든 말은 그대로)
function words(text: string, names: readonly string[] = []): string[] {
  let t = text.replace(TIME_RE, ' ').replace(/화자\s*\d+[이가은는을를의와과도]?/g, ' '); // 화자 표시·이름은 근거가 못 된다 (어느 줄에나 나온다)
  for (const n of names) if (n) t = t.split(n).join(' ');
  return [...new Set(t.split(/[\s,.·:;!?'"‘’“”()[\]{}<>/~—–-]+/)
    .map((w) => (/\d/.test(w) ? w : w.replace(/(으로|에서|에게|까지|부터|이라|라는|하기로|하고|했고|하며|했다|했음|한다|함|은|는|이|가|을|를|에|의|도|로|와|과|만|님)$/, '')))
    .filter((w) => w.length >= 2 && !STOP.has(w)))];
}

interface Line { at: number; body: string }
function parseTranscript(transcript: string): Line[] {
  const out: Line[] = [];
  for (const l of transcript.split('\n')) {
    const m = /^\[([\d:]+)\]\s*(?:\[[^\]]+\]\s*)?(.*)$/.exec(l);
    if (m) out.push({ at: sec(m[1]!), body: m[2]! });
  }
  return out;
}

// 녹취 구간에 근거가 있나: 낱말이 그대로, 아니면 앞 두 글자로(활용·띄어쓰기 차이: "보내겠다고" ↔ "보내드릴") 나오면 맞은 것.
// 낱말이 다섯 이상인 줄은 둘이 맞아야 한다 — 흔한 말 하나가 우연히 걸려 넘어가지 않게.
// 기준은 실제 회의 6개로 정했다: 원래 회의록 시각 91개 중 걸림 0, 시각을 5·10분 옮기면 41~45%를 잡음 (docs/measurements.md)
function grounded(ws: string[], text: string): boolean {
  const flat = text.replace(/\s+/g, '');
  const hit = ws.filter((w) => flat.includes(w.replace(/\s+/g, '')) || (w.length >= 3 && !/\d/.test(w) && flat.includes(w.slice(0, 2)))).length;
  return hit >= (ws.length >= 5 ? 2 : 1);
}

export function checkMinutes(md: string, transcript: string, { durationSec = null, names = [] }: { durationSec?: number | null; names?: readonly string[] } = {}): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const lines = parseTranscript(transcript);
  const all = lines.map((l) => l.body).join('\n');
  const sections = new Map<string, string[]>();
  let cur: string | null = null;
  for (const l of md.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) sections.set((cur = h[1]!), []);
    else if (cur && !/^#\s/.test(l)) sections.get(cur)!.push(l);
  }
  for (const name of REQUIRED) {
    if (!sections.has(name)) issues.push({ code: 'section', at: null, text: name, note: `회의록에 '${name}' 칸이 없습니다` });
  }
  if (!/^#\s+\S/m.test(md)) issues.push({ code: 'section', at: null, text: '제목', note: '회의록에 제목이 없습니다' });

  for (const [name, body] of sections) {
    if (name === '확인 필요') continue; // 확인 필요는 원래 불확실한 것을 모은 칸
    for (const raw of body) {
      const line = raw.replace(/^\s*[-*]\s+(\[[ x]\]\s+)?/i, '').trim();
      if (!line || line === '없음' || /녹음 외 메모/.test(line)) continue;
      const stamps = [...line.matchAll(TIME_RE)].map((m) => m[1]!);
      // 시각이 녹음 길이를 넘는다 (5초 여유)
      for (const t of stamps) {
        if (durationSec !== null && sec(t) > durationSec + 5) issues.push({ code: 'time-range', at: t, text: line, note: `회의록에 적힌 시각 ${t}가 녹음 길이를 넘습니다` });
      }
      // 시각 근처 녹취에 이 줄의 낱말이 하나도 없다 (낱말이 셋 이상인 줄만 — 짧은 줄은 판단하지 않는다)
      const ws = words(line.replace(/—\s*담당:.*$/, ''), names);
      for (const t of stamps.filter((x) => durationSec === null || sec(x) <= durationSec + 5)) {
        if (ws.length < 3) break;
        const near = lines.filter((l) => Math.abs(l.at - sec(t)) <= WINDOW_SEC).map((l) => l.body).join(' ');
        if (near && !grounded(ws, near)) issues.push({ code: 'ungrounded', at: t, text: line, note: `회의록의 이 문장에 붙은 시각(${t}) 앞뒤 녹취에서 관련된 말을 찾지 못했습니다 — 시각이 틀렸거나 녹취에 없는 내용일 수 있습니다` });
      }
      // 할 일의 담당·기한이 녹취(또는 화자 이름)에 있나
      if (name === '할 일') {
        const owner = /담당:\s*([^,，)]+)/.exec(line)?.[1]?.trim();
        if (owner && owner !== '없음' && owner !== '미정') {
          const known = owner.split(/[·/,&]|\s및\s|\s와\s|\s과\s/).map((o) => o.trim().replace(/님$/, '')).filter(Boolean);
          const missing = known.filter((o) => !/^화자\s*\d+$/.test(o) && !names.some((n) => n.replace(/님$/, '') === o) && !all.replace(/\s+/g, '').includes(o.replace(/\s+/g, '')));
          if (missing.length) issues.push({ code: 'owner-unknown', at: stamps[0] ?? null, text: line, note: `할 일 담당 '${missing.join(', ')}'이(가) 녹취에 나오지 않습니다 — 이름을 확인해 주세요` });
        }
        const due = /기한:\s*([^,，)]+)/.exec(line)?.[1]?.trim();
        if (due && due !== '없음' && due !== '미정') {
          const dw = words(due.replace(/(내|까지|중|안|이내|경)$/, ''));
          if (dw.length && !grounded(dw, all)) issues.push({ code: 'due-unknown', at: stamps[0] ?? null, text: line, note: `할 일 기한 '${due}'이(가) 녹취에 나오지 않습니다 — 날짜를 확인해 주세요` });
        }
      }
    }
  }
  return issues;
}
