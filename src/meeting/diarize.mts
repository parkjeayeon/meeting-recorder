// 화자 구분 (pyannote, 앱 전용 파이썬 환경): 환경·스크립트·모델 자리, 샌드박스 안에서 돌리기,
// 그리고 화자 구분 결과(diarization.json)를 읽어 쓰는 일 — 재생 막대의 화자·녹취 없는 구간, 다시 받아쓴 줄의 화자 번호.
// Electron을 쓰지 않는다. 앱 데이터 폴더·설치본 여부·샌드박스는 deps.mts로 받는다 (결정 70).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Turn } from '../core/turns.mjs';
import { readJsonFile } from '../review/store.mjs';
import { isPackaged, resourcesPath, sandboxCacheEnv, sandboxWrap, userData } from './deps.mjs';
import { assignSpeakers, SPEAKER, type LabeledLine, type Segment } from './transcript.mjs';

function diarizeEnv(): string {
  return path.join(userData(), 'diarize-env', 'bin', 'python');
}

// 개발 중에는 저장소의 native/diarize.py (src/meeting에서도, 빌드한 lib/meeting에서도 두 단계 위)
function diarizeScript(): string {
  return isPackaged() ? path.join(resourcesPath(), 'diarize.py') : fileURLToPath(new URL('../../native/diarize.py', import.meta.url));
}

function diarizeModelReady(): boolean {
  return fs.existsSync(path.join(hfCacheDir(), DIARIZE_MODEL_DIR, 'snapshots'));
}

export function diarizeAvailable(): boolean {
  return fs.existsSync(diarizeEnv()) && fs.existsSync(diarizeScript());
}

// 화자 구분 모델은 앱 폴더 안에 받는다 (기본값 ~/.cache/huggingface는 다른 프로그램과 같이 쓰는 곳이라
// 앱 데이터와 따로 놀아 크기 확인·삭제·옮기기가 어렵다). 토큰은 그대로 ~/.cache/huggingface/token을 읽는다.
export const DIARIZE_MODEL_DIR = 'models--pyannote--speaker-diarization-community-1';

export function hfCacheDir(): string {
  const dir = path.join(userData(), 'hf-cache');
  const target = path.join(dir, DIARIZE_MODEL_DIR);
  if (!fs.existsSync(target)) {
    // 예전에 ~/.cache에 받아 둔 모델이 있으면 한 번 복사해 와서 다시 받지 않게 한다 (심볼릭 링크는 실제 파일로)
    const old = path.join(os.homedir(), '.cache', 'huggingface', 'hub', DIARIZE_MODEL_DIR);
    try {
      if (fs.existsSync(path.join(old, 'snapshots'))) {
        fs.mkdirSync(dir, { recursive: true });
        fs.cpSync(old, `${target}.tmp`, { recursive: true, dereference: true, filter: (src) => !src.includes(`${path.sep}blobs`) });
        fs.renameSync(`${target}.tmp`, target);
      }
    } catch {
      fs.rmSync(`${target}.tmp`, { recursive: true, force: true });
    }
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// diarize.py가 내놓는 것 (실패하면 부르는 쪽이 { error }로 바꿔 담는다)
export interface Diarization {
  segments?: Turn[];
  error?: string;
  [k: string]: unknown;
}

export function diarize(wavPath: string, speakers: number | null | undefined): Promise<Diarization> {
  return new Promise((resolve, reject) => {
    const args = [diarizeScript(), wavPath];
    if (speakers) args.push('--speakers', String(speakers));
    // 샌드박스: 네트워크 차단, 쓰기는 임시 폴더만 → 회의 녹음이 밖으로 나가지 않는다. 모델은 설치할 때 미리 받아 둔다
    if (!diarizeModelReady()) return reject(new Error('화자 구분 모델이 없습니다. 설정 › 엔진에서 설치하세요'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-diarize-'));
    const env = { ...process.env, PYTORCH_ENABLE_MPS_FALLBACK: '1', HF_HUB_CACHE: hfCacheDir(), HF_HUB_OFFLINE: '1', ...sandboxCacheEnv(tmp) };
    const proc = spawn(...sandboxWrap(diarizeEnv(), ['-I', ...args], { network: 'none' }), { env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        try {
          return resolve(JSON.parse(out));
        } catch {}
      }
      const gated = /gated|401|403|Unauthorized|restricted/i.test(err);
      reject(new Error(gated ? 'Hugging Face 토큰이 없거나 모델 약관에 동의하지 않았습니다' : `화자 구분 실패: ${err.trim().split('\n').pop()}`));
    });
  });
}

// 녹취 구간 (segments.json의 segments 한 줄)
type TrackSegment = Segment & { track?: string };

// 새로 받아쓴 줄에 이 회의의 화자 번호를 그대로 붙인다 (기존 녹취 전체로 번호 표를 먼저 만든다)
export function labelRedoLines(dir: string, segs: readonly Segment[], track: string, tracks: readonly string[]): (Segment & LabeledLine & { track: string })[] {
  const lines: (Segment & LabeledLine & { track: string })[] = segs.map((s) => ({ ...s, track, label: null }));
  const turns: Turn[] | undefined = readJsonFile(path.join(dir, 'diarization.json'))?.segments;
  if (turns && track === 'mic') {
    const names = new Map<string, string>();
    const old = ((readJsonFile(path.join(dir, 'segments.json'))?.segments ?? []) as TrackSegment[]).filter((l) => l.track === 'mic').map((l) => ({ ...l }));
    assignSpeakers(old, turns, names);
    assignSpeakers(lines, turns, names);
  }
  for (const l of lines) l.label ??= tracks.length > 1 ? SPEAKER[track] : null;
  return lines;
}

// 재생 막대용: 말소리는 있는데(화자 구분이 찾은 말한 구간) 녹취 글이 없는 구간.
// turns(누가 몇 초~몇 초)도 같이 돌려주지만 막대 색에는 쓰지 않는다 (줄 화자와 어긋남, 결정 36)
export const MISSING_MIN_SEC = 8;
export function speakerTurns(dir: string): { turns: { start: number; end: number; who: string | undefined }[]; missing: { start: number; end: number }[] } | null {
  const turns: Turn[] | undefined = readJsonFile(path.join(dir, 'diarization.json'))?.segments;
  if (!turns?.length) return null;
  const mic = ((readJsonFile(path.join(dir, 'segments.json'))?.segments ?? []) as TrackSegment[]).filter((l) => l.track === 'mic');
  const names = new Map<string, string>();
  assignSpeakers(mic.map((l) => ({ ...l })), turns, names);
  const display: Record<string, string> = readJsonFile(path.join(dir, 'meta.json'))?.speakerNames ?? {};
  const out = turns.filter((t) => names.has(t.speaker)).map((t) => ({ start: t.start, end: t.end, who: display[names.get(t.speaker)!] ?? names.get(t.speaker) }));
  // 말한 구간에서 녹취 구간(앞뒤 1초 여유)에 덮이지 않은 부분 → 이어 붙여 8초 이상이면 '녹취 없음'
  const covered = mic.map((l) => [l.start - 1, l.end + 1] as [number, number]).sort((a, b) => a[0] - b[0]);
  const gaps: [number, number][] = [];
  for (const t of turns) {
    let pos = t.start;
    for (const [a, b] of covered) {
      if (b <= pos || a >= t.end) continue;
      if (a > pos) gaps.push([pos, a]);
      pos = Math.max(pos, b);
      if (pos >= t.end) break;
    }
    if (pos < t.end) gaps.push([pos, t.end]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const g of gaps) {
    const last = merged.at(-1);
    if (last && g[0] - last[1] < 3) last[1] = Math.max(last[1], g[1]);
    else merged.push([...g]);
  }
  const missing = merged.filter(([a, b]) => b - a >= MISSING_MIN_SEC).map(([start, end]) => ({ start, end }));
  return { turns: out, missing };
}
