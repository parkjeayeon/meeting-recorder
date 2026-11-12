// 회의 녹음 재생의 상태: 앱에 하나뿐인 audio 요소(화면을 다시 그려도 재생이 끊기지 않게 문서 밖에 둠)와 '따라가기'.
// 재생 막대와 스크립트(지금 재생 중인 줄)가 같이 구독한다.
export const SPEEDS = [1, 1.25, 1.5, 2] as const;

export interface PlaybackState {
  readonly time: number;
  readonly paused: boolean;
  /** 녹음 길이 (아직 모르면 NaN) */
  readonly duration: number;
  readonly rate: number;
  /** 재생 중인 줄을 따라 화면을 옮긴다 */
  readonly follow: boolean;
}
export interface Playback {
  readonly audio: HTMLAudioElement;
  readonly subscribe: (onChange: () => void) => () => void;
  readonly getSnapshot: () => PlaybackState;
  readonly seek: (sec: number, play?: boolean) => void;
  readonly toggle: () => void;
  readonly skip: (sec: number) => void;
  /** 다음 재생 속도로 (1 → 1.25 → 1.5 → 2 → 1) */
  readonly nextRate: () => void;
  readonly setFollow: (on: boolean) => void;
}

const EVENTS = ['timeupdate', 'play', 'pause', 'loadedmetadata', 'seeked', 'ratechange', 'durationchange'];

export function createPlayback(audio: HTMLAudioElement, follow: { readonly initial: boolean; readonly save: (on: boolean) => void }): Playback {
  let followOn = follow.initial;
  let snap: PlaybackState | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    snap = null;
    for (const l of [...listeners]) l();
  };
  for (const ev of EVENTS) audio.addEventListener(ev, changed);
  return {
    audio,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => (snap ??= { time: audio.currentTime, paused: audio.paused, duration: audio.duration, rate: audio.playbackRate, follow: followOn }),
    seek: (sec, play = true) => {
      audio.currentTime = sec;
      if (play) void audio.play();
    },
    toggle: () => void (audio.paused ? audio.play() : audio.pause()),
    skip: (sec) => {
      audio.currentTime += sec;
    },
    nextRate: () => {
      audio.playbackRate = SPEEDS[(SPEEDS.indexOf(audio.playbackRate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]!;
    },
    setFollow: (on) => {
      followOn = on;
      follow.save(on);
      changed();
    },
  };
}
