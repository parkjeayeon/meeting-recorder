// 녹음 폴더 바꾸기 (recordings:choose·reset, app:openRecordings) — 임시 폴더에 지어낸 녹음으로
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import { moveEntry, registerRecordingsFolder, type RecordingsFolderContext } from './recordings.mjs';

let root: string;
let ipc: FakeIpc;
let calls: unknown[];
let current: string;
let recording: unknown;
let dialogAnswers: unknown[];
let ctx: RecordingsFolderContext;
const WIN = { name: '메인 창' };

const write = (file: string, text = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

beforeEach(() => {
  root = tmpDir('mr-recfolder-');
  current = path.join(root, 'rec');
  write(path.join(current, '2026-01-01_09-00-00_meeting', 'meta.json'), '{"from":"rec"}');
  write(path.join(current, '2026-01-02_10-00-00_memo', 'mic.wav'));
  write(path.join(current, '2026-01-03_11-00-00_meeting', 'meta.json'), '{"n":3}');
  write(path.join(current, 'dictations.jsonl'), '{"id":"d1"}\n');
  write(path.join(current, 'settings.json'), '{"vocabulary":"가짜"}');
  write(path.join(current, 'notes.txt')); // 녹음이 아닌 것은 옮기지 않는다
  write(path.join(root, 'dest', '2026-01-01_09-00-00_meeting', 'meta.json'), '{"from":"dest"}'); // 같은 이름이 이미 있음
  calls = [];
  recording = null;
  dialogAnswers = [];
  ipc = fakeIpc();
  ctx = {
    recordingsDir: () => current,
    defaultRecordingsDir: path.join(root, 'default'),
    setRecordingsDir: (dir) => {
      calls.push(['setRecordingsDir', dir]);
      current = dir;
    },
    recording: () => recording,
    activeMinutes: new Set<string>(),
    mergePortableSettings: () => (calls.push(['merge']), false),
    writePortableSettings: () => void calls.push(['write']),
    updateTray: () => void calls.push(['updateTray']),
    win: () => WIN,
    dialog: {
      showOpenDialog: async (win, opts) => {
        calls.push(['showOpenDialog', win, opts.defaultPath]);
        return dialogAnswers.shift() as { canceled: boolean; filePaths: string[] };
      },
      showMessageBox: async (win, opts) => {
        calls.push(['showMessageBox', win, opts.detail]);
        return dialogAnswers.shift() as { response: number };
      },
    },
    shell: { openPath: (p) => calls.push(['openPath', p]) },
    dictation: { saveSettings: (patch) => calls.push(['saveSettings', patch]) },
  };
  registerRecordingsFolder(ipc, ctx);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const pick = (dir: string | null) => dialogAnswers.push(dir ? { canceled: false, filePaths: [dir] } : { canceled: true, filePaths: [] });
const ls = (dir: string) => fs.readdirSync(dir).sort();

describe('recordings:choose', () => {
  it('받는 채널은 셋', () => {
    expect(ipc.channels()).toEqual(['handle recordings:choose', 'handle recordings:reset', 'on app:openRecordings']);
  });

  it('녹음 중이거나 회의록을 만드는 중이면 대화상자도 띄우지 않고 막는다', async () => {
    recording = { dir: path.join(current, 'x') };
    await expect(ipc.invoke('recordings:choose')).rejects.toThrow('녹음 중이거나 회의록을 만드는 중에는 바꿀 수 없습니다');
    recording = null;
    (ctx.activeMinutes as Set<string>).add(path.join(current, '2026-01-03_11-00-00_meeting'));
    await expect(ipc.invoke('recordings:choose')).rejects.toThrow('녹음 중이거나 회의록을 만드는 중에는 바꿀 수 없습니다');
    await expect(ipc.invoke('recordings:reset')).rejects.toThrow('녹음 중이거나 회의록을 만드는 중에는 바꿀 수 없습니다');
    expect(calls).toEqual([]);
    expect(current).toBe(path.join(root, 'rec'));
  });

  it('고르지 않으면 null, 같은 폴더를 고르면 그대로', async () => {
    pick(null);
    expect(await ipc.invoke('recordings:choose')).toBeNull();
    pick(current);
    expect(await ipc.invoke('recordings:choose')).toEqual({ dir: current, moved: 0, skipped: 0 });
    // 대화상자의 처음 자리는 부를 때의 녹음 폴더, 창은 부를 때의 창
    expect(calls).toEqual([['showOpenDialog', WIN, path.join(root, 'rec')], ['showOpenDialog', WIN, path.join(root, 'rec')]]);
  });

  it('고른 폴더가 없거나 쓸 수 없으면 실패하고 아무것도 바꾸지 않는다', async () => {
    pick(path.join(root, 'missing'));
    await expect(ipc.invoke('recordings:choose')).rejects.toThrow('이 폴더에는 쓸 수 없습니다');
    const ro = path.join(root, 'readonly');
    fs.mkdirSync(ro);
    fs.chmodSync(ro, 0o500);
    pick(ro);
    await expect(ipc.invoke('recordings:choose')).rejects.toThrow('이 폴더에는 쓸 수 없습니다');
    fs.chmodSync(ro, 0o700);
    expect(calls.map((c) => (c as unknown[])[0])).toEqual(['showOpenDialog', 'showOpenDialog']);
    expect(current).toBe(path.join(root, 'rec'));
  });

  it('옮기기: 녹음·받아쓰기 기록·설정만 옮기고, 같은 이름이 있으면 덮어쓰지 않고 건너뛴다', async () => {
    const dest = path.join(root, 'dest');
    pick(dest);
    dialogAnswers.push({ response: 0 });
    const r = await ipc.invoke('recordings:choose');
    expect(r).toEqual({ dir: dest, moved: 4, skipped: 1, total: 5, isDefault: false });
    expect(ls(dest)).toEqual(['2026-01-01_09-00-00_meeting', '2026-01-02_10-00-00_memo', '2026-01-03_11-00-00_meeting', 'dictations.jsonl', 'settings.json']);
    expect(fs.readFileSync(path.join(dest, '2026-01-01_09-00-00_meeting', 'meta.json'), 'utf8')).toBe('{"from":"dest"}');
    expect(ls(path.join(root, 'rec'))).toEqual(['2026-01-01_09-00-00_meeting', 'notes.txt']); // 건너뛴 것과 녹음 아닌 것은 남는다
    expect(fs.readFileSync(path.join(dest, '2026-01-03_11-00-00_meeting', 'meta.json'), 'utf8')).toBe('{"n":3}');
    // 묻는 글은 회의 수(_meeting 폴더)와 받아쓰기 기록이 있는지. 폴더를 바꾼 뒤 설정 합치기 → 백업 → 설정 저장 → 메뉴바
    expect(calls).toEqual([
      ['showOpenDialog', WIN, path.join(root, 'rec')],
      ['showMessageBox', WIN, '회의 2개와 받아쓰기 기록을 옮깁니다. 옮기지 않으면 이전 녹음은 원래 폴더에 남고 앱에서는 보이지 않습니다.'],
      ['setRecordingsDir', dest],
      ['merge'],
      ['write'],
      ['saveSettings', { recordingsDir: dest }],
      ['updateTray'],
    ]);
  });

  it('옮기지 않고 바꾸기: 파일은 그대로 두고 폴더만 바꾼다. 취소하면 아무것도 안 한다', async () => {
    const dest = path.join(root, 'dest');
    pick(dest);
    dialogAnswers.push({ response: 2 });
    expect(await ipc.invoke('recordings:choose')).toBeNull();
    expect(current).toBe(path.join(root, 'rec'));
    pick(dest);
    dialogAnswers.push({ response: 1 });
    expect(await ipc.invoke('recordings:choose')).toEqual({ dir: dest, moved: 0, skipped: 0, total: 5, isDefault: false });
    expect(ls(path.join(root, 'rec'))).toHaveLength(6);
    expect(ls(dest)).toEqual(['2026-01-01_09-00-00_meeting']);
    expect(current).toBe(dest);
  });

  it('지금 폴더에 옮길 것이 없거나 폴더가 사라졌으면 묻지 않고 바꾼다. 기본 폴더를 고르면 설정에는 null', async () => {
    fs.rmSync(path.join(root, 'rec'), { recursive: true });
    const def = ctx.defaultRecordingsDir;
    fs.mkdirSync(def);
    pick(def);
    expect(await ipc.invoke('recordings:choose')).toEqual({ dir: def, moved: 0, skipped: 0, total: 0, isDefault: true });
    expect(calls.filter((c) => (c as unknown[])[0] === 'showMessageBox')).toEqual([]);
    expect(calls).toContainEqual(['saveSettings', { recordingsDir: null }]);
  });

  it('하나를 옮기다 실패하면 건너뛴 것으로 세고 나머지는 옮긴다', async () => {
    const dest = path.join(root, 'dest');
    const rename = fs.promises.rename;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (String(from).endsWith('dictations.jsonl')) throw Object.assign(new Error('막힘'), { code: 'EACCES' });
      return rename(from, to);
    });
    pick(dest);
    dialogAnswers.push({ response: 0 });
    expect(await ipc.invoke('recordings:choose')).toMatchObject({ moved: 3, skipped: 2, total: 5 });
    expect(fs.existsSync(path.join(root, 'rec', 'dictations.jsonl'))).toBe(true);
  });
});

describe('moveEntry', () => {
  it('다른 디스크(EXDEV)면 복사한 뒤 원본을 지운다', async () => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    const cp = vi.spyOn(fs.promises, 'cp');
    const rm = vi.spyOn(fs.promises, 'rm');
    const from = path.join(root, 'rec', '2026-01-03_11-00-00_meeting');
    const to = path.join(root, 'dest', '2026-01-03_11-00-00_meeting');
    await moveEntry(from, to);
    expect(fs.readFileSync(path.join(to, 'meta.json'), 'utf8')).toBe('{"n":3}');
    expect(fs.existsSync(from)).toBe(false);
    expect(cp.mock.invocationCallOrder[0]).toBeLessThan(rm.mock.invocationCallOrder[0]!);
    expect(cp).toHaveBeenCalledWith(from, to, { recursive: true, errorOnExist: true, force: false });
  });

  it('복사할 곳에 같은 이름이 있으면 덮어쓰지 않고 실패하며 원본을 지우지 않는다', async () => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
    const from = path.join(root, 'rec', 'settings.json');
    const to = path.join(root, 'dest', 'settings.json');
    write(to, '{"keep":true}');
    await expect(moveEntry(from, to)).rejects.toThrow();
    expect(fs.readFileSync(to, 'utf8')).toBe('{"keep":true}');
    expect(fs.existsSync(from)).toBe(true);
  });

  it('EXDEV가 아닌 실패는 그대로 던진다', async () => {
    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('없음'), { code: 'ENOENT' }));
    const cp = vi.spyOn(fs.promises, 'cp');
    await expect(moveEntry(path.join(root, 'nope'), path.join(root, 'dest', 'nope'))).rejects.toThrow('없음');
    expect(cp).not.toHaveBeenCalled();
  });
});

describe('recordings:reset · app:openRecordings', () => {
  it('기본 폴더를 만들고 바꾼 뒤 설정에서 지우고, 설정을 합쳐 백업한다', async () => {
    expect(await ipc.invoke('recordings:reset')).toEqual({ dir: ctx.defaultRecordingsDir, isDefault: true });
    expect(fs.statSync(ctx.defaultRecordingsDir).isDirectory()).toBe(true);
    expect(calls).toEqual([['setRecordingsDir', ctx.defaultRecordingsDir], ['saveSettings', { recordingsDir: null }], ['merge'], ['write']]);
  });

  it('녹음 폴더 열기는 부를 때의 폴더를 만들고 연다', () => {
    current = path.join(root, 'later', 'rec');
    ipc.send('app:openRecordings');
    expect(fs.statSync(current).isDirectory()).toBe(true);
    expect(calls).toEqual([['openPath', current]]);
  });
});
