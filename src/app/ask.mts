// ── 질문으로 회의 찾기 (src/ask.js, 결정 51): 메인 프로세스에서 돌아 화면을 옮기거나 창을 닫아도 이어진다 ──
// src/main.js에서 옮김 (결정 70). 질문 엔진(src/ask.js)과 회의 목록(기록 구역의 listFolders)은 본체가 넘긴다.
// 엔진을 켜는 askMod.init({ getMeetings: askMeetings, … })은 예전처럼 본체의 init()에서 — 그래서 askMeetings를 돌려준다.
import type { FolderItem } from './history.mjs';
import type { Ipc } from './ipc.mjs';

// 회의 상태는 화면의 meetState와 같은 말로 (done 확정·확인할 것 없음 / open 확인 남음 / draft 마치기 전 / fail / short / none 녹음만 / busy)
export type AskMeetingStatus = 'busy' | 'fail' | 'short' | 'none' | 'done' | 'open' | 'draft';
export interface AskMeeting {
  id: string;
  dir: string;
  startedAt: string | undefined;
  title: string | null;
  summary: string | null;
  status: AskMeetingStatus;
}

export interface AskContext {
  // src/ask.js의 내보낸 함수 (인자는 화면이 준 그대로 넘긴다)
  ask: {
    start(question: unknown, scope: unknown): unknown;
    list(): unknown;
    stop(id: unknown): unknown;
    remove(id: unknown): unknown;
    seen(id: unknown): unknown;
  };
  listFolders: () => FolderItem[];
}

export function registerAsk(ipc: Ipc, ctx: AskContext): { askMeetings: () => AskMeeting[] } {
  function askMeetings(): AskMeeting[] {
    return ctx.listFolders().filter((r) => r.mode === 'meeting').map((r) => {
      const s = r.minutes?.status;
      const rv = r.review;
      const status = ['queued', 'transcribe', 'write'].includes(s as string) ? 'busy' : s === 'error' ? 'fail' : s === 'short' || s === 'empty' ? 'short' : s !== 'done' ? 'none'
        : !rv || rv.finalized ? 'done' : rv.open ? 'open' : rv.total ? 'draft' : 'done';
      return { id: r.id, dir: r.dir, startedAt: r.startedAt, title: r.minutes?.title ?? null, summary: r.summary ?? null, status };
    });
  }
  ipc.handle('ask:start', (_e, question, scope) => ctx.ask.start(question, scope));
  ipc.handle('ask:list', () => ctx.ask.list());
  ipc.handle('ask:stop', (_e, id) => ctx.ask.stop(id));
  ipc.handle('ask:remove', (_e, id) => ctx.ask.remove(id));
  ipc.handle('ask:seen', (_e, id) => ctx.ask.seen(id));
  return { askMeetings };
}
