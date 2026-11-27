// ── 설정 › 폰 녹음: 받을 폴더 고르기·열기 (결정 84) ─────────────────────────────
// 폰으로 녹음한 파일을 Google Drive에 올리면 Drive 데스크톱 앱이 Mac에 내려 두는 폴더를 고른다. 값은 화면이 기존 설정 저장(dict:saveSettings)으로
// inboxDir에 저장한다 — 여기서는 고르기 창을 띄우고, 녹음 폴더와 겹치는지만 본다. 폴더를 지켜보는 일(새 녹음 → 회의)은 아직 없다.
import fs from 'node:fs';
import path from 'node:path';
import type { FolderDialog } from './recordings.mjs';
import type { Ipc } from './ipc.mjs';

export type InboxChoice = { ok: true; dir: string } | { ok: false; reason: 'overlap' } | null;

export interface InboxContext {
  recordingsDir: () => string; // 지금 녹음 폴더 (부를 때 읽는다)
  inboxDir: () => string | null; // 저장된 받을 폴더
  home: () => string; // 처음 고를 때 여는 자리
  win: () => unknown;
  dialog: Pick<FolderDialog, 'showOpenDialog'>;
  shell: { openPath(p: string): unknown };
}

// 이어진 링크(/tmp → /private/tmp 같은)까지 풀어 본다. 아직 없는 폴더면 있는 데까지 풀고 나머지를 붙인다
// (한쪽만 풀면 /var/… 와 /private/var/… 처럼 같은 자리가 달라 보인다)
const real = (p: string): string => {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(real(parent), path.basename(abs));
  }
};

/** 두 폴더가 같거나 한쪽이 다른 쪽 안에 있으면 참 */
export function overlaps(a: string, b: string): boolean {
  const x = real(a);
  const y = real(b);
  const inside = (child: string, parent: string) => child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  return x === y || inside(x, y) || inside(y, x);
}

export function registerInbox(ipc: Ipc, ctx: InboxContext): void {
  ipc.handle('inbox:chooseDir', async (): Promise<InboxChoice> => {
    const picked = await ctx.dialog.showOpenDialog(ctx.win(), {
      title: '폰 녹음을 받을 폴더 고르기',
      defaultPath: ctx.inboxDir() ?? ctx.home(),
      buttonLabel: '이 폴더 사용',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const dir = path.resolve(picked.filePaths[0]);
    // 녹음 폴더와 겹치면 처리한 녹음을 옮기거나 회의록을 복사할 때 서로의 파일을 건드리게 된다
    if (overlaps(dir, ctx.recordingsDir())) return { ok: false, reason: 'overlap' };
    return { ok: true, dir };
  });

  // 열기는 녹음 폴더 열기(app:openRecordings)와 같게 — 경로는 화면에서 받지 않고 저장된 값을 연다
  ipc.on('inbox:open', () => {
    const dir = ctx.inboxDir();
    if (dir) ctx.shell.openPath(dir);
  });
}
