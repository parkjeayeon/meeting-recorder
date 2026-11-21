// ── fn 키: 받아쓰기 키 도우미(fn-listener) 실행과 줄 읽기, 셀프테스트의 fn 흉내 ────────────────
// src/main.js에서 옮김 (결정 70). fn 규칙과 상태는 fn.mts의 상태 머신이 갖고, 여기서 한 번 만들어 둔다.
// 띄운 도우미(fnProc)와 고아 정리를 했는지(orphanFnChecked)는 여기만 갖는다. 도우미 띄우기·줄 나누기·fn 키 설정 경고는
// 플랫폼 층(keyListener), 한 번만 띄우기·줄의 뜻·종료 안내는 여기.
// 녹음·받아쓰기 수·설정·끝내는 중인지·창으로 보내기·앱 끝내기는 본체가 넘긴다 (부를 때 읽는다).
import fs from 'node:fs';
import { platform } from '../platform/index.mjs';
import type { Dictation } from '../dictation/index.mjs';
import { createFnMachine, type FnMachine } from './fn.mjs';

export const DEBOUNCE_MS = 500; // 두 번 누르기·짧은 탭 판단 (Wispr Flow DICTATION_DEBOUNCE_DELAY와 같은 값)

export interface FnKeysContext {
  selftest: boolean;
  recording: () => { mode?: string } | null;
  transcribing: () => number; // 진행 중인 받아쓰기 수
  dictation: Pick<Dictation, 'getSettings' | 'storedSettings'>;
  quitting: () => boolean; // 앱을 끝내는 중이면 도우미가 끝나도 알리지 않는다
  helperPath: (name: string) => string; // native/<이름> (설치본은 resources)
  send: (channel: string, payload?: unknown) => void; // 메인 창으로
  sendOverlay: (channel: string, payload?: unknown) => void; // 플로팅 독으로
  sendOverlayState: () => void;
  quit: () => void; // app.quit (셀프테스트 끝)
  log: (line: string) => void;
}

export interface FnKeys {
  machine: FnMachine;
  handleFnLine(line: string): void;
  startFnListener(): void;
  runFnSimulation(): void;
  fnUsageWarning(): string | null;
  killListener(): void; // 띄운 도우미가 있으면 끈다 (끝날 때)
}

export function createFnKeys(ctx: FnKeysContext): FnKeys {
  // 규칙과 상태(fnState 등)는 src/app/fn.mts. fn-listener 줄·버튼·녹음 저장 쪽에서 일어난 일을 알린다.
  // 지금 시각·타이머·창으로 보내기·녹음 상태는 부를 때 읽게 넘긴다
  const fnMachine = createFnMachine({
    now: () => Date.now(),
    setTimeout: (f, ms) => setTimeout(f, ms),
    clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout> | undefined),
    debounceMs: DEBOUNCE_MS,
    selftest: ctx.selftest,
    sendCommand: (action, mode) => ctx.send('rec:cmd', { action, mode }),
    transcribing: () => ctx.transcribing(),
    recording: () => ctx.recording(),
    dictationEnabled: () => ctx.dictation.getSettings().enabled,
    onboarding: () => ctx.dictation.storedSettings().onboarding as { completed?: boolean; step?: unknown } | undefined,
    busyNotice: () => ctx.sendOverlay('overlay:stage', { stage: 'busy' }),
    overlayState: () => ctx.sendOverlayState(),
    onboardingTap: () => ctx.send('onboarding:tap'),
    onboardingFn: (down) => ctx.send('onboarding:fn', { down }),
    log: (line) => ctx.log(line),
  });

  let fnProc: { kill(): unknown } | null = null;
  let orphanFnChecked = false;

  function handleFnLine(line: string): void {
    if (line === 'ready') ctx.send('fn:status', { ok: true });
    else if (line === 'error:permission') ctx.send('perm:changed'); // 권한 패널이 안내한다
    else if (line === 'down') fnMachine.fnDown();
    else if (line === 'up') fnMachine.fnUp({ chord: false });
    else if (line === 'chord') fnMachine.fnUp({ chord: true });
  }

  // before-quit 없이 끝나면(강제 종료·크래시) fn-listener가 고아로 남는다. 종료 때 끄고(본체의 process.on('exit')), 시작할 때 남은 것을 정리한다
  function killOrphanFnListeners(bin: string): void {
    if (orphanFnChecked) return;
    orphanFnChecked = true;
    try {
      for (const { pid, command } of platform.processes.orphans()) if (command.trim() === bin) process.kill(pid);
    } catch {}
  }

  // 도우미 띄우기·줄 나누기는 src/platform (keyListener). 한 번만 띄우기·줄의 뜻·종료 안내는 여기
  function startFnListener(): void {
    if (fnProc) return;
    const bin = ctx.helperPath('fn-listener');
    killOrphanFnListeners(bin);
    if (!fs.existsSync(bin)) {
      ctx.send('fn:status', { ok: false, reason: 'fn-listener 바이너리가 없습니다. npm run build:fn 을 실행하세요.' });
      return;
    }
    fnProc = platform.keyListener.start(bin, {
      line: handleFnLine,
      exit: (code) => {
        fnProc = null;
        if (code !== 2 && !ctx.quitting()) ctx.send('fn:status', { ok: false, reason: `fn 감지기가 종료됨 (code ${code})` });
      },
    });
  }

  // 셀프테스트: 실제 키 대신 fn 이벤트를 흉내 내서 상태 머신 전체를 검증
  function runFnSimulation(): void {
    const steps: [number, string][] = [
      [500, 'down'], [2000, 'up+down'], [2080, 'up'], // 꾹 누르기 1.5초 → 받아쓰기, 떼자마자 다시 누름은 처리 중이라 무시
      [3000, 'down'], [3100, 'up'], // 짧은 탭 → 버림
      [4500, 'down'], [4600, 'up'], [4750, 'down'], [4850, 'up'], // 두 번 탭 → 손을 떼도 계속 받아쓰기
      [6200, 'down'], [6300, 'up'], // 한 번 더 누르면 끝내고 받아쓰기
      [7000, 'down'], [7100, 'up'], [7250, 'down'], [7350, 'up'], [7400, 'down'], [7450, 'up'], // 빠르게 세 번 → 취소
    ];
    for (const [t, line] of steps) setTimeout(() => line.split('+').forEach(handleFnLine), t);
    // 회의는 버튼으로만 시작/정지하고, 녹음 중 fn은 무시돼야 한다
    setTimeout(() => fnMachine.uiToggle('meeting'), 9000);
    setTimeout(() => { handleFnLine('down'); handleFnLine('up'); }, 10500);
    setTimeout(() => fnMachine.uiToggle('meeting'), 12000);
    setTimeout(() => ctx.quit(), 13500);
  }

  // fn 키가 다른 동작과 겹치는지 (src/platform keyListener.usageWarning)
  function fnUsageWarning(): string | null {
    return platform.keyListener.usageWarning();
  }

  return {
    machine: fnMachine,
    handleFnLine,
    startFnListener,
    runFnSimulation,
    fnUsageWarning,
    killListener: () => {
      fnProc?.kill();
    },
  };
}
