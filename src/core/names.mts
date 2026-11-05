// 화자 이름: 파일 안 화자 표시('화자 1', 두 트랙 녹음은 '나'·'상대방')는 만든 그대로 두고, 바꾼 이름은 meta.json의 speakerNames에 둔다.
// 보여 줄 때만 이 함수로 바꿔 끼운다. 앱(메인 프로세스)과 명령줄 도구가 같이 쓴다.

export type SpeakerNames = Record<string, string>;

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 스크립트(`[화자 1] 말`)는 대괄호 안만, 회의록 같은 글은 화자 표시로 쓰인 곳만 바꾼다.
// '화자 N'은 다른 말과 헷갈리지 않고, 그 밖의 표시('나' 등)는 앞이 글자가 아니고 뒤가 끝·조사일 때만.
export function nameSpeakers<T extends string | null | undefined>(text: T, names: SpeakerNames | null | undefined, { prose = false } = {}): T {
  const keys = Object.keys(names ?? {}).sort((a, b) => b.length - a.length);
  if (!text || !names || !keys.length) return text;
  const pattern = keys.map((key) => {
    const k = escapeRe(key);
    if (!prose) return `\\[${k}\\]`;
    if (/^화자 \d+$/.test(key)) return `${k}(?!\\d)`;
    return `(?<![가-힣A-Za-z0-9])${k}(?=$|[^가-힣A-Za-z0-9]|(?:은|는|이|가|과|와|의|을|를|도|만|에게|께서)(?![가-힣]))`;
  });
  // 한 번에 바꿔서 '화자 1' → '화자 2'처럼 이름이 다른 표시와 같아도 이어서 바뀌지 않게 한다.
  // 글에서는 뒤에 붙은 조사를 이름 받침에 맞춘다 ("화자 1은" → "멘토는")
  const re = new RegExp(`(?:${pattern.join('|')})${prose ? '(?:(은|는|이|가|과|와|을|를)(?![가-힣]))?' : ''}`, 'g');
  return text.replace(re, (m: string, josa?: string) => {
    if (!prose) return `[${names[m.slice(1, -1)]}]`;
    const name = names[josa ? m.slice(0, -josa.length) : m] ?? m;
    return name + (josa ? fitJosa(name, josa) : '');
  }) as T;
}

const JOSA: Record<string, [string, string]> = { 은: ['은', '는'], 는: ['은', '는'], 이: ['이', '가'], 가: ['이', '가'], 과: ['과', '와'], 와: ['과', '와'], 을: ['을', '를'], 를: ['을', '를'] };
function fitJosa(name: string, josa: string): string {
  const c = name.charCodeAt(name.length - 1);
  const pair = JOSA[josa];
  if (!pair || c < 0xac00 || c > 0xd7a3) return josa; // 한글로 끝나지 않으면 그대로
  return pair[(c - 0xac00) % 28 ? 0 : 1];
}
