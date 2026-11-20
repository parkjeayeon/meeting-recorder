// fn 키 상태 머신 (src/app/fn.mts) — 가짜 시계·가짜 창으로 규칙을 시간표대로, 셀프테스트 시간표를 가짜 녹음기로,
// 그리고 옮기기 전 코드(src/test/fn-legacy.mjs, 얼린 사본)와 무작위 입력 수천 벌로 같은지 본다
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLegacyFn } from '../test/fn-legacy.mjs';
import { createFnMachine, type FnDeps, type FnMachine } from './fn.mjs';

const DEBOUNCE_MS = 500;

// 가짜 시계: 타이머를 적어 두었다가 시각을 옮길 때 정해진 차례(시각, 만든 순서)로 부른다
function manualClock(start = 0) {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { due: number; ms: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { due: now + ms, ms, fn });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number);
    },
    advanceTo(t: number) {
      for (;;) {
        let pick: [number, { due: number; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].due <= t && (!pick || e[1].due < pick[1].due || (e[1].due === pick[1].due && e[0] < pick[0]))) pick = e;
        if (!pick) break;
        timers.delete(pick[0]);
        now = pick[1].due;
        pick[1].fn();
      }
      now = Math.max(now, t);
    },
    // 남은 타이머: [번호, 울릴 시각, 길이]
    pending: () => [...timers].map(([id, x]) => [id, x.due, x.ms]),
  };
}

interface World {
  recording: { mode?: string } | null;
  transcribing: number;
  enabled: boolean;
  onboarding: { completed?: boolean; step?: unknown } | undefined;
}

const defaultWorld = (): World => ({ recording: null, transcribing: 0, enabled: true, onboarding: { completed: true } });

// 본체가 창·독으로 보내는 것을 한 줄씩 (시각 붙여)
function recorder(clock: { now(): number }, base = 0) {
  const trace: string[] = [];
  const at = () => clock.now() - base;
  return {
    trace,
    send(channel: string, payload?: unknown) {
      if (channel === 'rec:cmd') {
        const { action, mode } = payload as { action: string; mode?: string };
        trace.push(`${at()} cmd ${action}${mode !== undefined ? ` ${mode}` : ''}`);
      } else trace.push(`${at()} ${channel}${payload !== undefined ? ` ${JSON.stringify(payload)}` : ''}`);
    },
    sendOverlay(channel: string, payload?: unknown) {
      trace.push(`${at()} overlay ${channel} ${JSON.stringify(payload)}`);
    },
    sendOverlayState() {
      trace.push(`${at()} overlay:state`);
    },
    log(line: string) {
      trace.push(`${at()} log ${line}`);
    },
  };
}

// 새 모듈을 본체(src/main.js)와 같은 모양으로 잇는다 (본체의 send·sendOverlay·console.log 자리에 기록기)
function newDeps(world: World, clock: ReturnType<typeof manualClock>, out: ReturnType<typeof recorder>, selftest = false): FnDeps {
  return {
    now: clock.now,
    setTimeout: (f, ms) => clock.setTimeout(f, ms),
    clearTimeout: (t) => clock.clearTimeout(t),
    debounceMs: DEBOUNCE_MS,
    selftest,
    sendCommand: (action, mode) => out.send('rec:cmd', { action, mode }),
    transcribing: () => world.transcribing,
    recording: () => world.recording,
    dictationEnabled: () => world.enabled,
    onboarding: () => world.onboarding,
    busyNotice: () => out.sendOverlay('overlay:stage', { stage: 'busy' }),
    overlayState: () => out.sendOverlayState(),
    onboardingTap: () => out.send('onboarding:tap'),
    onboardingFn: (down) => out.send('onboarding:fn', { down }),
    log: (line) => out.log(line),
  };
}
const newMachine = (world: World, clock: ReturnType<typeof manualClock>, out: ReturnType<typeof recorder>, selftest = false) =>
  createFnMachine(newDeps(world, clock, out, selftest));

type Input = 'down' | 'up' | 'chord' | 'toggle memo' | 'toggle meeting' | 'cancel' | ((m: FnMachine, w: World) => void);

// 시간표대로 넣고 (시각은 시작부터 ms), 끝나면 until까지 시계를 돌린다
function play(timeline: [number, Input][], { world = defaultWorld(), selftest = false, until = 20_000 } = {}) {
  const base = 10_000; // 처음 값(0)과 멀리 — 시작 시각이 0 근처일 때의 일은 따로 본다
  const clock = manualClock(base);
  const out = recorder(clock, base);
  const m = newMachine(world, clock, out, selftest);
  for (const [t, input] of timeline) {
    clock.advanceTo(base + t);
    if (input === 'down') m.fnDown();
    else if (input === 'up') m.fnUp({ chord: false });
    else if (input === 'chord') m.fnUp({ chord: true });
    else if (input === 'toggle memo') m.uiToggle('memo');
    else if (input === 'toggle meeting') m.uiToggle('meeting');
    else if (input === 'cancel') m.uiCancel();
    else input(m, world);
  }
  const before = clock.pending().map(([, due, ms]) => [due! - base, ms]);
  clock.advanceTo(base + until);
  return { trace: out.trace, state: m.state(), pendingAtEnd: before, m, world };
}

describe('fn 규칙 (시간표)', () => {
  it('1.5초 꾹 누르고 떼면 받아쓰기: 누르는 즉시 시작, 떼면 멈춤', () => {
    const r = play([[0, 'down'], [1500, 'up']]);
    expect(r.trace).toEqual(['0 cmd start memo', '1500 cmd stop']);
    expect(r.state).toBe('idle');
  });

  it('0.5초 이상이면 바로 멈추고, 0.5초 안이면 기다린다 (경계: 시작 후 499ms는 탭, 500ms는 꾹)', () => {
    expect(play([[0, 'down'], [500, 'up']]).trace).toEqual(['0 cmd start memo', '500 cmd stop']);
    expect(play([[0, 'down'], [499, 'up']]).trace).toEqual(['0 cmd start memo', '999 cmd cancel', '999 onboarding:tap']);
  });

  it('100ms 탭 뒤 아무것도 없으면 뗀 때부터 0.5초 뒤 버리고 연습 단계 안내', () => {
    const r = play([[0, 'down'], [100, 'up']], { until: 599 });
    expect(r.trace).toEqual(['0 cmd start memo']);
    expect(r.state).toBe('tapped');
    expect(r.pendingAtEnd).toEqual([[600, 500]]);
    expect(play([[0, 'down'], [100, 'up']]).trace).toEqual(['0 cmd start memo', '600 cmd cancel', '600 onboarding:tap']);
  });

  it('탭 뒤 시작 0.5초 안에 다시 누르면 같은 녹음 그대로 잠금, 뗌은 무시, 다음 누름에서 멈춤', () => {
    const r = play([[0, 'down'], [100, 'up'], [250, 'down'], [350, 'up'], [2000, 'down'], [2100, 'up']]);
    expect(r.trace).toEqual(['0 cmd start memo', '250 overlay:state', '2000 cmd stop']);
    expect(r.state).toBe('idle');
  });

  it('잠근 뒤 시작 0.5초 안에 세 번째로 누르면 취소', () => {
    const r = play([[0, 'down'], [100, 'up'], [250, 'down'], [350, 'up'], [400, 'down'], [450, 'up']]);
    expect(r.trace).toEqual(['0 cmd start memo', '250 overlay:state', '400 cmd cancel']);
    expect(r.state).toBe('idle');
  });

  it('탭 뒤 시작 0.5초가 지나서 누르면 누름은 아무 일도 없다 (상태 tapped 그대로)', () => {
    const r = play([[0, 'down'], [400, 'up'], [600, 'down']], { until: 650 });
    expect(r.trace).toEqual(['0 cmd start memo']);
    expect(r.state).toBe('tapped');
  });

  // 결정 76: 잠금은 처음 누른 때부터, 기다림은 뗀 때부터 잰다. 그 사이의 늦은 누름을 떼면 Wispr Flow처럼 끝내고 입력
  it.each([700, 899])('탭(0→400) 뒤 600에 늦게 누르고 %i에 떼면 처음부터의 녹음을 끝내고 입력 — 버리지 않는다', (upAt) => {
    const r = play([[0, 'down'], [400, 'up'], [600, 'down'], [upAt, 'up']], { until: upAt });
    expect(r.trace).toEqual(['0 cmd start memo', `${upAt} cmd stop`]);
    expect(r.state).toBe('idle');
    expect(r.pendingAtEnd).toEqual([]); // 탭 타이머가 지워졌다
    // 0.9초가 지나도 버림·연습 단계 안내가 없다
    expect(play([[0, 'down'], [400, 'up'], [600, 'down'], [upAt, 'up']]).trace).toEqual(['0 cmd start memo', `${upAt} cmd stop`]);
  });

  it('늦은 누름을 0.9초가 지나도록 누르고 있으면 전처럼 0.9초에 버리고, 그 뒤 뗌은 아무것도', () => {
    const r = play([[0, 'down'], [400, 'up'], [600, 'down'], [2000, 'up']]);
    expect(r.trace).toEqual(['0 cmd start memo', '900 cmd cancel', '900 onboarding:tap']);
    expect(r.state).toBe('idle');
  });

  it('늦은 누름 뒤 chord는 전처럼 무시, 0.9초에 버린다', () => {
    const r = play([[0, 'down'], [400, 'up'], [600, 'down'], [700, 'chord']]);
    expect(r.trace).toEqual(['0 cmd start memo', '900 cmd cancel', '900 onboarding:tap']);
  });

  it('두 번째 누름 경계: 시작 후 499ms는 잠금(뗌은 삼킴), 500ms는 잠그지 않고 그 뗌에서 끝내고 입력', () => {
    const locked = play([[0, 'down'], [100, 'up'], [499, 'down'], [550, 'up']], { until: 2000 });
    expect(locked.trace).toEqual(['0 cmd start memo', '499 overlay:state']);
    expect(locked.state).toBe('handsfree');
    const late = play([[0, 'down'], [100, 'up'], [500, 'down'], [550, 'up']]);
    expect(late.trace).toEqual(['0 cmd start memo', '550 cmd stop']);
    expect(late.state).toBe('idle');
  });

  it('늦은 누름을 떼어 멈춘 뒤 바로 누르면 꾹 눌러 뗀 때와 같이 처리 중 (멈추는 중 표시와 5초 안전 타이머)', () => {
    const world: World = { ...defaultWorld(), recording: { mode: 'memo' } };
    const r = play([[0, 'down'], [400, 'up'], [600, 'down'], [700, 'up'], [700, 'down'], [750, 'up']], { world, selftest: true, until: 750 });
    expect(r.trace).toEqual(['0 cmd start memo', '700 cmd stop', '700 overlay overlay:stage {"stage":"busy"}', '700 log SELFTEST busy-ignored']);
    expect(r.pendingAtEnd).toEqual([[5700, 5000]]);
    expect(r.state).toBe('idle');
  });

  it('누르는 동안 다른 키(chord)를 쓰면 바로 버린다 — 0.5초 안이어도', () => {
    expect(play([[0, 'down'], [800, 'chord']]).trace).toEqual(['0 cmd start memo', '800 cmd cancel']);
    const r = play([[0, 'down'], [100, 'chord']]);
    expect(r.trace).toEqual(['0 cmd start memo', '100 cmd cancel']);
    expect(r.state).toBe('idle');
  });

  it('잠근 상태와 기다리는 상태에서 chord는 무시', () => {
    expect(play([[0, 'down'], [100, 'up'], [300, 'chord']], { until: 599 }).trace).toEqual(['0 cmd start memo']);
    expect(play([[0, 'toggle memo'], [700, 'down'], [800, 'chord'], [900, 'chord']]).trace).toEqual(['0 cmd start memo', '700 cmd stop']);
  });

  it('처리 중에 눌러 무시된 뒤의 chord도 삼킨다 (무시한 누름의 뗌으로 센다)', () => {
    const world = { ...defaultWorld(), transcribing: 1 };
    const r = play([[0, 'down'], [100, 'chord'], [200, (_m, w) => (w.transcribing = 0)], [1000, 'down'], [1100, 'chord']], { world });
    expect(r.trace).toEqual(['0 overlay overlay:stage {"stage":"busy"}', '1000 cmd start memo', '1100 cmd cancel']);
  });

  it('앞 받아쓰기 처리 중(transcribing > 0) 누르면 무시, 뗌도 삼킴, 알림은 앞 누름에서 0.5초가 지나야 다시', () => {
    const world = { ...defaultWorld(), transcribing: 1 };
    const r = play([[0, 'down'], [100, 'up'], [300, 'down'], [400, 'up'], [800, 'down'], [850, 'up'], [1301, 'down'], [1350, 'up']], { world, selftest: true });
    expect(r.trace).toEqual([
      '0 overlay overlay:stage {"stage":"busy"}',
      '0 log SELFTEST busy-ignored',
      '300 log SELFTEST busy-ignored', // 0.3초 — 알림 없음
      '800 log SELFTEST busy-ignored', // 첫 알림에서는 0.8초지만 앞 누름(0.3초)에서 0.5초라 알림 없음
      '1301 overlay overlay:stage {"stage":"busy"}',
      '1301 log SELFTEST busy-ignored',
    ]);
    expect(r.state).toBe('idle');
  });

  it('셀프테스트가 아니면 busy-ignored 줄은 남기지 않는다', () => {
    expect(play([[0, 'down']], { world: { ...defaultWorld(), transcribing: 2 } }).trace).toEqual(['0 overlay overlay:stage {"stage":"busy"}']);
  });

  it('받아쓰기를 멈춘 뒤 파일을 넘길 때까지(memoStopping)도 처리 중', () => {
    const world: World = { ...defaultWorld(), recording: { mode: 'memo' } };
    const r = play(
      [
        [0, 'down'],
        [1500, 'up'], // 멈춤 → 처리 중
        [1500, 'down'],
        [1580, 'up'],
        [1600, (m) => m.stopReceived({ discard: false })], // 창이 받아쓰기를 멈췄다 — 아직 처리 중
        [1600, (_m, w) => (w.recording = null)],
        [2100, 'down'],
        [2150, 'up'],
        [2200, (m, w) => (w.transcribing++, m.dictationHandedOff())], // 받아쓰기 처리로 넘김 — 이제 transcribing으로 처리 중
        [2800, 'down'],
        [2850, 'up'],
        [3000, (_m, w) => w.transcribing--],
        [3500, 'down'],
      ],
      { world, selftest: true },
    );
    expect(r.trace).toEqual([
      '0 cmd start memo',
      '1500 cmd stop',
      '1500 overlay overlay:stage {"stage":"busy"}',
      '1500 log SELFTEST busy-ignored',
      '2100 overlay overlay:stage {"stage":"busy"}',
      '2100 log SELFTEST busy-ignored',
      '2800 overlay overlay:stage {"stage":"busy"}',
      '2800 log SELFTEST busy-ignored',
      '3500 cmd start memo',
    ]);
  });

  it('멈추는 중 표시는 5초 안전 타이머로 풀린다 (창이 멈추기에 실패해도)', () => {
    const world: World = { ...defaultWorld(), recording: { mode: 'memo' } };
    const r = play([[0, 'down'], [1500, 'up'], [6499, 'down'], [6499, 'up'], [6500, 'down']], { world });
    expect(r.trace).toEqual(['0 cmd start memo', '1500 cmd stop', '6499 overlay overlay:stage {"stage":"busy"}', '6500 cmd start memo']);
  });

  it('받아쓰기 녹음이 아닐 때 멈추면 5초 타이머도 처리 중도 없다', () => {
    const r = play([[0, 'down'], [1500, 'up']], { until: 1500 });
    expect(r.pendingAtEnd).toEqual([]);
    const meeting = play([[0, 'toggle meeting'], [100, (_m, w) => (w.recording = { mode: 'meeting' })], [3000, 'toggle meeting']], { until: 3000 });
    expect(meeting.pendingAtEnd).toEqual([]);
  });

  it.each([
    ['버리기', { mode: 'memo' }, true, false],
    ['받아쓰기 저장', { mode: 'memo' }, false, true],
    ['회의 저장', { mode: 'meeting' }, false, false],
    ['녹음 없음', null, false, false],
  ])('rec:stop(%s)이 오면 받아쓰기 저장일 때만 처리 중을 남긴다', (_name, rec, discard, stillBusy) => {
    const world: World = { ...defaultWorld(), recording: { mode: 'memo' } };
    const r = play([[0, 'down'], [1500, 'up'], [1600, (m, w) => ((w.recording = rec), m.stopReceived({ discard }))], [1601, (_m, w) => (w.recording = null)], [2000, 'down']], { world });
    expect(r.trace.at(-1)).toBe(stillBusy ? '2000 overlay overlay:stage {"stage":"busy"}' : '2000 cmd start memo');
  });

  it('회의 녹음 중 fn은 무시 (처리 중이어도 알림 없음), 회의는 버튼으로 멈춘다', () => {
    const world = defaultWorld();
    const r = play([[0, 'toggle meeting'], [50, (_m, w) => (w.recording = { mode: 'meeting' })], [1000, 'down'], [1100, 'up'], [1200, (_m, w) => (w.transcribing = 1)], [1300, 'down'], [1310, 'chord'], [3000, 'toggle meeting']], { world });
    expect(r.trace).toEqual(['0 cmd start meeting', '3000 cmd stop']);
  });

  it('설정에서 받아쓰기를 끄면 fn은 아무것도 시작하지 않는다 — 처리 중 알림은 여전히 뜬다', () => {
    const off = { ...defaultWorld(), enabled: false };
    const r = play([[0, 'down'], [1500, 'up'], [2000, 'down'], [2100, 'up']], { world: off });
    expect(r.trace).toEqual([]);
    expect(r.state).toBe('idle');
    expect(play([[0, 'down']], { world: { ...off, transcribing: 1 } }).trace).toEqual(['0 overlay overlay:stage {"stage":"busy"}']);
    // 버튼으로는 시작한다
    expect(play([[0, 'toggle memo']], { world: off }).trace).toEqual(['0 cmd start memo']);
  });

  it.each([
    [{ completed: false, step: 'permissions' }, false],
    [{ completed: false, step: 3 }, false],
    [{ completed: false, step: 'practice' }, true],
    [{ completed: true, step: 'permissions' }, true],
    [undefined, true],
  ])('처음 설정 %j 중 fn 누름: 받는가 %s', (onboarding, allowed) => {
    const world = { ...defaultWorld(), onboarding, transcribing: 0 };
    const r = play([[0, 'down'], [1500, 'up']], { world });
    expect(r.trace).toEqual(allowed ? ['0 cmd start memo', '1500 cmd stop'] : []);
    // 처리 중 알림도 막힌다
    expect(play([[0, 'down']], { world: { ...world, transcribing: 1 } }).trace.length).toBe(allowed ? 1 : 0);
  });

  it('셀프테스트는 처음 설정 중에도 fn을 받는다', () => {
    const world = { ...defaultWorld(), onboarding: { completed: false, step: 'permissions' } };
    expect(play([[0, 'down'], [1500, 'up']], { world, selftest: true }).trace).toEqual(['0 cmd start memo', '1500 cmd stop']);
  });

  it('처음 설정이 막는 것은 누름뿐 — 꾹 누르는 도중 막히는 단계가 되면 뗌은 그대로 멈춘다', () => {
    const r = play([[0, 'down'], [500, (_m, w) => (w.onboarding = { completed: false, step: 'permissions' })], [1500, 'up']]);
    expect(r.trace).toEqual(['0 cmd start memo', '1500 cmd stop']);
  });

  it('fn 키 확인 단계에서는 누름·뗌만 알리고 다른 일은 하지 않는다', () => {
    const world = { ...defaultWorld(), transcribing: 1, onboarding: { completed: false, step: 'fn' } };
    const r = play(
      [[0, (m) => m.setFnTestMode(true)], [100, 'down'], [200, 'up'], [300, 'down'], [400, 'chord'], [500, (m) => m.setFnTestMode(false)], [600, 'down']],
      { world },
    );
    expect(r.trace).toEqual(['100 onboarding:fn {"down":true}', '200 onboarding:fn {"down":false}', '300 onboarding:fn {"down":true}', '400 onboarding:fn {"down":false}']);
    expect(r.state).toBe('idle');
  });

  it('fn 키 확인 단계의 뗌은 무시할 뗌(ignoreNextUp)을 쓰지 않는다', () => {
    const world = { ...defaultWorld(), transcribing: 1 };
    const r = play([[0, 'down'], [50, (m) => m.setFnTestMode(true)], [100, 'up'], [150, (m, w) => (m.setFnTestMode(false), (w.transcribing = 0))], [1000, 'down'], [1500, 'up'], [3000, 'down'], [4000, 'up']], { world });
    // 1.0초 누름은 시작하지만 그 뗌(1.5초)은 처리 중에 눌렀던 것의 뗌으로 삼켜져 멈추지 않고, 3.0초 누름은 무시(holding), 4.0초 뗌에서야 멈춘다
    expect(r.trace).toEqual(['0 overlay overlay:stage {"stage":"busy"}', '100 onboarding:fn {"down":false}', '1000 cmd start memo', '4000 cmd stop']);
    expect(r.state).toBe('idle');
  });

  // 버튼 누름 전 상태를 만드는 시간표
  const states: [string, [number, Input][]][] = [
    ['idle', []],
    ['holding', [[0, 'down']]],
    ['tapped', [[0, 'down'], [100, 'up']]],
    ['handsfree(fn 두 번)', [[0, 'down'], [100, 'up'], [200, 'down'], [300, 'up']]],
    ['handsfree(받아쓰기 버튼)', [[0, 'toggle memo']]],
    ['handsfree(회의 버튼)', [[0, 'toggle meeting']]],
  ];
  it.each(states.flatMap(([name, tl]) => (['memo', 'meeting'] as const).map((mode) => [name, mode, tl] as const)))('%s에서 %s 버튼', (name, mode, tl) => {
    const r = play([...tl, [400, mode === 'memo' ? 'toggle memo' : 'toggle meeting']]);
    const tail = r.trace.filter((l) => l.startsWith('400 ') || Number(l.split(' ')[0]) > 400);
    if (name === 'idle') {
      expect(tail).toEqual([`400 cmd start ${mode}`]);
      expect(r.state).toBe('handsfree');
    } else {
      // holding·tapped·handsfree는 모두 같다: 멈춤 (회의 버튼이 받아쓰기를, 받아쓰기 버튼이 회의를 멈추기도), 탭 타이머도 지운다
      expect(tail).toEqual(['400 cmd stop']);
      expect(r.state).toBe('idle');
    }
  });

  it('버튼으로 잠근 뒤 fn: 받아쓰기는 끝내고(시작 시각은 마지막 fn 누름 기준), 회의는 무시', () => {
    expect(play([[0, 'toggle memo'], [100, 'down'], [200, 'up']]).trace).toEqual(['0 cmd start memo', '100 cmd stop']);
    // 마지막 fn 받아쓰기를 시작한 지 0.5초 안에 버튼으로 잠그고 fn을 누르면 'cancel'
    expect(play([[0, 'down'], [100, 'chord'], [150, 'toggle memo'], [300, 'down']]).trace).toEqual(['0 cmd start memo', '100 cmd cancel', '150 cmd start memo', '300 cmd cancel']);
  });

  it('녹음 취소 버튼: 녹음이 없으면 아무것도, 있으면 버리고 상태를 처음으로', () => {
    expect(play([[0, 'cancel']]).trace).toEqual([]);
    const r = play([[0, 'toggle memo'], [50, (_m, w) => (w.recording = { mode: 'memo' })], [1000, 'cancel'], [1100, 'down']]);
    expect(r.trace).toEqual(['0 cmd start memo', '1000 cmd cancel', '1100 cmd start memo']);
    // 녹음이 있다고 알기 전(창이 아직 rec:start를 보내기 전)의 취소는 무시된다
    const early = play([[0, 'down'], [10, 'cancel']], { until: 10 });
    expect(early.trace).toEqual(['0 cmd start memo']);
    expect(early.state).toBe('holding');
  });

  it('20분이 되면 끝내고 입력: 멈춤 → 처리 중, 그 뒤 뗌은 아무것도', () => {
    const world: World = { ...defaultWorld(), recording: { mode: 'memo' } };
    const r = play([[0, 'down'], [100, (m) => m.dictationLimitReached()], [200, 'up'], [300, 'down']], { world });
    expect(r.trace).toEqual(['0 cmd start memo', '100 cmd stop', '300 overlay overlay:stage {"stage":"busy"}']);
  });

  it('녹음 시작에 실패하면(rec:failed) 상태만 처음으로 — 명령은 보내지 않는다', () => {
    const r = play([[0, 'down'], [100, (m) => m.recordingFailed()], [1500, 'up'], [2000, 'down']]);
    expect(r.trace).toEqual(['0 cmd start memo', '2000 cmd start memo']);
  });
});

// ── 셀프테스트 시간표 (src/main.js의 runFnSimulation 그대로) + 가짜 녹음기 ──
describe('셀프테스트 시간표', () => {
  it('docs/testing.md의 기대 결과대로: 저장 → 처리 중 무시 → 버림 → 이어진 녹음 하나 저장 → 버림 → 회의는 fn 무시', () => {
    const clock = manualClock(0);
    const world = defaultWorld();
    const lines: string[] = [];
    const at = () => clock.now();
    const RTT = 30; // 창이 명령을 받아 rec:start·rec:stop을 보내기까지
    const WHISPER = 400; // 조용한 받아쓰기(silent)가 끝나기까지
    let m: FnMachine;
    // 가짜 녹음기: 본체의 rec:start·rec:stop·runDictation이 머신에 하는 일만 흉내 낸다
    const sendCommand = (action: string, mode?: string) => {
      lines.push(`${at()} cmd ${action}${mode ? ` ${mode}` : ''}`);
      if (action === 'start') clock.setTimeout(() => (world.recording = { mode }), RTT);
      else
        clock.setTimeout(() => {
          const rec = world.recording;
          m.stopReceived({ discard: action === 'cancel' });
          if (!rec) return;
          world.recording = null;
          lines.push(`${at()} ${action === 'cancel' ? 'discarded' : 'saved'} ${rec.mode}`);
          if (action !== 'cancel' && rec.mode === 'memo') {
            world.transcribing++;
            m.dictationHandedOff();
            clock.setTimeout(() => {
              world.transcribing--;
              lines.push(`${at()} dictation silent`);
            }, WHISPER);
          }
        }, RTT);
    };
    m = createFnMachine({
      now: clock.now,
      setTimeout: (f, ms) => clock.setTimeout(f, ms),
      clearTimeout: (t) => clock.clearTimeout(t),
      debounceMs: DEBOUNCE_MS,
      selftest: true,
      sendCommand,
      transcribing: () => world.transcribing,
      recording: () => world.recording,
      dictationEnabled: () => world.enabled,
      onboarding: () => ({ completed: false, step: 'permissions' }), // 셀프테스트는 처음 설정과 상관없다
      busyNotice: () => lines.push(`${at()} busy notice`),
      overlayState: () => {},
      onboardingTap: () => {},
      onboardingFn: () => lines.push('onboarding:fn'),
      log: (line) => lines.push(`${at()} ${line}`),
    });
    const handleFnLine = (line: string) => (line === 'down' ? m.fnDown() : line === 'up' ? m.fnUp({ chord: false }) : m.fnUp({ chord: true }));
    // runFnSimulation의 시간표와 같다
    const steps: [number, string][] = [
      [500, 'down'], [2000, 'up+down'], [2080, 'up'],
      [3000, 'down'], [3100, 'up'],
      [4500, 'down'], [4600, 'up'], [4750, 'down'], [4850, 'up'],
      [6200, 'down'], [6300, 'up'],
      [7000, 'down'], [7100, 'up'], [7250, 'down'], [7350, 'up'], [7400, 'down'], [7450, 'up'],
    ];
    const events: [number, () => void][] = [
      ...steps.map(([t, line]) => [t, () => line.split('+').forEach(handleFnLine)] as [number, () => void]),
      [9000, () => m.uiToggle('meeting')],
      [10500, () => (handleFnLine('down'), handleFnLine('up'))],
      [12000, () => m.uiToggle('meeting')],
    ];
    for (const [t, run] of events) {
      clock.advanceTo(t);
      run();
    }
    clock.advanceTo(13500);
    expect(lines).toEqual([
      '500 cmd start memo', // 1.5초 꾹 누르기 → 받아쓰기
      '2000 cmd stop',
      '2000 busy notice', // 떼자마자 다시 누름 → 처리 중
      '2000 SELFTEST busy-ignored',
      '2030 saved memo',
      '2430 dictation silent',
      '3000 cmd start memo', // 짧게 톡 → 버림
      '3600 cmd cancel',
      '3630 discarded memo',
      '4500 cmd start memo', // 빠르게 두 번 → 녹음 하나가 이어지다
      '6200 cmd stop', // 1.4초 뒤 한 번 → 저장
      '6230 saved memo',
      '6630 dictation silent',
      '7000 cmd start memo', // 빠르게 세 번 → 버림
      '7400 cmd cancel',
      '7430 discarded memo',
      '9000 cmd start meeting', // 회의 녹음 중 fn은 무시
      '12000 cmd stop',
      '12030 saved meeting',
    ]);
    expect(m.state()).toBe('idle');
  });
});

// ── 옮기기 전 코드와 같은지: 무작위 입력 ──
type Step =
  | { k: 'down' | 'up' | 'chord' | 'cancel' | 'limit' | 'handedOff' | 'failed' }
  | { k: 'toggle'; mode: string | undefined }
  | { k: 'advance'; ms: number }
  | { k: 'transcribing'; n: number }
  | { k: 'recording'; mode: string | undefined | null }
  | { k: 'enabled'; on: boolean }
  | { k: 'onboarding'; v: World['onboarding'] }
  | { k: 'fnTest'; on: boolean }
  | { k: 'recStop'; discard: boolean };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom<Step>({ k: 'down' }, { k: 'up' }) },
  { weight: 1, arbitrary: fc.constantFrom<Step>({ k: 'chord' }, { k: 'cancel' }, { k: 'limit' }, { k: 'handedOff' }, { k: 'failed' }) },
  { weight: 2, arbitrary: fc.constantFrom<string | undefined>('memo', 'meeting', undefined).map((mode): Step => ({ k: 'toggle', mode })) },
  {
    weight: 8,
    arbitrary: fc
      .oneof(fc.integer({ min: 0, max: 150 }), fc.integer({ min: 0, max: 1200 }), fc.constantFrom(0, 1, 499, 500, 501, 4999, 5000, 5001), fc.integer({ min: 0, max: 7000 }))
      .map((ms): Step => ({ k: 'advance', ms })),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 2 }).map((n): Step => ({ k: 'transcribing', n })) },
  { weight: 2, arbitrary: fc.constantFrom<string | undefined | null>(null, 'memo', 'meeting', undefined).map((mode): Step => ({ k: 'recording', mode })) },
  { weight: 1, arbitrary: fc.boolean().map((on): Step => ({ k: 'enabled', on })) },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom<World['onboarding']>(undefined, { completed: true }, { completed: false, step: 'practice' }, { completed: false, step: 'fn' }, { step: 2 }, {})
      .map((v): Step => ({ k: 'onboarding', v })),
  },
  { weight: 1, arbitrary: fc.boolean().map((on): Step => ({ k: 'fnTest', on })) },
  { weight: 1, arbitrary: fc.boolean().map((discard): Step => ({ k: 'recStop', discard })) },
);

// 같으면 null, 다르면 몇 번째 걸음에서 무엇이 달랐는지. seen에는 새 모듈이 거친 상태와 보낸 것의 종류를 모은다 (무작위 입력이 규칙을 두루 밟는지 보려고)
// 옮긴 뒤 일부러 바꾼 것 하나(결정 76)만 옛 코드 쪽에 덧씌운다: 옛 코드가 tapped일 때 chord가 아닌 뗌이 시작 후 0.5초 이상에 오면
// 옛 코드에도 뗌을 그대로 넣고, 그 뗌이 아무것도 하지 않았으면(상태 tapped 그대로·보낸 것 없음) 새 규칙(탭 타이머 지우기·idle·멈춤)을 얹는다.
// 얹는 방법은 옛 코드의 uiToggle — tapped에서 탭 타이머를 지우고 command('stop')·idle로 하는, 새 규칙과 같은 일이다
// (handsfreeMode = null도 하지만 handsfreeMode는 handsfree로 갈 때마다 새로 정해져 밖에서 보이지 않는다). 시작 시각은 옛 코드가 idle → holding이 된 누름의 시각.
// 그 밖의 다름은 모두 그대로 걸린다. deviation: false면 덧씌우지 않는다 (새 규칙을 빼면 걸리는지 보려고). hits에는 덧씌운 횟수를 센다
function runBoth(
  start: number,
  selftest: boolean,
  steps: Step[],
  mutate: (d: FnDeps) => FnDeps = (d) => d,
  seen?: Set<string>,
  { deviation = true, hits }: { deviation?: boolean; hits?: { n: number } } = {},
) {
  const world = defaultWorld();
  const recOf = (mode: string | undefined | null) => (mode === null ? null : { mode });
  // 옛 코드
  const oc = manualClock(start);
  const oo = recorder(oc, start);
  const old = createLegacyFn({
    DEBOUNCE_MS,
    SELFTEST: selftest,
    now: oc.now,
    setTimeout: (f, ms) => oc.setTimeout(f, ms),
    clearTimeout: (t) => oc.clearTimeout(t),
    log: oo.log,
    send: oo.send,
    sendOverlay: oo.sendOverlay,
    sendOverlayState: oo.sendOverlayState,
    dictation: { getSettings: () => ({ enabled: world.enabled }), storedSettings: () => ({ onboarding: world.onboarding }) },
  });
  // 새 모듈
  const nc = manualClock(start);
  const no = recorder(nc, start);
  const neu = createFnMachine(mutate(newDeps(world, nc, no, selftest)));
  const snap = (c: ReturnType<typeof manualClock>, o: ReturnType<typeof recorder>, state: string) => JSON.stringify({ trace: o.trace, pending: c.pending(), state, now: c.now() });
  let oldStartAt = 0; // 옛 코드의 dictationStartAt (밖에서 안 보여 따로 적는다)
  let oldFnTest = false;
  for (const [i, s] of [...steps, { k: 'advance', ms: 20_000 } as Step].entries()) {
    old.world(world);
    switch (s.k) {
      case 'down': {
        const was = old.fnState();
        old.onFnDown();
        if (was === 'idle' && old.fnState() === 'holding') oldStartAt = oc.now();
        neu.fnDown();
        break;
      }
      case 'up':
      case 'chord': {
        const late = deviation && s.k === 'up' && !oldFnTest && old.fnState() === 'tapped' && oc.now() - oldStartAt >= DEBOUNCE_MS;
        const before = oo.trace.length;
        old.onFnUp({ chord: s.k === 'chord' });
        if (late && old.fnState() === 'tapped' && oo.trace.length === before) {
          old.uiToggle(undefined);
          if (hits) hits.n++;
        }
        neu.fnUp({ chord: s.k === 'chord' });
        break;
      }
      case 'cancel':
        old.uiCancel();
        neu.uiCancel();
        break;
      case 'toggle':
        old.uiToggle(s.mode);
        neu.uiToggle(s.mode);
        break;
      case 'limit':
        old.dictationLimit();
        neu.dictationLimitReached();
        break;
      case 'recStop':
        old.recStop({ discard: s.discard });
        neu.stopReceived({ discard: s.discard });
        break;
      case 'handedOff':
        old.handedOff();
        neu.dictationHandedOff();
        break;
      case 'failed':
        old.failed();
        neu.recordingFailed();
        break;
      case 'fnTest':
        old.setFnTestMode(s.on);
        oldFnTest = s.on;
        neu.setFnTestMode(s.on);
        break;
      case 'advance':
        oc.advanceTo(oc.now() + s.ms);
        nc.advanceTo(nc.now() + s.ms);
        break;
      case 'transcribing':
        world.transcribing = s.n;
        break;
      case 'recording':
        world.recording = recOf(s.mode);
        break;
      case 'enabled':
        world.enabled = s.on;
        break;
      case 'onboarding':
        world.onboarding = s.v;
        break;
    }
    const a = snap(oc, oo, old.fnState());
    const b = snap(nc, no, neu.state());
    if (a !== b) return { step: i, old: a, new: b };
    seen?.add(`상태 ${neu.state()}`);
  }
  for (const line of no.trace) seen?.add(line.split(' ').slice(1, 3).join(' ').replace(/ \{.*/, ''));
  return null;
}

const SEED = 20261121;
const RUNS = 4000;
const timeline = fc.array(stepArb, { minLength: 1, maxLength: 120, size: 'max' });
describe('옮기기 전 코드(src/test/fn-legacy.mjs)와 같다', () => {
  it(`무작위 입력 ${RUNS}벌 (seed ${SEED}): 명령·알림·출력·남은 타이머·상태가 걸음마다 같다`, () => {
    const t0 = performance.now();
    let steps = 0;
    const seen = new Set<string>();
    const hits = { n: 0 };
    fc.assert(
      fc.property(fc.constantFrom(0, 100, 499, 500, 501, 1_763_700_000_000), fc.boolean(), timeline, (start, selftest, list) => {
        steps += list.length;
        const diff = runBoth(start, selftest, list, undefined, seen, { hits });
        if (diff) throw new Error(`seed ${SEED}: ${diff.step}번째 걸음에서 다름\n옛: ${diff.old}\n새: ${diff.new}`);
      }),
      { seed: SEED, numRuns: RUNS },
    );
    const ms = performance.now() - t0;
    console.log(`fn 비교: ${RUNS}벌, 걸음 ${steps}개, seed ${SEED}, 늦은 누름의 뗌(결정 76) ${hits.n}번, ${Math.round(ms)}ms`);
    expect(ms).toBeLessThan(5000);
    expect(hits.n).toBeGreaterThan(0); // 덧씌운 길을 무작위 입력이 실제로 밟는다
    // 무작위 입력이 상태 넷과 보내는 것 전부를 밟았는지
    expect([...seen].sort()).toEqual(
      [
        '상태 idle', '상태 holding', '상태 tapped', '상태 handsfree',
        'cmd start', 'cmd stop', 'cmd cancel', 'overlay overlay:stage', 'overlay:state', 'onboarding:tap', 'onboarding:fn', 'log SELFTEST',
      ].sort(),
    );
  });

  // 비교가 그물 구실을 하는지: 새 모듈에 일부러 다른 값을 끼우면 같은 seed에서 다름을 찾아야 한다
  it.each([
    ['두 번 누르기 판단 499ms', (d: FnDeps) => ({ ...d, debounceMs: 499 })],
    ['녹음 상태를 못 읽음(멈추는 중 표시가 안 켜짐)', (d: FnDeps) => ({ ...d, recording: () => null })],
    ['처리 중 알림을 안 보냄', (d: FnDeps) => ({ ...d, busyNotice: () => {} })],
    ['처음 설정을 안 봄', (d: FnDeps) => ({ ...d, onboarding: () => undefined })],
  ])('일부러 바꾼 것(%s)은 걸린다', (_name, mutate) => {
    const r = fc.check(
      fc.property(fc.constantFrom(0, 1_763_700_000_000), fc.boolean(), timeline, (start, selftest, list) => runBoth(start, selftest, list, mutate) === null),
      { seed: SEED, numRuns: RUNS },
    );
    expect(r.failed).toBe(true);
  });

  // 새 규칙(결정 76)을 빼면 — 옛 코드에 덧씌우지 않은 비교, 곧 규칙 없는 머신과 같은 것 — 걸려야 한다
  it('늦은 누름의 뗌 규칙을 뺀 것은 걸린다', () => {
    const r = fc.check(
      fc.property(fc.constantFrom(0, 1_763_700_000_000), fc.boolean(), timeline, (start, selftest, list) => runBoth(start, selftest, list, undefined, undefined, { deviation: false }) === null),
      { seed: SEED, numRuns: RUNS },
    );
    expect(r.failed).toBe(true);
  });
});
