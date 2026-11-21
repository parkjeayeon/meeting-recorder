// ── 파일이 바뀌면 화면을 다시 그린다 ─────────────────────────────────────────
// src/main.js에서 옮김 (결정 70). 열려 있는 회의 폴더(회의록·녹취·정리본·확인 필요·용어·화자 이름)와 녹음 폴더(회의가 생기거나 사라짐).
// 앱 안 작업은 원래 바로 다시 그리지만, 앱 밖에서 고치거나 다른 경로로 바뀐 경우에도 다시 열 필요가 없게 한다.
// 지켜보는 것 둘(meetingWatch·recordingsWatch)은 여기만 갖는다. 녹음 폴더·경로 확인·메인 창으로 보내기는 본체가 넘긴다.
import fs from 'node:fs';
import path from 'node:path';
import type { Ipc } from './ipc.mjs';

export const WATCHED = new Set(['minutes.md', 'transcript.txt', 'script-clean.txt', 'review.json', 'glossary.json', 'flow.json', 'actions.json', 'meta.json']);

export interface WatchContext {
  recordingsDir: () => string;
  recordingDir: (dir: unknown) => string; // 녹음 폴더 안이 아니면 던진다
  send: (channel: string, payload?: unknown) => void; // 메인 창으로
  watch?: typeof fs.watch; // 시험용 (기본은 fs.watch)
}

export interface Watchers {
  watchRecordings(): void; // 녹음 폴더를 (다시) 지켜본다
  dirChanged(): void; // 녹음 폴더가 바뀌었다 → 이미 지켜보던 중이면 새 폴더를 지켜본다
}

export function debounced(fn: () => void, ms = 400): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

export function registerWatchers(ipc: Ipc, ctx: WatchContext): Watchers {
  const watch = ctx.watch ?? fs.watch;
  let meetingWatch: fs.FSWatcher | null = null;
  let recordingsWatch: fs.FSWatcher | null = null;

  function watchRecordings(): void {
    recordingsWatch?.close();
    try {
      const changed = debounced(() => ctx.send('recordings:changed', {}));
      recordingsWatch = watch(ctx.recordingsDir(), (_ev, name) => name && /^\d{4}-\d{2}-\d{2}_/.test(String(name)) && changed());
    } catch {
      recordingsWatch = null;
    }
  }

  ipc.handle('meeting:watch', (_e, dir) => {
    meetingWatch?.close();
    meetingWatch = null;
    if (!dir) return;
    const d = ctx.recordingDir(dir);
    const changed = debounced(() => ctx.send('meeting:changed', { id: path.basename(d) }));
    try {
      meetingWatch = watch(d, (_ev, name) => WATCHED.has(String(name)) && changed());
    } catch {}
  });

  return {
    watchRecordings,
    dirChanged: () => {
      if (recordingsWatch) watchRecordings();
    },
  };
}
