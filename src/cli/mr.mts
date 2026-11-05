// 명령줄 도구 mr: 회의 목록·회의록·액션·정리본·화자를 읽어 JSON(에이전트용) 또는 Markdown(사람용)으로 내보낸다.
// 읽기만 한다. 앱에 들어 있는 Electron의 Node로 돈다 (Contents/Resources/mr이 ELECTRON_RUN_AS_NODE로 이 파일을 실행).
//   mr list | mr minutes latest | mr actions <id> | mr script <id> [--raw] | mr speakers <id> | mr schema [이름] | mr install
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MeetingError, clock, findRoot, listMeetings, readActions, readMinutes, readScript, readSpeakers, schema } from '../core/index.mjs';
import type { ActionsOutput, ListOutput, MinutesOutput, ScriptOutput, SpeakersOutput } from '../core/schema.mjs';

const HELP = `mr — Meeting Recorder 회의 데이터 읽기 (읽기 전용)

명령
  mr list [--limit N] [--since 2026-11-01]   회의 목록 (최근부터, 기본 50개)
  mr minutes <id>                             회의록 (Markdown)
  mr actions <id>                             할 일·알아 둘 것 (앱에서 '액션 찾기'를 한 회의만)
  mr script <id> [--raw]                      정리본 줄 (--raw: 원본 녹취)
  mr speakers <id>                            화자 이름·말한 시간
  mr schema [list|minutes|actions|script|speakers|error]   출력 JSON Schema
  mr install [--bin ~/.local/bin]             이 명령을 PATH 폴더에 설치

<id>  회의 폴더 이름(mr list의 id), latest(가장 최근), 또는 하나로 정해지는 앞부분(예: 2026-11-01_14)

공통 옵션
  --json / --md   출력 형식. 기본은 터미널이면 Markdown, 파이프·에이전트면 JSON
  --dir <폴더>     녹음 폴더 (기본: 앱 설정의 녹음 폴더, 없으면 ~/Documents/MeetingRecorder. 환경 변수 MR_RECORDINGS_DIR)

화자 이름은 앱에서 바꾼 이름으로 나온다. 오류는 stderr에 쓰고 0이 아닌 코드로 끝난다 (형식은 mr schema error).
회의 내용을 에이전트에 넘기면 그 에이전트의 LLM 서비스로 전송된다는 점에 유의하세요.`;

const SCHEMAS = { list: schema.ListOutput, minutes: schema.MinutesOutput, actions: schema.ActionsOutput, script: schema.ScriptOutput, speakers: schema.SpeakersOutput, error: schema.ErrorOutput } as const;

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  home?: string;
}

const realIo: Io = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  env: process.env,
  isTTY: Boolean(process.stdout.isTTY),
};

function version(): string {
  try {
    return JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

export function main(argv: string[], io: Io = realIo): number {
  let asJson = !io.isTTY;
  try {
    const { values: o, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' }, md: { type: 'boolean' }, dir: { type: 'string' }, limit: { type: 'string' }, since: { type: 'string' },
        raw: { type: 'boolean' }, bin: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    });
    if (o.json) asJson = true;
    if (o.md) asJson = false;
    const [cmd, arg] = positionals;
    if (o.version) return out(io, asJson, { version: version() }, () => version());
    if (o.help || !cmd || cmd === 'help') {
      io.stdout(`${HELP}\n`);
      return cmd || o.help ? 0 : 2;
    }
    const root = () => findRoot({ dir: o.dir, env: io.env, ...(io.home ? { home: io.home } : {}) }).dir;
    switch (cmd) {
      case 'list': {
        const limit = o.limit === undefined ? 50 : Number(o.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new MeetingError('USAGE', `--limit는 1 이상의 정수여야 합니다: ${o.limit}`);
        return out(io, asJson, listMeetings(root(), { limit, since: o.since }), mdList);
      }
      case 'minutes':
        return out(io, asJson, readMinutes(root(), need(arg)), (r: MinutesOutput) => r.markdown.trimEnd());
      case 'actions':
        return out(io, asJson, readActions(root(), need(arg)), mdActions);
      case 'script':
        return out(io, asJson, readScript(root(), need(arg), { raw: Boolean(o.raw) }), mdScript);
      case 'speakers':
        return out(io, asJson, readSpeakers(root(), need(arg)), mdSpeakers);
      case 'schema': {
        if (arg && !(arg in SCHEMAS)) throw new MeetingError('USAGE', `없는 스키마: ${arg}`, `다음 중 하나: ${Object.keys(SCHEMAS).join(', ')}`);
        io.stdout(`${JSON.stringify(arg ? SCHEMAS[arg as keyof typeof SCHEMAS] : SCHEMAS, null, 2)}\n`);
        return 0;
      }
      case 'install':
        return install(io, asJson, o.bin);
      default:
        throw new MeetingError('USAGE', `모르는 명령: ${cmd}`, 'mr --help');
    }
  } catch (err) {
    const e = err instanceof MeetingError ? err : new MeetingError((err as { code?: string }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? 'USAGE' : 'ERROR', (err as Error).message);
    if (asJson) io.stderr(`${JSON.stringify({ error: { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) } })}\n`);
    else io.stderr(`오류: ${e.message}${e.hint ? `\n${e.hint}` : ''}\n`);
    return e.code === 'USAGE' ? 2 : 1;
  }
}

const need = (id: string | undefined) => {
  if (!id) throw new MeetingError('USAGE', '회의 id가 필요합니다', '`mr list`로 id를 확인하거나 latest를 쓰세요');
  return id;
};

function out<T>(io: Io, asJson: boolean, data: T, md: (d: T) => string): number {
  io.stdout(asJson ? `${JSON.stringify(data)}\n` : `${md(data)}\n`);
  return 0;
}

// ── 사람이 읽는 형식 ────────────────────────────────────────────
const when = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function mdList(r: ListOutput): string {
  if (!r.meetings.length) return `회의가 없습니다 (${r.root})`;
  return r.meetings.map((m) => {
    const tags = [clock(m.durationSec), m.status === 'done' ? null : `회의록 ${m.status}`, m.review && !m.review.finalized ? `확인 필요 ${m.review.open}개` : null].filter(Boolean).join(' · ');
    return `- ${when(m.startedAt)} ${m.title ?? '(제목 없음)'} — ${tags}\n  id: ${m.id}${m.summary ? `\n  ${m.summary.replace(/\n+/g, ' ')}` : ''}`;
  }).join('\n');
}

function mdActions(r: ActionsOutput): string {
  const parts = ['## 할 일', r.actions.length ? r.actions.map((a) => `- [${a.done ? 'x' : ' '}] ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.due ? ` · ${a.due}까지` : ''}${a.at ? ` (${a.at})` : ''}`).join('\n') : '없음'];
  if (r.advice.length) parts.push(`## ${r.adviceTitle ?? '알아 둘 것'}`, r.advice.map((a) => `- ${a.key ? '★ ' : ''}${a.text}${a.from ? ` — ${a.from}` : ''}${a.at ? ` (${a.at})` : ''}`).join('\n'));
  return parts.join('\n\n');
}

const mdScript = (r: ScriptOutput) => r.lines.map((l) => `${l.stamp ? `[${l.stamp}] ` : ''}${l.speaker ? `[${l.speaker}] ` : ''}${l.text}`).join('\n');

function mdSpeakers(r: SpeakersOutput): string {
  if (!r.speakers.length) return '화자 구분 결과가 없습니다';
  const total = r.speakers.reduce((n, s) => n + s.sec, 0) || 1;
  return r.speakers.map((s) => `- ${s.name}${s.name === s.label ? '' : ` (${s.label})`}: ${Math.round((s.sec / total) * 100)}% · 약 ${clock(s.sec)} · ${s.lines}줄 · 처음 ${s.first}`).join('\n');
}

// ── 설치: 앱 안의 실행 스크립트(Contents/Resources/mr)를 PATH 폴더로 복사 ──
function install(io: Io, asJson: boolean, bin: string | undefined): number {
  const home = io.home ?? os.homedir();
  const source = io.env.MR_WRAPPER;
  if (!source || !fs.existsSync(source)) throw new MeetingError('USAGE', '앱 안의 mr로 설치해야 합니다', '"/Applications/Meeting Recorder.app/Contents/Resources/mr" install');
  const dir = path.resolve((bin ?? path.join(home, '.local', 'bin')).replace(/^~(?=$|\/)/, home));
  const target = path.join(dir, 'mr');
  fs.mkdirSync(dir, { recursive: true });
  if (path.resolve(source) !== target) fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  const inPath = (io.env.PATH ?? '').split(':').some((p) => path.resolve(p) === dir);
  const hint = inPath ? undefined : `PATH에 ${dir}이(가) 없습니다. 터미널에서: echo 'export PATH="${dir}:$PATH"' >> ~/.zshrc 후 새 터미널`;
  return out(io, asJson, { installed: target, inPath, ...(hint ? { hint } : {}) }, () => `설치함: ${target}${hint ? `\n${hint}` : ''}`);
}

