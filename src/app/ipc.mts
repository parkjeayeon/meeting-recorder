// src/app의 register(ipc, ctx)가 받는 ipcMain의 모양 — 쓰는 두 함수만 (결정 70).
// 본체는 Electron의 ipcMain을, 단위 시험은 받은 처리기를 적어 두었다 불러 보는 가짜(src/test/ipc.mts)를 넘긴다.
// 화면에서 오는 인자는 무엇이든 올 수 있으므로 unknown으로 받고 처리기 안에서 좁힌다.
export type Handler = (event: unknown, ...args: unknown[]) => unknown;

export interface Ipc {
  handle(channel: string, fn: Handler): void; // ipcRenderer.invoke로 부르는 것 (돌려주는 값이 화면으로 간다)
  on(channel: string, fn: Handler): void; // ipcRenderer.send로 알리는 것 (돌려주지 않는다)
}
