// ── 녹음 폴더 바꾸기: 고른 폴더로 기존 녹음을 옮기거나, 옮기지 않고 새 폴더만 쓴다 ──
// src/main.js에서 옮김 (결정 70). 지금 녹음 폴더·녹음 중인지·회의록을 만드는 중인지는 본체가 갖고 있어 부를 때 getter로 읽고,
// 폴더를 바꾸는 일(setRecordingsDir: 받아쓰기 기록 경로와 폴더 지켜보기도 바꾼다)과 설정 백업은 본체 함수를 부른다.
import fs from 'node:fs';
import path from 'node:path';
import type { Ipc } from './ipc.mjs';

const RECORDING_ENTRY = /^\d{4}-\d{2}-\d{2}_/;

export async function moveEntry(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    // 다른 디스크면 복사한 뒤 지운다
    await fs.promises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
    await fs.promises.rm(from, { recursive: true, force: true });
  }
}

// Electron dialog에서 쓰는 것만 (창은 본체의 BrowserWindow를 그대로 넘긴다)
export interface FolderDialog {
  showOpenDialog(
    win: unknown,
    opts: { title: string; defaultPath: string; buttonLabel: string; properties: ('openDirectory' | 'createDirectory')[] },
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showMessageBox(
    win: unknown,
    opts: { type: 'question'; buttons: string[]; defaultId: number; cancelId: number; message: string; detail: string },
  ): Promise<{ response: number }>;
}

export interface RecordingsFolderContext {
  recordingsDir: () => string; // 지금 녹음 폴더 (RECORDINGS_DIR)
  defaultRecordingsDir: string; // ~/Documents/MeetingRecorder
  setRecordingsDir: (dir: string) => void;
  recording: () => unknown; // 녹음 중이면 참
  activeMinutes: ReadonlySet<string>; // 이 실행에서 회의록을 만들고 있는 회의 폴더
  mergePortableSettings: () => boolean;
  writePortableSettings: () => void;
  updateTray: () => void;
  win: () => unknown;
  dialog: FolderDialog;
  shell: { openPath(p: string): unknown };
  dictation: { saveSettings(patch: { recordingsDir: string | null }): unknown };
}

export interface ChooseResult {
  dir: string;
  moved: number;
  skipped: number;
  total?: number;
  isDefault?: boolean;
}

export function registerRecordingsFolder(ipc: Ipc, ctx: RecordingsFolderContext): void {
  ipc.handle('recordings:choose', async (): Promise<ChooseResult | null> => {
    if (ctx.recording() || ctx.activeMinutes.size) throw new Error('녹음 중이거나 회의록을 만드는 중에는 바꿀 수 없습니다');
    const picked = await ctx.dialog.showOpenDialog(ctx.win(), {
      title: '녹음 폴더 고르기',
      defaultPath: ctx.recordingsDir(),
      buttonLabel: '이 폴더 사용',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const next = path.resolve(picked.filePaths[0]);
    const prev = ctx.recordingsDir();
    if (next === prev) return { dir: prev, moved: 0, skipped: 0 };
    try {
      fs.accessSync(next, fs.constants.W_OK);
    } catch {
      throw new Error('이 폴더에는 쓸 수 없습니다');
    }
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(prev).filter((n) => RECORDING_ENTRY.test(n) || n === 'dictations.jsonl' || n === 'settings.json');
    } catch {}
    let move = false;
    if (entries.length) {
      const meetings = entries.filter((n) => n.endsWith('_meeting')).length;
      const { response } = await ctx.dialog.showMessageBox(ctx.win(), {
        type: 'question',
        buttons: ['옮기기', '옮기지 않고 바꾸기', '취소'],
        defaultId: 0,
        cancelId: 2,
        message: '지금까지의 녹음을 새 폴더로 옮길까요?',
        detail: `회의 ${meetings}개${entries.includes('dictations.jsonl') ? '와 받아쓰기 기록' : ''}을 옮깁니다. 옮기지 않으면 이전 녹음은 원래 폴더에 남고 앱에서는 보이지 않습니다.`,
      });
      if (response === 2) return null;
      move = response === 0;
    }
    let moved = 0;
    let skipped = 0;
    if (move) {
      for (const name of entries) {
        const to = path.join(next, name);
        if (fs.existsSync(to)) {
          skipped++; // 같은 이름이 이미 있으면 덮어쓰지 않는다
          continue;
        }
        try {
          await moveEntry(path.join(prev, name), to);
          moved++;
        } catch {
          skipped++;
        }
      }
    }
    ctx.setRecordingsDir(next);
    ctx.mergePortableSettings(); // 새 폴더에 예전 설정이 있으면 사전을 합친다
    ctx.writePortableSettings();
    ctx.dictation.saveSettings({ recordingsDir: next === ctx.defaultRecordingsDir ? null : next });
    ctx.updateTray();
    return { dir: next, moved, skipped, total: entries.length, isDefault: next === ctx.defaultRecordingsDir };
  });

  ipc.handle('recordings:reset', async () => {
    if (ctx.recording() || ctx.activeMinutes.size) throw new Error('녹음 중이거나 회의록을 만드는 중에는 바꿀 수 없습니다');
    fs.mkdirSync(ctx.defaultRecordingsDir, { recursive: true });
    ctx.setRecordingsDir(ctx.defaultRecordingsDir);
    ctx.dictation.saveSettings({ recordingsDir: null });
    ctx.mergePortableSettings();
    ctx.writePortableSettings();
    return { dir: ctx.defaultRecordingsDir, isDefault: true };
  });

  ipc.on('app:openRecordings', () => {
    fs.mkdirSync(ctx.recordingsDir(), { recursive: true });
    ctx.shell.openPath(ctx.recordingsDir());
  });
}
