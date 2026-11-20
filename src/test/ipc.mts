// src/app 시험용 가짜 ipcMain: register(ipc, ctx)가 등록한 처리기를 적어 두었다가 화면처럼 불러 본다. 같은 채널을 두 번 받으면 Electron처럼 실패한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Handler, Ipc } from '../app/ipc.mjs';

export interface FakeIpc extends Ipc {
  channels(): string[]; // '방식 채널' (check-ipc의 목록과 같은 모양)
  invoke(channel: string, ...args: unknown[]): Promise<unknown>; // ipcRenderer.invoke처럼: 처리기가 던지면 거부된 약속
  send(channel: string, ...args: unknown[]): void; // ipcRenderer.send처럼: 돌려주는 값은 버린다
}

export function fakeIpc(): FakeIpc {
  const handlers = new Map<string, { method: 'handle' | 'on'; fn: Handler }>();
  const add = (method: 'handle' | 'on', channel: string, fn: Handler) => {
    if (handlers.has(channel)) throw new Error(`'${channel}'을(를) 두 번 받음`);
    handlers.set(channel, { method, fn });
  };
  const get = (channel: string, method: 'handle' | 'on') => {
    const h = handlers.get(channel);
    if (!h || h.method !== method) throw new Error(`'${channel}'을(를) ${method}로 받는 곳이 없음`);
    return h.fn;
  };
  return {
    handle: (channel, fn) => add('handle', channel, fn),
    on: (channel, fn) => add('on', channel, fn),
    channels: () => [...handlers].map(([c, h]) => `${h.method} ${c}`).sort(),
    invoke: async (channel, ...args) => get(channel, 'handle')({}, ...args),
    send: (channel, ...args) => {
      get(channel, 'on')({}, ...args);
    },
  };
}

// 시험마다 새 임시 폴더 (실제 녹음 폴더·설정은 쓰지 않는다)
export const tmpDir = (name = 'mr-app-'): string => fs.mkdtempSync(path.join(os.tmpdir(), name));
