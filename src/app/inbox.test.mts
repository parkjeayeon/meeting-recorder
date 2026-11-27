// 설정 › 폰 녹음: 받을 폴더 고르기·열기 (inbox:chooseDir·inbox:open, 결정 84) — 임시 폴더로
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import { overlaps, registerInbox, type InboxContext } from './inbox.mjs';

let root: string;
let ipc: FakeIpc;
let calls: unknown[];
let answers: { canceled: boolean; filePaths: string[] }[];
let inbox: string | null;
let rec: string;
const WIN = { name: '메인 창' };

beforeEach(() => {
  root = tmpDir('mr-inbox-');
  rec = path.join(root, 'Documents', 'MeetingRecorder');
  fs.mkdirSync(rec, { recursive: true });
  fs.mkdirSync(path.join(root, 'Drive', '녹음'), { recursive: true });
  calls = [];
  answers = [];
  inbox = null;
  ipc = fakeIpc();
  const ctx: InboxContext = {
    recordingsDir: () => rec,
    inboxDir: () => inbox,
    home: () => root,
    win: () => WIN,
    dialog: {
      showOpenDialog: async (win, opts) => {
        calls.push(['showOpenDialog', win, opts.defaultPath, opts.properties]);
        return answers.shift()!;
      },
    },
    shell: { openPath: (p) => calls.push(['openPath', p]) },
  };
  registerInbox(ipc, ctx);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const pick = (dir: string | null) => answers.push(dir ? { canceled: false, filePaths: [dir] } : { canceled: true, filePaths: [] });

describe('overlaps', () => {
  it('같거나 한쪽이 다른 쪽 안이면 겹침, 이름 앞부분만 같은 옆 폴더는 겹치지 않음', () => {
    expect(overlaps(rec, rec)).toBe(true);
    expect(overlaps(rec + path.sep, rec)).toBe(true);
    expect(overlaps(path.join(rec, '폰'), rec)).toBe(true);
    expect(overlaps(path.join(root, 'Documents'), rec)).toBe(true);
    expect(overlaps(root, rec)).toBe(true);
    expect(overlaps(rec + '-폰', rec)).toBe(false);
    expect(overlaps(path.join(root, 'Drive', '녹음'), rec)).toBe(false);
  });

  it('이어진 링크를 풀어 본다 — 링크로 가리킨 녹음 폴더도 겹침', () => {
    const link = path.join(root, '바로가기');
    fs.symlinkSync(rec, link);
    expect(overlaps(link, rec)).toBe(true);
    expect(overlaps(path.join(link, '안'), rec)).toBe(true);
  });
});

describe('inbox:chooseDir', () => {
  it('받는 채널은 고르기·열기 둘', () => {
    expect(ipc.channels()).toEqual(['handle inbox:chooseDir', 'on inbox:open']);
  });

  it('폴더만 고르고 새 폴더를 만들 수 있게 연다 — 처음은 홈, 고른 적이 있으면 그 폴더에서', async () => {
    pick(null);
    expect(await ipc.invoke('inbox:chooseDir')).toBeNull();
    inbox = path.join(root, 'Drive', '녹음');
    pick(null);
    await ipc.invoke('inbox:chooseDir');
    expect(calls).toEqual([
      ['showOpenDialog', WIN, root, ['openDirectory', 'createDirectory']],
      ['showOpenDialog', WIN, inbox, ['openDirectory', 'createDirectory']],
    ]);
  });

  it('겹치지 않는 폴더는 그 경로를 돌려준다 (저장은 화면이 설정 저장으로)', async () => {
    const dir = path.join(root, 'Drive', '녹음');
    pick(dir);
    expect(await ipc.invoke('inbox:chooseDir')).toEqual({ ok: true, dir });
  });

  it('녹음 폴더와 같거나·그 안이거나·그것을 품은 폴더는 overlap', async () => {
    for (const dir of [rec, path.join(rec, '2026-01-01_09-00-00_meeting'), path.join(root, 'Documents')]) {
      pick(dir);
      expect(await ipc.invoke('inbox:chooseDir')).toEqual({ ok: false, reason: 'overlap' });
    }
  });
});

describe('inbox:open', () => {
  it('저장된 받을 폴더만 연다 — 없으면 아무것도 하지 않는다', () => {
    ipc.send('inbox:open');
    expect(calls).toEqual([]);
    inbox = path.join(root, 'Drive', '녹음');
    ipc.send('inbox:open');
    expect(calls).toEqual([['openPath', inbox]]);
  });
});
