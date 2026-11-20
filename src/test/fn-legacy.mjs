// 시험 전용 · 얼린 사본: 옮기기 전 src/main.js(origin/main fb4af89)의 fn 상태 머신을 줄 그대로 옮겨 두었다 (결정 70).
// src/app/fn.test.mts가 새 모듈(src/app/fn.mts)과 이것에 같은 무작위 입력을 넣어 보내는 명령·알림·출력·남은 타이머가 같은지 본다.
// 고치지 말 것 — 비교 기준이다. "줄 그대로" 아래 본문은 옛 파일에서 스크립트로 잘라 붙이고 들여쓰기만 한 칸 늘렸다.
// 본문이 바깥에서 쓰던 이름(Date.now·setTimeout·clearTimeout·send·sendOverlay·sendOverlayState·dictation·recording·transcribing·
// SELFTEST·DEBOUNCE_MS·console.log)은 같은 이름의 지역 변수로 끼워 넣는다. src/test/** 라 앱 빌드(tsconfig.build·electron-builder)와 IPC 검사에서 빠진다.
export function createLegacyFn(env) {
  const { DEBOUNCE_MS, SELFTEST } = env;
  const Date = { now: env.now };
  const setTimeout = env.setTimeout;
  const clearTimeout = env.clearTimeout;
  const console = { log: env.log };
  const send = env.send;
  const sendOverlay = env.sendOverlay;
  const sendOverlayState = env.sendOverlayState;
  const dictation = env.dictation;
  let recording = null; // 본체의 let recording·transcribing — 시험이 world()로 바꾼다
  let transcribing = 0;

  // ── 줄 그대로: src/main.js 121–211 ──
  let fnState = 'idle'; // idle | holding | tapped(짧게 뗀 뒤 두 번째 누름 대기) | handsfree(잠금·버튼으로 시작한 녹음)
  let handsfreeMode = null;
  let fnDownAt = 0;
  let ignoreNextUp = false;
  let dictationStartAt = 0;
  let memoStopping = false; // 받아쓰기를 멈추고 파일을 넘기는 사이 (이때부터 입력이 끝날 때까지는 처리 중)
  let lastBusyNotice = 0;
  let tapTimer = null;

  function command(action, mode) {
    if (action === 'stop' && recording?.mode === 'memo') {
      memoStopping = true;
      setTimeout(() => (memoStopping = false), 5000); // 창 쪽에서 멈추기에 실패해도 fn이 막혀 있지 않게
    }
    send('rec:cmd', { action, mode });
  }

  // Wispr Flow와 같은 규칙 (DICTATION_DEBOUNCE_DELAY = 500ms):
  // - 누르면 바로 듣기 시작. 0.5초 이상 누르고 있다 떼면 받아써서 입력
  // - 0.5초 안에 뗐다면 0.5초 더 기다렸다가 두 번째 누름이 없으면 버린다
  // - 시작 후 0.5초 안에 다시 누르면 지금 녹음을 그대로 이어서 잠금(손을 떼도 계속 듣기)
  // - 잠긴 상태에서 다시 누르면 끝내고 입력, 시작 후 0.5초 안에 세 번째로 누르면 취소
  // 앞 받아쓰기를 아직 처리하는 중이면 새로 시작하지 않는다 (Wispr Flow와 같이, 알림은 0.5초에 한 번만)
  function dictationBusy() {
    return transcribing > 0 || memoStopping;
  }

  // 처음 설정 중에는 fn 받아쓰기를 막는다 (연습 단계만 예외). fn 키 확인 단계에서는 누름만 알린다
  let fnTestMode = false;
  function onboardingAllowsFn() {
    const ob = dictation.storedSettings().onboarding;
    return SELFTEST || !ob || ob.completed || ob.step === 'practice';
  }

  function onFnDown() {
    if (fnTestMode) return send('onboarding:fn', { down: true });
    if (!onboardingAllowsFn()) return;
    fnDownAt = Date.now();
    if (fnState === 'idle' && dictationBusy()) {
      if (fnDownAt - lastBusyNotice > DEBOUNCE_MS) sendOverlay('overlay:stage', { stage: 'busy' });
      if (SELFTEST) console.log('SELFTEST busy-ignored');
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
        clearTimeout(tapTimer);
        fnState = 'handsfree';
        handsfreeMode = 'memo';
        ignoreNextUp = true;
        sendOverlayState();
      }
    } else if (fnState === 'idle' && dictation.getSettings().enabled) {
      command('start', 'memo'); // 누르는 즉시 시작해야 첫 음절이 잘리지 않는다
      dictationStartAt = fnDownAt;
      fnState = 'holding';
    }
  }

  function onFnUp({ chord }) {
    if (fnTestMode) return send('onboarding:fn', { down: false });
    if (ignoreNextUp) {
      ignoreNextUp = false;
      return;
    }
    if (fnState !== 'holding') return;
    if (chord) {
      fnState = 'idle';
      command('cancel');
    } else if (Date.now() - dictationStartAt < DEBOUNCE_MS) {
      fnState = 'tapped'; // 두 번째 누름을 기다린다
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => {
        if (fnState !== 'tapped') return;
        fnState = 'idle';
        command('cancel');
        send('onboarding:tap'); // 톡 누르기만 했다 → 연습 단계에서 '꾹 누르세요' 안내
      }, DEBOUNCE_MS);
    } else {
      fnState = 'idle';
      command('stop');
    }
  }

  // ── 줄 그대로: src/main.js 236–241 ──
  function uiCancel() {
    if (!recording) return;
    command('cancel');
    fnState = 'idle';
    handsfreeMode = null;
  }

  // ── 줄 그대로: src/main.js 257–268 ──
  function uiToggle(mode) {
    clearTimeout(tapTimer);
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

  // ── 바깥 구역에서 이 상태를 쓰던 곳 (각 줄은 그대로, 감싼 함수만 새로) ──
  // rec:start의 20분 타이머 (372–374, 앞 줄 'if (recording !== rec) return;'은 본체에 남는다)
  function dictationLimit() {
    command('stop');
    fnState = 'idle';
    handsfreeMode = null;
  }
  // rec:stop 첫 줄 (414)
  function recStop({ discard = false } = {}) {
    if (!recording || recording.mode !== 'memo' || discard) memoStopping = false;
  }
  // runDictation (454, transcribing++ 바로 뒤)
  function handedOff() {
    memoStopping = false;
  }
  // rec:failed (913)
  function failed() {
    fnState = 'idle';
  }
  // registerOnboarding에 넘기던 setter (881)
  const setFnTestMode = (on) => (fnTestMode = on);

  return {
    onFnDown,
    onFnUp,
    uiToggle,
    uiCancel,
    dictationLimit,
    recStop,
    handedOff,
    failed,
    setFnTestMode,
    fnState: () => fnState, // sendOverlayState가 읽던 값 (981)
    world(next) {
      recording = next.recording;
      transcribing = next.transcribing;
    },
  };
}
