// 녹음 폴더 안에 있지만 회의 목록에 나오지 않는 폴더 찾기 (지울 수 있게 화면에 표시한다). 읽기만 한다.
// 목록은 이름이 `YYYY-MM-DD_`로 시작하고 meta.json을 읽을 수 있는 폴더만 보여 준다. 그 밖의 폴더는 화면에서 보이지 않아 지울 방법이 없었다
// (2026-11-06: 날짜를 잘못 읽은 가져오기가 `112-06-26_…_meeting` 폴더를 만들었다).
// 녹음 폴더를 사용자가 고른 다른 폴더로 바꿨을 수 있어, 이 앱이 만든 폴더로 보이는 것만 고른다 (이름이 `_meeting`·`_memo`로 끝나거나 meta.json·WAV가 있음).
import fs from 'node:fs';
import path from 'node:path';

export type StrayReason = 'bad-name' | 'no-meta' | 'bad-meta' | 'old-memo';

export interface StrayFolder {
  id: string; // 폴더 이름
  dir: string;
  reason: StrayReason;
  bytes: number; // 폴더 안 파일 크기 합 (한 단계만)
  audio: boolean; // WAV 등 녹음 파일이 있는지
  modifiedAt: string; // 폴더 안에서 가장 최근에 바뀐 파일의 시각
}

const LISTED = /^\d{4}-\d{2}-\d{2}_/; // src/main.js listFolders와 같은 규칙
const OURS = /_(meeting|memo)(-\d+)?$/;
const AUDIO = /\.(wav|m4a|mp3|aac|caf|aif|aiff|flac)$/i;

/**
 * @param skip 지금 쓰는 중인 폴더 (녹음 중·가져오는 중)
 * @param graceMs meta.json이 없어도 이 시간 안에 바뀐 폴더는 만드는 중으로 보고 건너뛴다
 */
export function findStrayFolders(root: string, { skip = [] as string[], now = Date.now(), graceMs = 2 * 60 * 1000 } = {}): StrayFolder[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const skipped = new Set(skip.map((d) => path.resolve(d)));
  const out: StrayFolder[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = path.join(root, e.name);
    if (skipped.has(path.resolve(dir))) continue;
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile());
    } catch {
      continue;
    }
    const names = files.map((f) => f.name);
    const hasMeta = names.includes('meta.json');
    const audio = names.some((n) => AUDIO.test(n));
    if (!OURS.test(e.name) && !hasMeta && !audio) continue; // 사용자의 다른 폴더

    let reason: StrayReason | null = null;
    if (!LISTED.test(e.name)) reason = 'bad-name';
    else if (!hasMeta) reason = 'no-meta';
    else {
      const m = readJson(path.join(dir, 'meta.json'));
      if (!m) reason = 'bad-meta';
      // 예전 버전이 녹음 폴더에 남긴 받아쓰기 녹음 (지금은 임시 폴더에 녹음하고 바로 지운다). 녹취가 없으면 받아쓰기 화면에도
      // 안 나와 어디에도 보이지 않았다 (2026-11-07, 10/31·11/1의 1초짜리 `_memo` 폴더 다섯 개)
      else if (m.mode === 'memo' && !names.includes('transcript.json')) reason = 'old-memo';
    }
    if (!reason) continue;

    let bytes = 0;
    let newest = 0;
    for (const f of files) {
      try {
        const st = fs.statSync(path.join(dir, f.name));
        bytes += st.size;
        newest = Math.max(newest, st.mtimeMs);
      } catch {}
    }
    if (!newest) newest = fs.statSync(dir).mtimeMs;
    if (reason !== 'bad-name' && now - newest < graceMs) continue; // 녹음·가져오기가 아직 쓰는 중일 수 있다
    out.push({ id: e.name, dir, reason, bytes, audio, modifiedAt: new Date(newest).toISOString() });
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function readJson(file: string): { mode?: unknown } | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
