// 권한 확인 / 요청 (perm:*) — 가짜 권한 상태·도우미·시스템 설정
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeIpc, type FakeIpc } from '../test/ipc.mjs';
import { registerPermissions, type PermissionStatus } from './permissions.mjs';

let ipc: FakeIpc;
let status: PermissionStatus;
let calls: unknown[];

beforeEach(() => {
  ipc = fakeIpc();
  calls = [];
  status = { microphone: 'granted', inputMonitoring: 'granted', systemAudio: 'granted', accessibility: 'granted' };
  registerPermissions(ipc, {
    permissionStatus: async () => {
      calls.push('status');
      return { ...status };
    },
    runPermissionsHelper: async (args) => (calls.push(['helper', ...args]), null),
    fnUsageWarning: () => '경고',
    systemPreferences: { askForMediaAccess: async (m) => (calls.push(['askForMediaAccess', m]), true) },
    shell: { openExternal: (url) => calls.push(['open', url]) },
  });
});

const pane = (p: string) => ['open', `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${p}`];

describe('perm:*', () => {
  it('받는 채널은 다섯', () => {
    expect(ipc.channels()).toEqual(['handle perm:fnKey', 'handle perm:request', 'handle perm:status', 'on perm:openKeyboard', 'on perm:openSettings']);
  });

  it('상태·fn 키 경고는 그대로 넘기고, 키보드 설정·권한 설정 창을 연다', async () => {
    expect(await ipc.invoke('perm:status')).toEqual(status);
    expect(await ipc.invoke('perm:fnKey')).toBe('경고');
    ipc.send('perm:openKeyboard');
    ipc.send('perm:openSettings', 'files');
    ipc.send('perm:openSettings', 'nope'); // 모르는 이름은 예전처럼 ?undefined
    expect(calls).toEqual(['status', ['open', 'x-apple.systempreferences:com.apple.Keyboard-Settings.extension'], pane('Privacy_FilesAndFolders'), pane('undefined')]);
  });

  it('마이크: 정하지 않았을 때만 묻는다, 거부했으면 설정 창', async () => {
    status.microphone = 'not-determined';
    await ipc.invoke('perm:request', 'microphone');
    status.microphone = 'denied';
    await ipc.invoke('perm:request', 'microphone');
    expect(calls).toEqual(['status', ['askForMediaAccess', 'microphone'], 'status', 'status', pane('Privacy_Microphone'), 'status']);
  });

  it('입력 모니터링·손쉬운 사용: 도우미로 목록에 넣은 뒤 설정 창을 연다', async () => {
    status.inputMonitoring = 'denied';
    status.accessibility = 'unknown';
    await ipc.invoke('perm:request', 'inputMonitoring');
    await ipc.invoke('perm:request', 'accessibility');
    expect(calls).toEqual([
      'status', ['helper', 'request', 'input'], pane('Privacy_ListenEvent'), 'status',
      'status', ['helper', 'request', 'accessibility'], pane('Privacy_Accessibility'), 'status',
    ]);
  });

  it('시스템 오디오: 모르면 도우미로 묻고, 거부했으면 설정 창', async () => {
    status.systemAudio = 'unknown';
    await ipc.invoke('perm:request', 'systemAudio');
    status.systemAudio = 'denied';
    await ipc.invoke('perm:request', 'systemAudio');
    expect(calls).toEqual(['status', ['helper', 'request', 'audio'], 'status', 'status', pane('Privacy_AudioCapture'), 'status']);
  });

  it('이미 허용했으면 아무것도 열지 않고, 끝나면 새로 읽은 상태를 돌려준다', async () => {
    let n = 0;
    const before = status;
    const r = await ipc.invoke('perm:request', 'accessibility');
    expect(r).toEqual(before);
    for (const c of calls) if (c === 'status') n++;
    expect(n).toBe(2);
    expect(calls.filter((c) => c !== 'status')).toEqual([]);
  });

  it('상태에 없는 이름(파일 접근)은 설정 창을 연다', async () => {
    await ipc.invoke('perm:request', 'files');
    expect(calls).toEqual(['status', pane('Privacy_FilesAndFolders'), 'status']);
  });
});
