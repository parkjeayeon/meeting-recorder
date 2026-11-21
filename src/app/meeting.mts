// ── 회의 페이지 처리기: 회의록·녹음 가져오기·압축·화자 이름·흐름도·용어 설명·액션·할 일·지우기·정리본 ───────
// src/main.js에서 옮김 (결정 70). 확인 필요(review:*)는 review.mts, 파일 지켜보기(meeting:watch)는 watch.mts.
// 렌더러가 넘긴 경로는 모두 recordingDir()로 녹음 폴더 안의 것인지 본다 (folders.mts). 압축 중인 회의(compressing)만 여기서 갖고,
// 녹음 중인 폴더·회의록을 만드는 중인 회의·회의록 시작은 본체가 넘긴다. 흐름도·용어 설명·액션·녹음 가져오기는 src/meeting을 바로 부른다.
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../core/index.mjs';
import type { SpeakerNames } from '../core/index.mjs';
import * as importAudio from '../meeting/import-audio.mjs';
import * as glossary from '../meeting/glossary.mjs';
import type { Glossary } from '../meeting/glossary.mjs';
import * as flowMod from '../meeting/flow.mjs';
import type { FlowData } from '../meeting/flow.mjs';
import * as actionsMod from '../meeting/actions.mjs';
import { readJson } from './folders.mjs';
import type { FolderMeta } from './history.mjs';
import type { CompressModule, MinutesModule } from './connectors.mjs';
import type { Ipc } from './ipc.mjs';

// Electron dialog에서 쓰는 것만 (창은 본체의 BrowserWindow를 그대로 — 아직 없으면 undefined 그대로 넘긴다)
export interface MeetingDialog {
  showOpenDialog(
    win: unknown,
    opts: { title: string; buttonLabel: string; message: string; properties: ('openFile' | 'multiSelections')[]; filters: { name: string; extensions: string[] }[] },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(win: unknown, opts: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<{ canceled: boolean; filePath?: string }>;
}

export interface MeetingContext {
  recordingsDir: () => string;
  recordingDir: (dir: unknown) => string; // 녹음 폴더 안이 아니면 던진다
  recording: () => { dir: string } | null; // 녹음 중인 폴더는 압축·지우기를 막는다
  activeMinutes: ReadonlySet<string>;
  runMinutes: (dir: string, speakers?: number | null, opts?: { resume?: boolean }) => Promise<void>;
  minutes: Pick<MinutesModule, 'canResume' | 'renameSpeaker' | 'readReview' | 'nameSpeakers' | 'speakerTurns' | 'makeCleanScript'>;
  compress: Pick<CompressModule, 'compressMeeting' | 'declineCompress'>;
  dialog: MeetingDialog;
  shell: { trashItem(p: string): Promise<void> };
  win: () => unknown; // 파일 고르기·저장 창의 부모
  downloads: () => string; // app.getPath('downloads')
}

// 흐름도의 handoff (flow.json에 적힌 그대로 — 모양은 보지 않는다)
interface Handoff {
  from: string;
  to: string;
  give: { text: string; owner: string }[];
  todo: { text: string; owner: string }[];
  decided: { text: string; owner: string }[];
}

export function registerMeeting(ipc: Ipc, ctx: MeetingContext): void {
  const { minutes, recordingDir } = ctx;

  ipc.handle('minutes:make', (_e, dir, speakers) => {
    ctx.runMinutes(recordingDir(dir), Number(speakers) || null);
  });
  // 다른 앱에서 녹음한 파일을 회의로 가져온다 (여러 개면 이름 순서대로 이어 붙임)
  // meeting:pick — 파일 고르기 창(또는 끌어다 놓은 파일)을 확인 창에 보여 줄 목록으로. meeting:import — 실제로 가져와 회의록 시작
  ipc.handle('meeting:pick', async (_e, paths = null) => {
    let files = paths as string[] | null;
    if (!files?.length) {
      const picked = await ctx.dialog.showOpenDialog(ctx.win(), {
        title: '녹음 파일 가져오기',
        buttonLabel: '고르기',
        message: '여러 파일을 고르면 이름 순서대로 이어 붙여 회의 하나로 만듭니다',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '녹음 파일', extensions: importAudio.EXTS.map((e) => e.slice(1)) }],
      });
      if (picked.canceled || !picked.filePaths.length) return null;
      files = picked.filePaths;
    }
    // 확인 창: 파일 목록(순서·길이)과 짐작한 녹음 시각
    const [list, guess] = await Promise.all([importAudio.describe(files), importAudio.guessStart(files)]);
    return { files: list, guess: { at: guess.at.toISOString(), source: guess.source } };
  });
  ipc.handle('meeting:import', async (_e, paths, opts = {}) => {
    const { notes = '', speakers = null, startedAt = null } = opts as { notes?: unknown; speakers?: unknown; startedAt?: unknown };
    const files = paths as string[] | null | undefined;
    if (!files?.length) throw new Error('가져올 파일이 없습니다');
    const n = Number(speakers) || null;
    const dir = await importAudio.importAudio(files, ctx.recordingsDir(), { notes: String(notes ?? ''), speakers: n, startedAt: typeof startedAt === 'string' ? startedAt : null });
    ctx.runMinutes(dir, n);
    return { id: path.basename(dir), count: files.length };
  });
  ipc.handle('minutes:resume', (_e, dir) => {
    const d = recordingDir(dir);
    if (ctx.activeMinutes.has(d)) return;
    if (!minutes.canResume(d)) throw new Error('이어서 쓸 녹취가 없습니다. 녹취부터 다시 만들어 주세요');
    ctx.runMinutes(d, null, { resume: true });
  });
  // 회의 녹음 압축 (확인을 마친 회의, 사용자가 고를 때만): WAV → AAC 96kbps. 녹음 중·회의록을 만드는 중인 회의는 막는다
  const compressing = new Set<string>();
  ipc.handle('meeting:compress', async (_e, dir) => {
    const d = recordingDir(dir);
    if (ctx.recording()?.dir === d || ctx.activeMinutes.has(d)) throw new Error('녹음 중이거나 회의록을 만드는 중에는 압축할 수 없습니다');
    if (compressing.has(d)) throw new Error('이미 압축하고 있습니다');
    compressing.add(d);
    try {
      return await ctx.compress.compressMeeting(d);
    } finally {
      compressing.delete(d);
    }
  });
  ipc.handle('meeting:compressDecline', (_e, dir, declined = true) => ctx.compress.declineCompress(recordingDir(dir), declined as boolean));
  ipc.handle('speaker:rename', (_e, dir, from, to) => minutes.renameSpeaker(recordingDir(dir), from as string, to as string));
  ipc.handle('minutes:read', (_e, dir) => {
    const d = recordingDir(dir);
    const read = (f: string) => (fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), 'utf8') : null);
    const names = (readJson(path.join(d, 'meta.json')) as FolderMeta | null)?.speakerNames;
    const review = minutes.readReview(d);
    const rawTranscript = read('transcript.txt') ?? '';
    for (const it of review?.items ?? []) {
      it.at = core.stampFor(it, rawTranscript); // 예전에 만든 항목도 시각이 비어 있으면 녹취에서 찾아 보여 준다 (파일은 그대로)
      it.note = minutes.nameSpeakers(it.note, names, { prose: true });
      for (const c of it.chat ?? []) c.assistant = minutes.nameSpeakers(c.assistant, names, { prose: true });
    }
    return {
      minutes: minutes.nameSpeakers(read('minutes.md'), names, { prose: true }),
      transcript: minutes.nameSpeakers(read('transcript.txt'), names),
      scriptClean: minutes.nameSpeakers(read('script-clean.txt'), names),
      review,
      glossary: glossaryWithNames(d, names),
      speech: minutes.speakerTurns(d),
      flow: flowWithNames(d, names),
      actions: core.readActionsNamed(d, names),
    };
  });
  ipc.handle('actions:make', (_e, dir) => actionsMod.makeActions(recordingDir(dir)));
  ipc.handle('actions:toggle', (_e, dir, id, done) => actionsMod.toggleAction(recordingDir(dir), id as string, done));
  // 흐름도 글의 '화자 N'도 바꾼 이름으로 보여 준다 (파일은 그대로)
  function flowWithNames(d: string, names: SpeakerNames | undefined): FlowData | null {
    const data = flowMod.readFlow(d);
    const fix = <T extends string | null | undefined>(t: T): T => minutes.nameSpeakers(t, names, { prose: true });
    for (const f of data?.flows ?? []) {
      Object.assign(f, { title: fix(f.title), summary: fix(f.summary) });
      for (const st of f.steps ?? []) Object.assign(st, { title: fix(st.title), detail: fix(st.detail) });
      for (const n of [...(f.notes ?? []), ...((f.annotations ?? []) as { text: string }[])]) n.text = fix(n.text);
      for (const l of f.lanes ?? []) l.name = fix(l.name);
    }
    const h = data?.handoff as Handoff | undefined;
    if (h) {
      Object.assign(h, { from: fix(h.from), to: fix(h.to) });
      for (const x of [...h.give, ...h.todo, ...h.decided]) Object.assign(x, { text: fix(x.text), owner: fix(x.owner) });
    }
    return data;
  }
  ipc.handle('flow:make', (_e, dir, focus) => flowMod.makeFlows(recordingDir(dir), { focus }));
  ipc.handle('flow:remake', (_e, dir, id, instruction) => flowMod.remakeFlow(recordingDir(dir), id as string, instruction));
  ipc.handle('flow:remove', (_e, dir, id) => flowMod.removeFlow(recordingDir(dir), id as string));
  // 흐름도를 SVG 파일로: 저장할 곳은 사용자가 고른다 (기본은 다운로드 폴더, 이름은 흐름도 제목). 고르지 않으면 null
  ipc.handle('flow:saveSvg', async (_e, name, svg) => {
    if (typeof svg !== 'string' || !svg.startsWith('<?xml') || svg.length > 20 * 1024 * 1024) throw new Error('저장할 그림이 올바르지 않습니다');
    const safe = String(name ?? '흐름도').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || '흐름도';
    const { canceled, filePath } = await ctx.dialog.showSaveDialog(ctx.win(), { defaultPath: path.join(ctx.downloads(), `${safe}.svg`), filters: [{ name: 'SVG 그림', extensions: ['svg'] }] });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, svg);
    return filePath;
  });
  ipc.handle('flow:chat', (_e, dir, id, messages) => flowMod.chatFlow(recordingDir(dir), id as string, messages as { role: string; text: string }[]));
  ipc.handle('flow:apply', (_e, dir, id, revision) => flowMod.applyRevision(recordingDir(dir), id as string, revision));
  function glossaryWithNames(d: string, names: SpeakerNames | undefined): Glossary | null {
    const g = glossary.readGlossary(d);
    for (const t of g?.terms ?? []) t.note = minutes.nameSpeakers(t.note, names, { prose: true });
    return g;
  }
  ipc.handle('glossary:make', (_e, dir) => glossary.makeGlossary(recordingDir(dir)));
  ipc.handle('glossary:explain', (_e, dir, term) => glossary.explainTerm(recordingDir(dir), term));
  ipc.handle('glossary:update', (_e, dir, id, patch) => glossary.updateTerm(recordingDir(dir), id as string, patch as Parameters<typeof glossary.updateTerm>[2]));
  // 회의록의 할 일 체크: minutes.md에서 n번째 "- [ ]" 줄을 뒤집는다
  ipc.handle('minutes:todo', (_e, dir, index, done) => {
    const file = path.join(recordingDir(dir), 'minutes.md');
    let n = -1;
    const md = fs.readFileSync(file, 'utf8').replace(/^(\s*- \[)( |x)(\])/gim, (all, a, mark, b) => (++n === index ? `${a}${done ? 'x' : ' '}${b}` : all));
    core.writeFileAtomic(file, md);
    return md;
  });
  // 회의 삭제는 휴지통으로 옮긴다 (Finder에서 되살릴 수 있다)
  ipc.handle('meeting:trash', async (_e, dir) => {
    const d = recordingDir(dir);
    if (ctx.activeMinutes.has(d)) throw new Error('회의록을 만드는 중에는 지울 수 없습니다');
    if (ctx.recording()?.dir === d) throw new Error('녹음 중인 폴더는 지울 수 없습니다');
    if (!fs.statSync(d).isDirectory()) throw new Error('회의 폴더가 아닙니다'); // 녹음 폴더 안의 설정·기록 파일은 지우지 않는다
    await ctx.shell.trashItem(d);
  });
  ipc.handle('script:clean', async (_e, dir) => {
    const r = await minutes.makeCleanScript(recordingDir(dir));
    return { failed: r.failed, chunks: r.chunks };
  });
}
