// ── 회의록 만들기 실행 ──────────────────────────────────────────────────────
// src/main.js에서 옮김 (결정 70). 지금 이 실행에서 만들고 있는 회의(activeMinutes)와 인터넷을 기다리는 회의(waitingOnline)·그 타이머는
// 여기만 갖는다. 다른 구역(기록·녹음 폴더 바꾸기·회의 페이지)은 돌려받은 Set을 읽기만 한다.
// 회의록 만들기 자체(src/minutes.js의 makeMinutes·canResume), 인터넷 연결(Electron net), 창으로 보내기는 본체가 넘긴다.
import path from 'node:path';
import * as core from '../core/index.mjs';
import { readJson } from './folders.mjs';
import type { FolderMeta } from './history.mjs';
import type { MinutesModule } from './connectors.mjs';

export const MIN_MEETING_SEC = 10; // 이보다 짧은 회의 녹음은 회의록을 만들지 않는다 (시험·실수 녹음)
export const ONLINE_POLL_MS = 15000;

export interface MinutesRunContext {
  minutes: Pick<MinutesModule, 'makeMinutes' | 'canResume'>;
  isOnline: () => boolean; // Electron net.isOnline
  send: (channel: string, payload?: unknown) => void; // 메인 창으로
  sendOverlay: (channel: string, payload?: unknown) => void; // 플로팅 독으로
}

export interface MinutesRun {
  runMinutes(dir: string, speakers?: number | null, opts?: { resume?: boolean }): Promise<void>;
  waitForOnline(dir: string): void;
  activeMinutes: ReadonlySet<string>;
  waitingOnline: ReadonlySet<string>;
}

export function createMinutesRun(ctx: MinutesRunContext): MinutesRun {
  const { minutes } = ctx;
  const activeMinutes = new Set<string>(); // 지금 이 실행에서 만들고 있는 회의 폴더
  // 인터넷이 끊겨 회의록을 못 쓴 회의는 연결이 돌아오면 저장된 녹취로 이어서 쓴다
  const waitingOnline = new Set<string>();
  let onlineTimer: ReturnType<typeof setInterval> | undefined;

  function runMinutes(dir: string, speakers: number | null = null, { resume = false }: { resume?: boolean } = {}): Promise<void> {
    const meta = readJson(path.join(dir, 'meta.json')) as FolderMeta | null;
    const durationSec = Math.max(0, ...Object.values(meta?.files ?? {}).map((f) => f.durationSec ?? 0));
    if (durationSec < MIN_MEETING_SEC) {
      core.writeJsonAtomic(path.join(dir, 'minutes.json'), { status: 'short', durationSec, updatedAt: new Date() });
      ctx.send('minutes:status', { id: path.basename(dir), status: 'short' });
      ctx.sendOverlay('overlay:stage', { stage: 'done', status: 'meeting-short' });
      return Promise.resolve();
    }
    activeMinutes.add(dir);
    waitingOnline.delete(dir);
    return minutes.makeMinutes(dir, {
      speakers,
      resume,
      onStage: (s) => {
        if (s.status === 'error' && s.offline) waitForOnline(dir);
        ctx.send('minutes:status', { id: path.basename(dir), ...s });
        if (s.status === 'queued') ctx.sendOverlay('overlay:stage', { stage: 'done', status: 'meeting-saved' });
        if (s.status === 'done') {
          const rv = core.reviewSummary(dir);
          ctx.sendOverlay('overlay:stage', { stage: 'done', status: 'minutes-done', text: `${s.title ?? ''}${rv?.open ? ` · 확인 필요 ${rv.open}개` : ''}` });
        }
        if (s.status === 'error') ctx.sendOverlay('overlay:stage', { stage: 'done', status: 'minutes-error', error: s.error });
        if (['done', 'error', 'empty'].includes(s.status)) activeMinutes.delete(dir);
      },
    });
  }

  function waitForOnline(dir: string): void {
    waitingOnline.add(dir);
    onlineTimer ??= setInterval(() => {
      if (!ctx.isOnline()) return;
      clearInterval(onlineTimer);
      onlineTimer = undefined;
      for (const d of [...waitingOnline]) if (!activeMinutes.has(d) && minutes.canResume(d)) runMinutes(d, null, { resume: true });
      waitingOnline.clear();
    }, ONLINE_POLL_MS);
  }

  return { runMinutes, waitForOnline, activeMinutes, waitingOnline };
}
