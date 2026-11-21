// 회의 페이지 처리기 (meeting.mts)와 파일 지켜보기 (watch.mts) — 임시 녹음 폴더, 가짜 회의록·압축·대화상자로
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, tmpDir, type FakeIpc } from '../test/ipc.mjs';
import { registerMeeting, type MeetingContext } from './meeting.mjs';
import { registerWatchers, type Watchers } from './watch.mjs';

let root: string;
let ipc: FakeIpc;
let calls: unknown[][];
let recording: { dir: string } | null;
let active: Set<string>;
let saveAnswer: { canceled: boolean; filePath?: string };

const recordingDir = (dir: unknown) => {
  const resolved = path.resolve(dir as string);
  if (path.dirname(resolved) !== root) throw new Error('녹음 폴더가 아닙니다');
  return resolved;
};

beforeEach(() => {
  root = tmpDir('mr-meeting-');
  ipc = fakeIpc();
  calls = [];
  recording = null;
  active = new Set();
  saveAnswer = { canceled: true };
  const ctx: MeetingContext = {
    recordingsDir: () => root,
    recordingDir,
    recording: () => recording,
    activeMinutes: active,
    runMinutes: async (dir, speakers, opts) => void calls.push(['runMinutes', dir, speakers, opts]),
    minutes: {
      canResume: (dir) => dir.endsWith('ok_meeting'),
      renameSpeaker: (dir, from, to) => void calls.push(['renameSpeaker', dir, from, to]),
    } as Partial<MeetingContext['minutes']> as MeetingContext['minutes'],
    compress: {
      compressMeeting: async (dir) => (calls.push(['compress', dir]), { before: 2, after: 1 }),
      declineCompress: (dir, declined) => void calls.push(['decline', dir, declined]),
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async (win, opts) => (calls.push(['showSaveDialog', win, opts.defaultPath]), saveAnswer),
    },
    shell: { trashItem: async (p) => void calls.push(['trash', p]) },
    win: () => 'WIN',
    downloads: () => path.join(root, '..'),
  };
  registerMeeting(ipc, ctx);
});

const meeting = (name = '2026-01-01_09-00-00_meeting') => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe('경로 확인', () => {
  it('녹음 폴더 밖의 경로는 어느 처리기도 받지 않는다', async () => {
    const outside = path.join(root, '..', 'elsewhere');
    for (const ch of ['minutes:make', 'minutes:resume', 'meeting:compress', 'meeting:compressDecline', 'speaker:rename', 'minutes:read', 'actions:make', 'flow:make', 'glossary:make', 'minutes:todo', 'meeting:trash', 'script:clean']) {
      await expect(ipc.invoke(ch, outside), ch).rejects.toThrow('녹음 폴더가 아닙니다');
    }
    expect(calls).toEqual([]);
  });
});

describe('회의록', () => {
  it('minutes:make: 참석 인원은 숫자로, 아니면 자동(null)', async () => {
    const d = meeting();
    await ipc.invoke('minutes:make', d, '3');
    await ipc.invoke('minutes:make', d, 'x');
    expect(calls).toEqual([['runMinutes', d, 3, undefined], ['runMinutes', d, null, undefined]]);
  });

  it('minutes:resume: 만드는 중이면 아무것도, 이어 쓸 녹취가 없으면 던지고, 있으면 이어서', async () => {
    const no = meeting();
    const ok = meeting('2026-01-02_09-00-00_ok_meeting');
    active.add(no);
    await ipc.invoke('minutes:resume', no);
    expect(calls).toEqual([]);
    active.clear();
    await expect(ipc.invoke('minutes:resume', no)).rejects.toThrow('이어서 쓸 녹취가 없습니다');
    await ipc.invoke('minutes:resume', ok);
    expect(calls).toEqual([['runMinutes', ok, null, { resume: true }]]);
  });

  it('minutes:todo: n번째 할 일 체크만 뒤집는다', async () => {
    const d = meeting();
    fs.writeFileSync(path.join(d, 'minutes.md'), '# 회의\n- [ ] 하나\n  - [X] 둘\n- 그냥\n- [ ] 셋\n');
    expect(await ipc.invoke('minutes:todo', d, 1, false)).toBe('# 회의\n- [ ] 하나\n  - [ ] 둘\n- 그냥\n- [ ] 셋\n');
    expect(await ipc.invoke('minutes:todo', d, 2, true)).toBe('# 회의\n- [ ] 하나\n  - [ ] 둘\n- 그냥\n- [x] 셋\n');
    expect(fs.readFileSync(path.join(d, 'minutes.md'), 'utf8')).toBe('# 회의\n- [ ] 하나\n  - [ ] 둘\n- 그냥\n- [x] 셋\n');
  });
});

describe('압축·지우기', () => {
  it('meeting:compress: 녹음 중·회의록을 만드는 중이면 막고, 같은 회의를 두 번 동시에 압축하지 않는다', async () => {
    const d = meeting();
    recording = { dir: d };
    await expect(ipc.invoke('meeting:compress', d)).rejects.toThrow('녹음 중이거나 회의록을 만드는 중에는');
    recording = null;
    active.add(d);
    await expect(ipc.invoke('meeting:compress', d)).rejects.toThrow('녹음 중이거나 회의록을 만드는 중에는');
    active.clear();
    const first = ipc.invoke('meeting:compress', d);
    await expect(ipc.invoke('meeting:compress', d)).rejects.toThrow('이미 압축하고 있습니다');
    expect(await first).toEqual({ before: 2, after: 1 });
    expect(await ipc.invoke('meeting:compress', d)).toEqual({ before: 2, after: 1 }); // 끝나면 다시 할 수 있다
    await ipc.invoke('meeting:compressDecline', d);
    expect(calls.at(-1)).toEqual(['decline', d, true]);
  });

  it('meeting:trash: 만드는 중·녹음 중·폴더가 아니면 막고, 아니면 휴지통으로', async () => {
    const d = meeting();
    active.add(d);
    await expect(ipc.invoke('meeting:trash', d)).rejects.toThrow('회의록을 만드는 중에는 지울 수 없습니다');
    active.clear();
    recording = { dir: d };
    await expect(ipc.invoke('meeting:trash', d)).rejects.toThrow('녹음 중인 폴더는 지울 수 없습니다');
    recording = null;
    fs.writeFileSync(path.join(root, 'settings.json'), '{}');
    await expect(ipc.invoke('meeting:trash', path.join(root, 'settings.json'))).rejects.toThrow('회의 폴더가 아닙니다');
    await ipc.invoke('meeting:trash', d);
    expect(calls).toEqual([['trash', d]]);
  });
});

describe('흐름도 SVG 저장', () => {
  it('SVG가 아니거나 너무 크면 던지고, 이름은 파일에 쓸 수 있게 다듬어 다운로드 폴더에, 취소하면 null', async () => {
    await expect(ipc.invoke('flow:saveSvg', 'x', '<svg/>')).rejects.toThrow('저장할 그림이 올바르지 않습니다');
    await expect(ipc.invoke('flow:saveSvg', 'x', 1)).rejects.toThrow('저장할 그림이 올바르지 않습니다');
    const svg = '<?xml version="1.0"?><svg/>';
    expect(await ipc.invoke('flow:saveSvg', 'a/b:c*\n', svg)).toBe(null);
    expect(calls.at(-1)).toEqual(['showSaveDialog', 'WIN', path.join(root, '..', 'a b c.svg')]);
    await ipc.invoke('flow:saveSvg', null, svg);
    expect(calls.at(-1)).toEqual(['showSaveDialog', 'WIN', path.join(root, '..', '흐름도.svg')]);
    const file = path.join(root, 'out.svg');
    saveAnswer = { canceled: false, filePath: file };
    expect(await ipc.invoke('flow:saveSvg', '이름', svg)).toBe(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(svg);
  });
});

describe('파일 지켜보기', () => {
  let sent: [string, unknown][];
  let watchers: Watchers;
  let listeners: Map<string, (ev: string, name: string | null) => void>;
  let closed: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    listeners = new Map();
    closed = [];
    const w = fakeIpc();
    ipc = w;
    const watch = ((dir: string, fn: (ev: string, name: string | null) => void) => {
      if (!fs.existsSync(dir)) throw new Error('ENOENT');
      listeners.set(dir, fn);
      return { close: () => void closed.push(dir) };
    }) as unknown as typeof fs.watch;
    watchers = registerWatchers(w, { recordingsDir: () => root, recordingDir, send: (c, p) => void sent.push([c, p]), watch });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('녹음 폴더: 회의 폴더 이름만, 0.4초 모아 한 번 알린다', () => {
    watchers.dirChanged(); // 지켜보기 전이면 아무 일 없음
    expect(listeners.size).toBe(0);
    watchers.watchRecordings();
    const fire = listeners.get(root);
    fire?.('rename', 'settings.json');
    fire?.('rename', null);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([]);
    fire?.('rename', '2026-01-01_09-00-00_meeting');
    vi.advanceTimersByTime(300);
    fire?.('change', '2026-01-02_09-00-00_memo');
    vi.advanceTimersByTime(399);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([['recordings:changed', {}]]);
    watchers.dirChanged(); // 지켜보는 중이면 닫고 다시
    expect(closed).toEqual([root]);
  });

  it('회의 폴더: 화면이 쓰는 파일만 알리고, 다른 회의를 열면 앞의 것을 닫고, 빈 값이면 닫기만', async () => {
    const a = meeting();
    const b = meeting('2026-01-02_09-00-00_meeting');
    await ipc.invoke('meeting:watch', a);
    listeners.get(a)?.('change', 'mic.wav');
    listeners.get(a)?.('change', 'review.json');
    vi.advanceTimersByTime(400);
    expect(sent).toEqual([['meeting:changed', { id: '2026-01-01_09-00-00_meeting' }]]);
    await ipc.invoke('meeting:watch', b);
    expect(closed).toEqual([a]);
    await ipc.invoke('meeting:watch', null);
    expect(closed).toEqual([a, b]);
    await expect(ipc.invoke('meeting:watch', path.join(root, '..', 'x'))).rejects.toThrow('녹음 폴더가 아닙니다');
    await ipc.invoke('meeting:watch', path.join(root, '2026-01-03_gone')); // 없는 폴더는 조용히 넘어간다
  });
});
