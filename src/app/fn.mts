// ── fn 키 동작: 받아쓰기 전용 (회의 녹음은 창·독·메뉴바 버튼으로만) ────────────
// src/main.js에서 옮김 (결정 70). 상태(fnState 등)는 모두 여기 안에 있고, 본체는 일어난 일을 메서드로 알린다.
// Electron도 진짜 시계도 쓰지 않는다 — 지금 시각·타이머·창으로 보내기·녹음 상태는 본체가 넘긴다 (시험은 가짜 시계로 돌린다).
// fn-listener 실행·줄 읽기, 셀프테스트(runFnSimulation), 일시정지·취소 확인 창은 본체에 남았다.
//
// 꾹 누르기 : 누르는 동안 녹음, 떼면 받아써서 커서 위치에 입력
// 짧게 눌렀다 떼거나 fn+다른 키 단축키를 쓰면 녹음을 버린다
// Wispr Flow와 같은 규칙 (DICTATION_DEBOUNCE_DELAY = 500ms):
// - 누르면 바로 듣기 시작. 0.5초 이상 누르고 있다 떼면 받아써서 입력
// - 0.5초 안에 뗐다면 0.5초 더 기다렸다가 두 번째 누름이 없으면 버린다
// - 시작 후 0.5초 안에 다시 누르면 지금 녹음을 그대로 이어서 잠금(손을 떼도 계속 듣기)
//   (잠금은 처음 누른 때부터, 기다림은 뗀 때부터 잰다. 그 사이의 늦은 누름은 아무 일도 없고, 그 누름을 떼면 끝내고 입력)
// - 잠긴 상태에서 다시 누르면 끝내고 입력, 시작 후 0.5초 안에 세 번째로 누르면 취소
// 앞 받아쓰기를 아직 처리하는 중이면 새로 시작하지 않는다 (Wispr Flow와 같이, 알림은 0.5초에 한 번만)
// 처음 설정 중에는 fn 받아쓰기를 막는다 (연습 단계만 예외). fn 키 확인 단계에서는 누름만 알린다

export type FnState = 'idle' | 'holding' | 'tapped' | 'handsfree';

export interface FnDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  debounceMs: number;
  selftest: boolean; // 셀프테스트: 처음 설정과 상관없이 fn을 받고, busy-ignored 줄을 남긴다
  // 창에 녹음 명령을 보낸다 (본체의 send('rec:cmd', { action, mode }))
  sendCommand(action: string, mode: string | undefined): void;
  transcribing(): number; // 진행 중인 받아쓰기 수
  recording(): { mode?: string } | null; // 지금 녹음 (없으면 null)
  dictationEnabled(): boolean; // 설정 › 받아쓰기 켜짐
  onboarding(): { completed?: boolean; step?: unknown } | undefined; // 저장된 처음 설정 진행
  busyNotice(): void; // 플로팅 독에 '처리 중' 알림
  overlayState(): void; // 플로팅 독 상태 다시 보내기
  onboardingTap(): void; // 톡 누르기만 했다 → 연습 단계에서 '꾹 누르세요' 안내
  onboardingFn(down: boolean): void; // fn 키 확인 단계: 누름·뗌만 알린다
  log(line: string): void; // 셀프테스트 출력 (SELFTEST …)
}

export interface FnMachine {
  fnDown(): void;
  fnUp(e: { chord: boolean }): void;
  uiToggle(mode: string | undefined): void; // 창·독·메뉴바의 녹음 버튼
  uiCancel(): void; // 녹음 취소: 저장하지 않고 버린다
  dictationLimitReached(): void; // 받아쓰기가 20분이 됐다 → 끝내고 입력
  stopReceived(e: { discard: boolean }): void; // 창이 녹음을 멈추고 rec:stop을 보냈다 (녹음을 지우기 전에 부른다)
  dictationHandedOff(): void; // 받아쓰기 파일을 받아쓰기 처리로 넘겼다
  recordingFailed(): void; // 창이 녹음 시작에 실패했다 (rec:failed)
  setFnTestMode(on: boolean): void; // 처음 설정의 fn 키 확인 단계
  state(): FnState;
}

export function createFnMachine(deps: FnDeps): FnMachine {
  const DEBOUNCE_MS = deps.debounceMs;
  let fnState: FnState = 'idle'; // idle | holding | tapped(짧게 뗀 뒤 두 번째 누름 대기) | handsfree(잠금·버튼으로 시작한 녹음)
  let handsfreeMode: string | null | undefined = null;
  let fnDownAt = 0;
  let ignoreNextUp = false;
  let dictationStartAt = 0;
  let memoStopping = false; // 받아쓰기를 멈추고 파일을 넘기는 사이 (이때부터 입력이 끝날 때까지는 처리 중)
  let lastBusyNotice = 0;
  let tapTimer: unknown = null;
  let fnTestMode = false;

  function command(action: string, mode?: string) {
    if (action === 'stop' && deps.recording()?.mode === 'memo') {
      memoStopping = true;
      deps.setTimeout(() => (memoStopping = false), 5000); // 창 쪽에서 멈추기에 실패해도 fn이 막혀 있지 않게
    }
    deps.sendCommand(action, mode);
  }

  function dictationBusy() {
    return deps.transcribing() > 0 || memoStopping;
  }

  function onboardingAllowsFn() {
    const ob = deps.onboarding();
    return deps.selftest || !ob || ob.completed || ob.step === 'practice';
  }

  function fnDown() {
    if (fnTestMode) return deps.onboardingFn(true);
    if (!onboardingAllowsFn()) return;
    fnDownAt = deps.now();
    if (fnState === 'idle' && dictationBusy()) {
      if (fnDownAt - lastBusyNotice > DEBOUNCE_MS) deps.busyNotice();
      if (deps.selftest) deps.log('SELFTEST busy-ignored');
      lastBusyNotice = fnDownAt;
      ignoreNextUp = true;
      return;
    }
    if (fnState === 'handsfree') {
      // 버튼으로 시작한 받아쓰기는 fn으로도 끝낼 수 있지만, 회의 녹음은 fn에 반응하지 않는다
      if (handsfreeMode !== 'memo') return;
      command(fnDownAt - dictationStartAt < DEBOUNCE_MS ? 'cancel' : 'stop');
      fnState = 'idle';
      handsfreeMode = null;
      ignoreNextUp = true;
    } else if (fnState === 'tapped') {
      if (fnDownAt - dictationStartAt < DEBOUNCE_MS) {
        deps.clearTimeout(tapTimer);
        fnState = 'handsfree';
        handsfreeMode = 'memo';
        ignoreNextUp = true;
        deps.overlayState();
      }
    } else if (fnState === 'idle' && deps.dictationEnabled()) {
      command('start', 'memo'); // 누르는 즉시 시작해야 첫 음절이 잘리지 않는다
      dictationStartAt = fnDownAt;
      fnState = 'holding';
    }
  }

  function fnUp({ chord }: { chord: boolean }) {
    if (fnTestMode) return deps.onboardingFn(false);
    if (ignoreNextUp) {
      ignoreNextUp = false;
      return;
    }
    if (fnState === 'tapped') {
      // 톡 뒤 기다리는 중 늦게 다시 누른 키를 뗐다 (Wispr Flow와 같이 "key_release", 결정 76):
      // 시작 후 0.5초가 지났으면 처음 누른 때부터의 녹음을 끝내고 입력한다. 늦은 누름 자체는 아무 일도 하지 않았다.
      // 0.5초 안의 뗌은 진짜 누름 뒤에 올 수 없다(그 누름이 잠갔다) — 지금처럼 아무것도 하지 않는다. chord도 그대로 무시
      if (!chord && deps.now() - dictationStartAt >= DEBOUNCE_MS) {
        deps.clearTimeout(tapTimer);
        fnState = 'idle';
        command('stop');
      }
      return;
    }
    if (fnState !== 'holding') return;
    if (chord) {
      fnState = 'idle';
      command('cancel');
    } else if (deps.now() - dictationStartAt < DEBOUNCE_MS) {
      fnState = 'tapped'; // 두 번째 누름을 기다린다
      deps.clearTimeout(tapTimer);
      tapTimer = deps.setTimeout(() => {
        if (fnState !== 'tapped') return;
        fnState = 'idle';
        command('cancel');
        deps.onboardingTap();
      }, DEBOUNCE_MS);
    } else {
      fnState = 'idle';
      command('stop');
    }
  }

  function uiCancel() {
    if (!deps.recording()) return;
    command('cancel');
    fnState = 'idle';
    handsfreeMode = null;
  }

  function uiToggle(mode: string | undefined) {
    deps.clearTimeout(tapTimer);
    if (fnState === 'holding' || fnState === 'tapped' || fnState === 'handsfree') {
      command('stop');
      fnState = 'idle';
      handsfreeMode = null;
    } else {
      command('start', mode);
      fnState = 'handsfree';
      handsfreeMode = mode;
    }
  }

  return {
    fnDown,
    fnUp,
    uiToggle,
    uiCancel,
    dictationLimitReached() {
      command('stop');
      fnState = 'idle';
      handsfreeMode = null;
    },
    stopReceived({ discard }) {
      const rec = deps.recording();
      if (!rec || rec.mode !== 'memo' || discard) memoStopping = false;
    },
    dictationHandedOff() {
      memoStopping = false;
    },
    recordingFailed() {
      fnState = 'idle';
    },
    setFnTestMode(on) {
      fnTestMode = on;
    },
    state: () => fnState,
  };
}
