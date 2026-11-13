import type { SettingsStore } from '../../entities/settings/index.ts';
import type { IssueStore } from '../../entities/issue/index.ts';
import type { RecorderApi } from '../../shared/api/index.ts';
import { clock, remember, store } from '../../shared/lib/index.ts';
import { el as h } from '../../shared/ui/index.tsx';
import type { confirmBox, createToaster } from '../../shared/ui/index.tsx';
import { Recorder } from './capture.ts';
import type { RecordingMode } from './capture.ts';

export interface RecordingDeps {
  readonly api: Omit<RecorderApi, 'onDictStage' | 'onDictResult'> & {
    readonly onDictStage: (handler: (stage: { stage: string }) => void) => void;
    readonly onDictResult: (handler: (result: { status: string; error?: string; id?: string | null }) => void) => void;
  };
  readonly settings: SettingsStore;
  readonly issues: IssueStore;
  readonly toast: ReturnType<typeof createToaster>;
  readonly confirm: typeof confirmBox;
  readonly readInput: () => { deviceId?: string; echoCancellation: boolean };
  readonly openSettings: (sec: string) => void;
  readonly historyChanged: () => void;
  readonly dictationFinished: (id: string | null) => void;
}

export interface RecordingHandle {
  readonly status: () => { mode: RecordingMode | null; paused: boolean };
  readonly openStart: () => void;
  readonly cancel: () => void;
  readonly prepare: () => Promise<void>;
}

type RecordingCommand = { action: 'start' | 'stop' | 'cancel'; mode: RecordingMode };
type RecordingElements = {
  tape: HTMLCanvasElement;
  live: HTMLDivElement;
  liveText: HTMLSpanElement;
  liveTime: HTMLSpanElement;
  route: HTMLOListElement;
  memoBtn: HTMLButtonElement;
  meetingBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  cancelBtn: HTMLButtonElement;
  liveSpeakers: HTMLLabelElement;
  liveSpeakersSel: HTMLSelectElement;
  startSpeakers: HTMLDivElement;
  startKind: HTMLDivElement;
  startMinutes: HTMLInputElement;
  meetStart: HTMLDialogElement;
  startYes: HTMLButtonElement;
  startNo: HTMLButtonElement;
  startClose: HTMLButtonElement;
};

export function mountRecording({ api, settings: settingsStore, issues, toast, confirm, readInput, openSettings, historyChanged, dictationFinished }: RecordingDeps): RecordingHandle {
  const $ = <K extends keyof RecordingElements>(id: K) => document.getElementById(id) as RecordingElements[K];

  // ── 녹음 ────────────────────────────────────────────────────────────────
  const peakDb = { mic: -Infinity, system: -Infinity };
  const tape = { levels: [] as number[], ctx: $('tape').getContext('2d')! };
  const recorder = new Recorder({
    api,
    onLevel: (track, db) => {
      peakDb[track] = Math.max(peakDb[track], db);
      if (track === 'mic') pushLevel(db);
    },
  });

  function pushLevel(db: number) {
    if (liveClock.paused) return;
    tape.levels.push(Math.max(0, Math.min(1, (db + 60) / 54)));
    if (tape.levels.length > 60) tape.levels.shift();
    drawTape();
  }

  function drawTape() {
    const canvas = $('tape');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (!w) return;
    if (canvas.width !== w * dpr) {
      canvas.width = w * dpr;
      canvas.height = hgt * dpr;
    }
    const { ctx } = tape;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    const step = 4;
    const levels = tape.levels.slice(-Math.floor(w / step));
    levels.forEach((v, i) => {
      const bar = Math.max(2, Math.round(v * hgt));
      ctx.beginPath();
      ctx.roundRect(w - (levels.length - i) * step, (hgt - bar) / 2, 2, bar, 1);
      ctx.fill();
    });
  }

  let liveTimer: ReturnType<typeof setInterval> | undefined;
  let recordingMode: RecordingMode | null = null;
  let liveClock = { elapsedMs: 0, at: Date.now(), paused: false }; // 회의 일시정지를 반영한 녹음 시간 (기준은 메인 프로세스)
  const liveElapsed = () => (liveClock.paused ? liveClock.elapsedMs : liveClock.elapsedMs + Date.now() - liveClock.at);

  function setLive(state: string, text = '') {
    const live = $('live');
    live.hidden = state === 'idle';
    live.dataset.state = state;
    $('liveText').textContent = text;
    $('route').hidden = state !== 'working';
    $('tape').hidden = state !== 'memo' && state !== 'meeting';
    clearInterval(liveTimer);
    $('liveTime').textContent = '';
    if (state === 'memo' || state === 'meeting' || state === 'paused') {
      if (state !== 'paused') {
        tape.levels = [];
        drawTape();
      }
      const tick = () => ($('liveTime').textContent = clock(liveElapsed() / 1000));
      tick();
      liveTimer = setInterval(tick, 250);
    }
  }

  function setRecording(mode: RecordingMode | null) {
    recordingMode = mode;
    const memo = $('memoBtn');
    const meet = $('meetingBtn');
    memo.classList.toggle('on', mode === 'memo');
    meet.classList.toggle('on', mode === 'meeting');
    memo.querySelector('span')!.textContent = mode === 'memo' ? '받아쓰기 정지' : '받아쓰기';
    meet.querySelector('span')!.textContent = mode === 'meeting' ? '종료하고 저장' : '회의 녹음';
    meet.querySelector('use')!.setAttribute('href', mode === 'meeting' ? '#i-stop' : '#i-rec');
    memo.disabled = mode === 'meeting';
    meet.disabled = mode === 'memo';
    memo.hidden = mode === 'meeting'; // 회의 중에는 취소 · 일시정지 · 종료만 보인다
    $('cancelBtn').hidden = mode !== 'meeting';
    $('pauseBtn').hidden = mode !== 'meeting';
    $('liveSpeakers').hidden = mode !== 'meeting';
    if (mode === 'meeting') $('liveSpeakersSel').value = startedFromSheet ? startSpeakers : '';
    startedFromSheet = false;
    liveClock = { elapsedMs: 0, at: Date.now(), paused: false };
    setPauseButton(false);
    if (mode === 'memo') setLive('memo', '듣는 중');
    else if (mode === 'meeting') setLive('meeting', '회의 녹음 중');
    else if ($('live').dataset.state !== 'working') setLive('idle');
  }

  function setPauseButton(paused: boolean) {
    const b = $('pauseBtn');
    b.querySelector('span')!.textContent = paused ? '재개' : '일시정지';
    b.querySelector('use')!.setAttribute('href', paused ? '#i-play' : '#i-pause');
    b.classList.toggle('on', paused);
  }

  api.onClock((c: { mode: RecordingMode; elapsedMs: number; paused: boolean } | null) => {
    if (!c || c.mode !== 'meeting' || recordingMode !== 'meeting') return;
    liveClock = { elapsedMs: c.elapsedMs, at: Date.now(), paused: c.paused };
    setPauseButton(c.paused);
    setLive(c.paused ? 'paused' : 'meeting', c.paused ? '일시정지됨' : '회의 녹음 중');
  });

  $('pauseBtn').onclick = () => api.pause(!liveClock.paused);
  const cancel = async () => {
    const min = Math.round(liveElapsed() / 60000);
    if (await confirm('회의 녹음을 취소할까요?', `지금까지 녹음한 ${min ? `${min}분` : '내용'}이 저장되지 않고 지워집니다.`, '녹음 버리기')) api.cancel();
  };

  $('cancelBtn').onclick = cancel;

  const STAGES = ['listen', 'transcribe', 'cleanup', 'paste'];
  function showStage(stage: string) {
    setLive('working', '받아쓰는 중');
    const at = STAGES.indexOf(stage);
    for (const li of $('route').children as HTMLCollectionOf<HTMLElement>) {
      const i = STAGES.indexOf(li.dataset.stage!);
      li.className = i < at ? 'done' : i === at ? 'now' : '';
    }
  }

  // 메인 프로세스 명령은 도착 순서대로 하나씩 처리한다 (꾹 눌렀다 바로 떼면 start → cancel이 연달아 온다)
  let cmdQueue = Promise.resolve();
  function enqueue(cmd: RecordingCommand) {
    cmdQueue = cmdQueue.then(() => run(cmd)).catch((err) => toast('오류', err.message, { bad: true }));
  }

  async function run({ action, mode }: RecordingCommand) {
    if (action === 'start') {
      if (recorder.isRecording) return;
      peakDb.mic = peakDb.system = -Infinity;
      try {
        const { warnings, timing } = (await recorder.start({
          mode,
          ...readInput(),
          includeSystem: mode === 'meeting' && Boolean(settingsStore.getSnapshot().saved?.meetingSystemAudio),
        }))!;
        warnings.forEach((w) => toast('녹음 경고', w, { bad: true, ms: 7000 }));
        setRecording(mode);
        api.log(`start timing ${mode} ${JSON.stringify(timing)}`);
      } catch (error) {
        const err = error as Error;
        setRecording(null);
        api.failed();
        if (/EPERM|EACCES|operation not permitted/i.test(err.message)) {
          toast('녹음 폴더에 쓸 수 없습니다', 'macOS가 이 앱의 문서 폴더 접근을 막았습니다', { bad: true, ms: 10000, action: '권한 열기', onAction: () => api.permOpenSettings('files') });
          historyChanged();
        } else toast('녹음을 시작하지 못했습니다', err.message, { bad: true, ms: 8000 });
      }
      return;
    }

    const wasMode = recordingMode;
    const result = await recorder.stop({ discard: action === 'cancel' });
    setRecording(null);
    if (action === 'cancel' && wasMode === 'meeting') toast('회의 녹음을 취소했습니다', '녹음은 저장하지 않았습니다');
    if (!result) return;
    const savedSec = Math.max(0, ...Object.values(result.files ?? {}).map((f) => f.durationSec ?? 0));
    if (wasMode === 'meeting' && savedSec >= 10) toast('회의 녹음을 저장했습니다', settingsStore.getSnapshot().saved?.minutes ? '회의록을 만들기 시작합니다' : '');
    historyChanged();
    // 권한이 없으면 macOS는 에러 없이 완전한 무음(0)을 넘겨준다
    if (result.files.system && peakDb.system < -150) {
      issues.set('system-silent', { title: '상대방 소리가 녹음되지 않았습니다', detail: '시스템 오디오 녹음 권한을 허용한 뒤 앱을 다시 실행하세요.', action: '권한 보기', onAction: () => openSettings('perms'), sec: 'perms', dismiss: true });
    }
  }

  $('memoBtn').onclick = () => api.toggle('memo');
  $('meetingBtn').onclick = () => (recordingMode === 'meeting' ? api.toggle('meeting') : openMeetingStart());

  // ── 회의 녹음 시작 시트: 참석 인원 · 대면/화상 · 회의록 자동 ─────────────────
  const SPEAKER_CHOICES = ['', '2', '3', '4', '5', '6', '7', '8'];
  const speakerLabel = (v: string) => (v ? `${v}명` : '자동');
  let startSpeakers = store('startSpeakers', '');
  let startedFromSheet = false; // 독·메뉴바에서 시작하면 시트를 거치지 않으므로 자동으로 둔다

  function segPick(box: HTMLElement, attr: string, value: string | undefined) {
    for (const b of box.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset[attr] === value));
  }

  function openMeetingStart() {
    if (recordingMode) return;
    const box = $('startSpeakers');
    box.replaceChildren(...SPEAKER_CHOICES.map((v) => h('button', { type: 'button', role: 'radio', 'data-n': v, onclick: () => { startSpeakers = v; segPick(box, 'n', v); } }, speakerLabel(v))));
    segPick(box, 'n', startSpeakers);
    const kind = settingsStore.getSnapshot().saved?.meetingSystemAudio ? 'online' : 'offline';
    segPick($('startKind'), 'kind', kind);
    $('startMinutes').checked = Boolean(settingsStore.getSnapshot().saved?.minutes);
    $('meetStart').showModal();
    $('startYes').focus();
  }
  for (const b of $('startKind').querySelectorAll('button')) b.onclick = () => segPick($('startKind'), 'kind', b.dataset.kind);
  $('startNo').onclick = () => $('meetStart').close();
  $('startClose').onclick = () => $('meetStart').close();
  $('meetStart').addEventListener('click', (e) => e.target === $('meetStart') && $('meetStart').close());
  $('startYes').onclick = async () => {
    const online = $('startKind').querySelector<HTMLElement>('[aria-checked="true"]')?.dataset.kind === 'online';
    const patch: { meetingSystemAudio?: boolean; minutes?: boolean } = {};
    if (online !== Boolean(settingsStore.getSnapshot().saved?.meetingSystemAudio)) patch.meetingSystemAudio = online;
    if ($('startMinutes').checked !== Boolean(settingsStore.getSnapshot().saved?.minutes)) patch.minutes = $('startMinutes').checked;
    if (Object.keys(patch).length) await settingsStore.save(patch);
    remember('startSpeakers', startSpeakers);
    api.setSpeakers(startSpeakers || null);
    startedFromSheet = true;
    $('meetStart').close();
    api.toggle('meeting');
  };

  // 녹음 중 참석 인원 바꾸기 (위쪽 막대)
  $('liveSpeakersSel').append(...SPEAKER_CHOICES.map((v) => h('option', { value: v }, v ? `참석 ${speakerLabel(v)}` : '참석 자동')));
  $('liveSpeakersSel').onchange = (e) => api.setSpeakers((e.target as HTMLSelectElement).value || null);
  api.onCommand(enqueue);

  api.onDictStage(({ stage }: { stage: string }) => showStage(stage));

  api.onDictResult((r: { status: string; error?: string; id?: string | null }) => {
    setLive('idle');
    if (r.status === 'error') toast('받아쓰기 실패', r.error, { bad: true, ms: 7000 });
    else if (r.status === 'no-permission') toast('입력하지 못했습니다', '손쉬운 사용 권한이 없어 클립보드에만 복사했습니다. ⌘V로 붙여 넣으세요.', { bad: true, action: '권한 보기', onAction: () => openSettings('perms'), ms: 8000 });
    else if (r.status === 'failed') toast('입력하지 못했습니다', '클립보드에 복사해 두었습니다. ⌘V로 붙여 넣으세요.', { bad: true, ms: 7000 });
    dictationFinished(r.id ?? null);
  });

  setRecording(null);
  return {
    status: () => ({ mode: recordingMode, paused: liveClock.paused }),
    openStart: openMeetingStart,
    cancel,
    prepare: () => recorder.prepare(),
  };
}
