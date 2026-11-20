// 질문으로 회의 찾기 연결 (ask:*, 엔진에 넘길 회의 목록)
import { describe, expect, it } from 'vitest';
import { fakeIpc } from '../test/ipc.mjs';
import { registerAsk } from './ask.mjs';
import type { FolderItem } from './history.mjs';

const folder = (id: string, minutes: FolderItem['minutes'], review: FolderItem['review'], extra: Partial<FolderItem> = {}): FolderItem => ({
  id,
  dir: `/가짜/${id}`,
  mode: 'meeting',
  startedAt: `${id}Z`,
  durationSec: 60,
  tracks: ['mic'],
  speakersHint: null,
  firstFile: 'mic.wav',
  transcript: null,
  minutes,
  summary: null,
  review,
  audio: null,
  ...extra,
});

describe('ask', () => {
  it('처리기는 받은 인자를 질문 엔진에 그대로 넘기고 돌려받은 것을 돌려준다', async () => {
    const ipc = fakeIpc();
    const calls: unknown[] = [];
    registerAsk(ipc, {
      ask: {
        start: (q, s) => (calls.push(['start', q, s]), { id: 'j1' }),
        list: () => (calls.push(['list']), []),
        stop: (id) => calls.push(['stop', id]),
        remove: (id) => calls.push(['remove', id]),
        seen: (id) => calls.push(['seen', id]),
      },
      listFolders: () => [],
    });
    expect(ipc.channels()).toEqual(['handle ask:list', 'handle ask:remove', 'handle ask:seen', 'handle ask:start', 'handle ask:stop']);
    expect(await ipc.invoke('ask:start', '무엇을 정했나', { ids: ['a'] })).toEqual({ id: 'j1' });
    expect(await ipc.invoke('ask:list')).toEqual([]);
    await ipc.invoke('ask:stop', 'j1');
    await ipc.invoke('ask:remove', 'j1');
    await ipc.invoke('ask:seen', 'j1');
    expect(calls).toEqual([['start', '무엇을 정했나', { ids: ['a'] }], ['list'], ['stop', 'j1'], ['remove', 'j1'], ['seen', 'j1']]);
  });

  it('회의 목록: 회의만, 화면의 meetState와 같은 상태 말로, 부를 때의 목록을', () => {
    let folders: FolderItem[] = [];
    const { askMeetings } = registerAsk(fakeIpc(), { ask: { start() {}, list() {}, stop() {}, remove() {}, seen() {} }, listFolders: () => folders });
    expect(askMeetings()).toEqual([]);
    folders = [
      folder('busy-q', { status: 'queued' }, null),
      folder('busy-t', { status: 'transcribe' }, null),
      folder('busy-w', { status: 'write' }, null),
      folder('fail', { status: 'error' }, null),
      folder('short', { status: 'short' }, null),
      folder('empty', { status: 'empty' }, null),
      folder('none', null, null),
      folder('done-no-review', { status: 'done', title: '제목' }, null, { summary: '요약' }),
      folder('done-final', { status: 'done' }, { open: 2, total: 3, finalized: true }),
      folder('open', { status: 'done' }, { open: 1, total: 3, finalized: false }),
      folder('draft', { status: 'done' }, { open: 0, total: 3, finalized: false }),
      folder('done-zero', { status: 'done' }, { open: 0, total: 0, finalized: false }),
      folder('memo', { status: 'done' }, null, { mode: 'memo' }),
    ];
    const got = askMeetings();
    expect(got.map((m) => [m.id, m.status])).toEqual([
      ['busy-q', 'busy'], ['busy-t', 'busy'], ['busy-w', 'busy'], ['fail', 'fail'], ['short', 'short'], ['empty', 'short'], ['none', 'none'],
      ['done-no-review', 'done'], ['done-final', 'done'], ['open', 'open'], ['draft', 'draft'], ['done-zero', 'done'],
    ]);
    expect(got[7]).toEqual({ id: 'done-no-review', dir: '/가짜/done-no-review', startedAt: 'done-no-reviewZ', title: '제목', summary: '요약', status: 'done' });
    expect(got[0]).toMatchObject({ title: null, summary: null });
  });
});
