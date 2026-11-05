// 회의 데이터 읽기: 녹음 폴더 찾기, 회의 목록, 회의록·액션·스크립트·화자.
// 읽기만 한다 (파일을 고치지 않는다). Electron에 기대지 않아 메인 프로세스와 명령줄 도구가 같이 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Value from 'typebox/value';
import type Type from 'typebox';
import { nameSpeakers, type SpeakerNames } from './names.mjs';
import { parseScript, speakerStats } from './script.mjs';
import { ActionsFile, MetaFile, MinutesStateFile, ReviewFile, type ActionsOutput, type ListOutput, type MeetingSummary, type MinutesOutput, type ScriptOutput, type SpeakersOutput } from './schema.mjs';

export class MeetingError extends Error {
  code: string;
  hint: string | undefined;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

// JSON 파일을 읽어 모양이 맞을 때만 돌려준다 (없거나 깨졌거나 모양이 다르면 null)
export function readJson<T extends Type.TSchema>(file: string, schema: T): Type.Static<T> | null {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (isDenied(err)) throw denied(path.dirname(file));
    return null;
  }
  return Value.Check(schema, data) ? data : null;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (isDenied(err)) throw denied(path.dirname(file));
    return null;
  }
}

const isDenied = (err: unknown) => ['EPERM', 'EACCES'].includes((err as NodeJS.ErrnoException)?.code ?? '');
const denied = (dir: string) =>
  new MeetingError('NO_ACCESS', `macOS가 녹음 폴더 접근을 막았습니다: ${dir}`, '시스템 설정 › 개인정보 보호 및 보안 › 파일 및 폴더(또는 전체 디스크 접근 권한)에서 이 명령을 실행한 앱(터미널 등)에 문서 폴더 접근을 허용하세요');

// ── 녹음 폴더 찾기 ──────────────────────────────────────────────
// 앱 설정 폴더(Electron의 userData) 이름은 Electron과 같은 규칙으로 package.json에서 읽는다: productName, 없으면 name.
// 앱 안(app.asar)에서도 개발 폴더에서도 lib/core/ → ../../package.json
function appFolderName(): string {
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));
  return pkg.productName ?? pkg.name;
}
export const settingsFile = (home = os.homedir()) => path.join(home, 'Library', 'Application Support', appFolderName(), 'dictation.json');
export const defaultRecordingsDir = (home = os.homedir()) => path.join(home, 'Documents', 'MeetingRecorder');

export interface Root {
  dir: string;
  from: 'option' | 'env' | 'settings' | 'default';
}

// --dir > MR_RECORDINGS_DIR > 앱 설정(설정 › 녹음 폴더) > 기본 폴더. 앱처럼 지정한 폴더가 사라졌으면 기본 폴더를 쓴다
export function findRoot({ dir, env = process.env, home = os.homedir() }: { dir?: string | undefined; env?: NodeJS.ProcessEnv; home?: string } = {}): Root {
  if (dir) return { dir: path.resolve(dir), from: 'option' };
  if (env.MR_RECORDINGS_DIR) return { dir: path.resolve(env.MR_RECORDINGS_DIR), from: 'env' };
  let saved: unknown = null;
  try {
    saved = JSON.parse(fs.readFileSync(settingsFile(home), 'utf8'))?.recordingsDir;
  } catch {}
  if (typeof saved === 'string' && fs.existsSync(saved)) return { dir: saved, from: 'settings' };
  return { dir: defaultRecordingsDir(home), from: 'default' };
}

// ── 앱과 같이 쓰는 조각 ─────────────────────────────────────────
export const durationOf = (meta: Pick<MetaFile, 'files'>) => Math.max(0, ...Object.values(meta.files ?? {}).map((f) => f.durationSec ?? 0));

const section = (md: string, heading: string) => new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, 'm').exec(md)?.[1]?.trim() ?? null;

// 회의록의 '## 요약' (화자 이름 반영)
export function readSummary(dir: string, names?: SpeakerNames | null): string | null {
  const md = readText(path.join(dir, 'minutes.md'));
  return md ? nameSpeakers(section(md, '요약'), names, { prose: true }) : null;
}

export function reviewSummary(dir: string) {
  const review = readJson(path.join(dir, 'review.json'), ReviewFile);
  if (!review) return null;
  return { open: review.items.filter((it) => it.status === 'open').length, total: review.items.length, finalized: Boolean(review.finalizedAt) };
}

type Loose = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);

// 액션의 '화자 N'도 바꾼 이름으로 (파일은 그대로). 앱 화면이 쓰므로 파일의 다른 필드는 그대로 둔다
export function readActionsNamed(dir: string, names?: SpeakerNames | null): ActionsFile | null {
  const data = readJson(path.join(dir, 'actions.json'), ActionsFile);
  if (!data) return null;
  const fix = (t: unknown) => nameSpeakers(str(t), names, { prose: true });
  for (const a of data.actions as Loose[]) Object.assign(a, { owner: fix(a.owner), task: fix(a.task) });
  for (const a of (data.advice ?? []) as Loose[]) Object.assign(a, { from: fix(a.from), to: fix(a.to), text: fix(a.text), why: fix(a.why) });
  return data;
}

// ── 명령줄 도구용 ───────────────────────────────────────────────
const MEETING_DIR = /^\d{4}-\d{2}-\d{2}_.*_meeting$/;

function meetingNames(root: string): string[] {
  try {
    return fs.readdirSync(root).filter((n) => MEETING_DIR.test(n)).sort().reverse();
  } catch (err) {
    if (isDenied(err)) throw denied(root);
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new MeetingError('NOT_FOUND', `녹음 폴더가 없습니다: ${root}`, '앱에서 회의를 한 번 녹음했는지, 설정 › 녹음 폴더 위치를 확인하세요. 다른 폴더는 --dir로 지정합니다');
    throw err;
  }
}

interface Meeting {
  id: string;
  dir: string;
  meta: MetaFile;
}

function openMeeting(root: string, id: string): Meeting | null {
  const dir = path.join(root, id);
  const meta = readJson(path.join(dir, 'meta.json'), MetaFile);
  return meta ? { id, dir, meta } : null; // meta.json이 없으면 녹음 중이거나 깨진 폴더
}

// id: 회의 폴더 이름, 'latest'(가장 최근), 또는 이름 앞부분(하나로 정해질 때만, 예: 2026-11-01_14)
export function resolveMeeting(root: string, id: string): Meeting {
  const names = meetingNames(root).filter((n) => openMeeting(root, n));
  if (!id) throw new MeetingError('USAGE', '회의 id가 필요합니다', '`mr list`로 id를 확인하거나 latest를 쓰세요');
  const pick = id === 'latest' ? names.slice(0, 1) : names.includes(id) ? [id] : names.filter((n) => n.startsWith(id));
  if (pick.length > 1) throw new MeetingError('AMBIGUOUS', `'${id}'에 맞는 회의가 ${pick.length}개입니다: ${pick.slice(0, 5).join(', ')}${pick.length > 5 ? ' …' : ''}`, '더 길게 쓰세요');
  const one = pick[0] ? openMeeting(root, pick[0]) : null;
  if (!one) throw new MeetingError('NOT_FOUND', `회의를 찾지 못했습니다: ${id}`, '`mr list`로 id를 확인하세요');
  return one;
}

const title = (md: string | null) => md?.match(/^# (.+)$/m)?.[1]?.trim() ?? null;
const statusOf = (dir: string) => readJson(path.join(dir, 'minutes.json'), MinutesStateFile);
const exists = (dir: string, f: string) => fs.existsSync(path.join(dir, f));

function summarize({ id, dir, meta }: Meeting): MeetingSummary {
  const names = meta.speakerNames;
  const state = statusOf(dir);
  return {
    id,
    startedAt: meta.startedAt,
    durationSec: durationOf(meta),
    title: nameSpeakers(title(readText(path.join(dir, 'minutes.md'))), names, { prose: true }),
    summary: readSummary(dir, names),
    status: state?.status ?? 'none',
    speakers: typeof state?.speakers === 'number' ? state.speakers : null,
    review: reviewSummary(dir),
    has: { minutes: exists(dir, 'minutes.md'), actions: exists(dir, 'actions.json'), script: exists(dir, 'script-clean.txt'), transcript: exists(dir, 'transcript.txt') },
  };
}

export function listMeetings(root: string, { limit = 50, since }: { limit?: number; since?: string | undefined } = {}): ListOutput {
  const from = since ? new Date(since) : null;
  if (from && Number.isNaN(from.getTime())) throw new MeetingError('USAGE', `날짜를 읽지 못했습니다: ${since}`, '예: --since 2026-11-01');
  const meetings: MeetingSummary[] = [];
  for (const name of meetingNames(root)) {
    if (meetings.length >= limit) break;
    const m = openMeeting(root, name);
    if (!m || m.meta.mode !== 'meeting') continue;
    if (from && new Date(m.meta.startedAt) < from) continue;
    meetings.push(summarize(m));
  }
  return { root, meetings };
}

export function readMinutes(root: string, id: string): MinutesOutput {
  const m = resolveMeeting(root, id);
  const md = readText(path.join(m.dir, 'minutes.md'));
  const status = statusOf(m.dir)?.status ?? 'none';
  if (!md) throw new MeetingError('NOT_READY', `회의록이 아직 없습니다 (상태: ${status})`);
  const names = m.meta.speakerNames;
  return { id: m.id, title: nameSpeakers(title(md), names, { prose: true }), status, review: reviewSummary(m.dir), markdown: nameSpeakers(md, names, { prose: true }) };
}

export function readActions(root: string, id: string): ActionsOutput {
  const m = resolveMeeting(root, id);
  const data = readActionsNamed(m.dir, m.meta.speakerNames);
  if (!data) throw new MeetingError('NOT_READY', '액션을 아직 찾지 않았습니다', "앱의 회의 페이지 › 액션 탭에서 '액션 찾기'를 누르세요");
  const actions = (data.actions as Loose[]).map((a, i) => ({
    id: str(a.id) ?? `a${i + 1}`, owner: str(a.owner), task: String(a.task), due: str(a.due), kind: str(a.kind) ?? 'assigned', at: str(a.at), quote: str(a.quote), done: Boolean(a.done),
  }));
  const advice = ((data.advice ?? []) as Loose[]).map((a, i) => ({
    id: str(a.id) ?? `v${i + 1}`, group: str(a.group), key: Boolean(a.key), why: str(a.why), from: str(a.from), to: str(a.to), text: String(a.text), at: str(a.at), quote: str(a.quote),
  }));
  return { id: m.id, kind: data.kind ?? null, adviceTitle: data.adviceTitle ?? null, actions, advice };
}

export function readScript(root: string, id: string, { raw = false } = {}): ScriptOutput {
  const m = resolveMeeting(root, id);
  const text = readText(path.join(m.dir, raw ? 'transcript.txt' : 'script-clean.txt'));
  if (!text) throw new MeetingError('NOT_READY', raw ? '녹취가 아직 없습니다' : '정리본이 아직 없습니다', raw ? undefined : '원본 녹취는 --raw로 볼 수 있습니다');
  const names = m.meta.speakerNames;
  const lines = parseScript(text).map((l) => ({ at: l.at, stamp: l.stamp, speaker: l.who ? (names?.[l.who] ?? l.who) : null, text: l.said }));
  return { id: m.id, source: raw ? 'raw' : 'clean', lines };
}

export function readSpeakers(root: string, id: string): SpeakersOutput {
  const m = resolveMeeting(root, id);
  const text = readText(path.join(m.dir, 'transcript.txt'));
  if (!text) throw new MeetingError('NOT_READY', '녹취가 아직 없습니다');
  const names = m.meta.speakerNames ?? {};
  const stats = speakerStats(parseScript(text), durationOf(m.meta));
  return { id: m.id, speakers: stats.map((s) => ({ label: s.who, name: names[s.who] ?? s.who, sec: Math.round(s.sec), lines: s.lines, first: s.first })) };
}
