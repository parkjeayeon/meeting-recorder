// 기록 (history:list·recordings:stray·recordings:access·dict:page·dict:stats) — 임시 폴더의 지어낸 녹음 폴더와 받아쓰기 기록으로
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import { registerHistory, type FolderItem, type History, type HistoryContext } from './history.mjs';

let root: string;
let rec: string;
let ipc: FakeIpc;
let h: History;
let ctx: HistoryContext;
let recording: { dir: string } | null;
let log: string;
let waited: string[];

const readJson = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};
const meeting = (name: string, files: Record<string, unknown>) => {
  const dir = path.join(rec, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
  return dir;
};
const meta = (startedAt: string, extra = {}) => ({ mode: 'meeting', startedAt, files: { mic: { file: 'mic.wav', durationSec: 30 }, system: { file: 'system.wav', durationSec: 42 } }, ...extra });
const dict = (id: string, startedAt: string, extra = {}) => JSON.stringify({ id, startedAt, raw: `말 ${id}`, text: `글 ${id}.`, words: 2, chars: 5, status: 'pasted', ...extra });

beforeEach(() => {
  root = tmpDir('mr-history-');
  rec = path.join(root, 'rec');
  fs.mkdirSync(rec);
  log = path.join(rec, 'dictations.jsonl');
  recording = null;
  waited = [];
  ipc = fakeIpc();
  ctx = {
    recordingsDir: () => rec,
    dictationLog: () => log,
    recording: () => recording,
    activeMinutes: new Set(),
    waitingOnline: new Set(),
    waitForOnline: (dir) => void waited.push(dir),
    readJson,
    compress: { audioInfo: (dir, m) => ({ dir: path.basename(dir), tracks: Object.keys(m.files ?? {}).length }) },
  };
  h = registerHistory(ipc, ctx);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('회의 목록 (listFolders)', () => {
  it('받는 채널은 다섯', () => {
    expect(ipc.channels()).toEqual(['handle dict:page', 'handle dict:stats', 'handle history:list', 'handle recordings:access', 'handle recordings:stray']);
  });

  it('날짜 이름 폴더만, 최신순으로, meta.json이 없거나 깨진 폴더는 빼고 화면이 쓰는 모양으로', () => {
    meeting('2026-01-01_09-00-00_meeting', {
      'meta.json': meta('2026-01-01T00:00:00.000Z', { speakers: 3, speakerNames: { '화자 1': '가나' } }),
      'transcript.json': { lines: 1 },
      'minutes.json': { status: 'done', title: '가짜 회의' },
      'minutes.md': '# 가짜\n\n## 요약\n화자 1이 가짜 요약을 말했다.\n',
      'review.json': { items: [{ status: 'open' }, { status: 'kept' }] },
    });
    meeting('2026-01-02_10-00-00_meeting', {});
    meeting('2026-01-03_10-00-00_meeting', { 'meta.json': '{깨짐' });
    meeting('notes', { 'meta.json': meta('2026-01-04T00:00:00.000Z') });
    meeting('2026-01-05_10-00-00_memo', { 'meta.json': { mode: 'memo', startedAt: '2026-01-05T00:00:00.000Z' } });
    const list = h.listFolders();
    expect(list.map((r) => r.id)).toEqual(['2026-01-05_10-00-00_memo', '2026-01-01_09-00-00_meeting']);
    expect(list[1]).toEqual({
      id: '2026-01-01_09-00-00_meeting',
      dir: path.join(rec, '2026-01-01_09-00-00_meeting'),
      mode: 'meeting',
      startedAt: '2026-01-01T00:00:00.000Z',
      durationSec: 42,
      tracks: ['mic', 'system'],
      speakersHint: 3,
      firstFile: 'mic.wav',
      transcript: { lines: 1 },
      minutes: { status: 'done', title: '가짜 회의' },
      summary: '가나가 가짜 요약을 말했다.',
      review: { open: 1, total: 2, finalized: false },
      audio: { dir: '2026-01-01_09-00-00_meeting', tracks: 2 },
    } satisfies FolderItem);
    expect(list[0]).toMatchObject({ tracks: [], speakersHint: null, firstFile: null, transcript: null, minutes: null, summary: null, review: null });
    expect(h.listFolders(1).map((r) => r.id)).toEqual(['2026-01-05_10-00-00_memo']);
  });

  it('이전 실행에서 만들다 끊긴 회의록은 실패로 보이고, 지금 만드는 중이면 그대로', () => {
    const dirs = ['queued', 'transcribe', 'write'].map((status, i) => meeting(`2026-01-0${i + 1}_09-00-00_meeting`, { 'meta.json': meta(`2026-01-0${i + 1}T00:00:00.000Z`), 'minutes.json': { status, speakers: 2 } }));
    (ctx.activeMinutes as Set<string>).add(dirs[0]!);
    const byId = Object.fromEntries(h.listFolders().map((r) => [r.id, r.minutes]));
    expect(byId['2026-01-01_09-00-00_meeting']).toEqual({ status: 'queued', speakers: 2 });
    expect(byId['2026-01-02_09-00-00_meeting']).toEqual({ status: 'error', speakers: 2, stage: 'transcribe', error: '앱이 종료되어 중단됨' });
    expect(byId['2026-01-03_09-00-00_meeting']).toEqual({ status: 'error', speakers: 2, stage: 'write', error: '앱이 종료되어 중단됨' });
    expect(fs.readFileSync(path.join(dirs[2]!, 'minutes.json'), 'utf8')).toBe('{"status":"write","speakers":2}'); // 파일은 그대로
  });

  it('인터넷이 끊겨 멈춘 회의는 연결을 기다리게 한다 (이미 기다리거나 만드는 중이면 안 함)', () => {
    const offline = { status: 'error', offline: true, error: '인터넷 연결 없음' };
    const [a, b, c] = ['01', '02', '03'].map((d) => meeting(`2026-01-${d}_09-00-00_meeting`, { 'meta.json': meta(`2026-01-${d}T00:00:00.000Z`), 'minutes.json': offline }));
    meeting('2026-01-04_09-00-00_meeting', { 'meta.json': meta('2026-01-04T00:00:00.000Z'), 'minutes.json': { status: 'error', error: '다른 실패' } });
    (ctx.waitingOnline as Set<string>).add(b!);
    (ctx.activeMinutes as Set<string>).add(c!);
    h.listFolders();
    expect(waited).toEqual([a]);
  });

  it('녹음 폴더는 부를 때 읽는다 (폴더를 바꾼 뒤)', () => {
    meeting('2026-01-01_09-00-00_meeting', { 'meta.json': meta('2026-01-01T00:00:00.000Z') });
    expect(h.listFolders()).toHaveLength(1);
    rec = path.join(root, 'other');
    expect(h.listFolders()).toEqual([]);
  });
});

describe('history:list (listHistory)', () => {
  it('받아쓰기 최근 limit개와 회의 모두를 시각 최신순으로', async () => {
    meeting('2026-01-02_09-00-00_meeting', { 'meta.json': meta('2026-01-02T00:00:00.000Z') });
    fs.writeFileSync(log, [dict('d1', '2026-01-01T00:00:00.000Z'), dict('d3', '2026-01-03T00:00:00.000Z', { app: 'Notes', language: 'ko', wpm: 90, timing: { transcribeMs: 5 } }), dict('d0', '2026-01-04T00:00:00.000Z', { raw: '', status: 'empty' })].join('\n'));
    const all = (await ipc.invoke('history:list')) as { id: string }[];
    expect(all.map((r) => r.id)).toEqual(['d3', '2026-01-02_09-00-00_meeting', 'd1']);
    expect(all[0]).toEqual({ id: 'd3', mode: 'memo', startedAt: '2026-01-03T00:00:00.000Z', durationSec: undefined, app: 'Notes', words: 2, chars: 5, wpm: 90, language: 'ko', transcript: { raw: '말 d3', text: '글 d3.', cleanupProvider: undefined, cleanupError: undefined, timing: { transcribeMs: 5 } } });
    expect(h.listHistory(1).map((r) => r.id)).toEqual(['d3', '2026-01-02_09-00-00_meeting']);
  });
});

describe('받아쓰기 기록 (dict:page·dict:stats)', () => {
  it('기록 파일이 없으면 빈 목록', async () => {
    expect(h.dictationRecords()).toEqual([]);
    expect(await ipc.invoke('dict:page', null)).toEqual({ items: [], total: 0, matched: 0, next: null });
  });

  it('최신순으로 나눠 주고 찾기는 전체에서', async () => {
    fs.writeFileSync(log, ['1', '2', '3', '4'].map((n) => dict(`d${n}`, `2026-01-0${n}T00:00:00.000Z`)).join('\n'));
    const p1 = (await ipc.invoke('dict:page', { limit: 2 })) as { items: { id: string }[]; next: string | null; total: number };
    expect(p1.items.map((r) => r.id)).toEqual(['d4', 'd3']);
    expect(p1).toMatchObject({ total: 4, matched: 4, next: 'd3' });
    const p2 = (await ipc.invoke('dict:page', { limit: 2, before: 'd3' })) as { items: { id: string; mode: string }[] };
    expect(p2.items.map((r) => [r.id, r.mode])).toEqual([['d2', 'memo'], ['d1', 'memo']]);
    expect(await ipc.invoke('dict:page', { q: '글 D1' })).toMatchObject({ matched: 1, items: [{ id: 'd1' }] });
  });

  it('파일이 그대로면 다시 읽지 않고, 바뀌면 다시 읽는다. 경로는 부를 때 읽는다', async () => {
    fs.writeFileSync(log, dict('d1', '2026-01-01T00:00:00.000Z'));
    const read = vi.spyOn(fs, 'readFileSync');
    h.dictationRecords();
    h.dictationRecords();
    await ipc.invoke('dict:page', {});
    expect(read.mock.calls.filter((c) => c[0] === log)).toHaveLength(1);
    fs.appendFileSync(log, `\n${dict('d2', '2026-01-02T00:00:00.000Z')}`);
    expect(h.dictationRecords().map((r) => r.id)).toEqual(['d2', 'd1']);
    log = path.join(root, 'moved.jsonl');
    fs.writeFileSync(log, dict('m1', '2026-02-01T00:00:00.000Z'));
    expect(h.dictationRecords().map((r) => r.id)).toEqual(['m1']);
  });

  it('통계는 기록 파일이 바뀔 때만 다시 센다', async () => {
    fs.writeFileSync(log, dict('d1', '2026-01-01T00:00:00.000Z'));
    const a = await ipc.invoke('dict:stats');
    expect(await ipc.invoke('dict:stats')).toBe(a);
    expect(a).toMatchObject({ count: 1, total: 5 });
    fs.appendFileSync(log, `\n${dict('d2', '2026-01-02T00:00:00.000Z')}`);
    const b = await ipc.invoke('dict:stats');
    expect(b).not.toBe(a);
    expect(b).toMatchObject({ count: 2, total: 10 });
  });
});

describe('recordings:stray · recordings:access', () => {
  it('목록에 안 나오는 폴더를 알리고, 녹음 중인 폴더는 뺀다', async () => {
    meeting('2026-01-01_09-00-00_meeting', { 'meta.json': meta('2026-01-01T00:00:00.000Z') });
    const live = meeting('2026-01-02_09-00-00_meeting', {});
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(live, old, old);
    expect(((await ipc.invoke('recordings:stray')) as { id: string }[]).map((s) => s.id)).toEqual(['2026-01-02_09-00-00_meeting']);
    recording = { dir: live };
    expect(await ipc.invoke('recordings:stray')).toEqual([]);
  });

  it('녹음 폴더를 읽을 수 있는지와 지금 폴더', async () => {
    expect(await ipc.invoke('recordings:access')).toEqual({ ok: true, dir: rec });
    rec = path.join(root, 'gone');
    expect(await ipc.invoke('recordings:access')).toEqual({ ok: false, dir: rec, code: 'ENOENT' });
  });
});
