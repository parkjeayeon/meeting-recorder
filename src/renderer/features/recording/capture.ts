import type { RecorderApi } from '../../shared/api/index.ts';

export type RecordingMode = 'memo' | 'meeting';
export type RecordingTrack = 'mic' | 'system';

export interface RecorderOptions {
  api: Pick<RecorderApi, 'start' | 'chunk' | 'stop'>;
  onLevel?: (track: RecordingTrack, db: number) => void;
}

export interface RecorderMicOptions {
  deviceId?: string;
  echoCancellation: boolean;
}

export interface RecorderStartOptions extends RecorderMicOptions {
  mode: RecordingMode;
  includeSystem?: boolean;
}

export interface RecorderStopOptions {
  discard?: boolean;
}

export interface RecorderStartResult {
  dir: string;
  tracks: RecordingTrack[];
  warnings: string[];
  devices: Partial<Record<RecordingTrack, string | null>>;
  timing: { acquireMs: number; startMs: number };
}

export interface RecorderStopResult {
  dir: string;
  mode: RecordingMode;
  sampleRate: number;
  bitDepth: number;
  startedAt: Date;
  endedAt: Date;
  devices: Partial<Record<RecordingTrack, string | null>>;
  files: Partial<Record<RecordingTrack, { file: string; durationSec: number }>>;
  speakers?: number;
}

interface ActiveRecording {
  mode: RecordingMode;
  node: AudioWorkletNode;
  sink: GainNode;
  sources: MediaStreamAudioSourceNode[];
  streams: Partial<Record<RecordingTrack, MediaStream>>;
  dir: string;
  startedAt: number;
}

// 마이크 / 시스템 오디오를 하나의 AudioContext(48kHz)로 받아 트랙별 WAV로 기록한다.
const SAMPLE_RATE = 48000;
const BLUETOOTH_HINT = /airpods|bluetooth|buds|headset|hands-?free|beats|jabra|bose|wh-1000|wf-1000/i;

export class Recorder {
  declare api: RecorderOptions['api'];
  declare onLevel: RecorderOptions['onLevel'];
  declare active: ActiveRecording | null;
  declare ready?: Promise<void>;
  declare ctx: AudioContext;

  constructor({ api, onLevel }: RecorderOptions) {
    this.api = api;
    this.onLevel = onLevel;
    this.active = null;
  }

  get isRecording(): boolean {
    return this.active !== null;
  }

  // AudioContext와 Worklet을 앱 시작 때 미리 준비해 둔다 (꾹 누르기 시작 지연 단축).
  // 대기 중에는 suspend 상태라 오디오 장치를 점유하지 않는다.
  async prepare(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
      await this.ctx.audioWorklet.addModule('recorder-worklet.js');
      await this.ctx.suspend();
    })();
    return this.ready;
  }

  async getMic({ deviceId, echoCancellation }: RecorderMicOptions): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
      },
    });
  }

  async getSystemAudio(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
    for (const t of stream.getVideoTracks()) {
      t.stop();
      stream.removeTrack(t);
    }
    if (stream.getAudioTracks().length === 0) {
      throw new Error('시스템 오디오 트랙이 없습니다. 권한(화면 및 시스템 오디오 녹음)을 확인하세요.');
    }
    return stream;
  }

  // mode: 'memo' | 'meeting'. includeSystem이면 상대방 소리(시스템 오디오)도 따로 녹음한다
  async start({ mode, deviceId, echoCancellation, includeSystem = false }: RecorderStartOptions): Promise<RecorderStartResult | undefined> {
    if (this.active) return;
    const t0 = performance.now();
    const streams: Partial<Record<RecordingTrack, MediaStream>> = {};
    const warnings: string[] = [];
    const [mic, system] = await Promise.allSettled([
      this.getMic({ deviceId, echoCancellation }),
      includeSystem ? this.getSystemAudio() : Promise.resolve(null),
      this.prepare(),
    ]);
    if (mic.status === 'rejected') {
      if (system.status === 'fulfilled') system.value?.getTracks().forEach((t) => t.stop());
      throw mic.reason;
    }
    streams.mic = mic.value;
    if (system.status === 'fulfilled' && system.value) streams.system = system.value;
    else if (system.status === 'rejected') warnings.push(`시스템 오디오를 받지 못해 마이크만 녹음합니다: ${system.reason.message}`);
    const acquireMs = Math.round(performance.now() - t0);

    const micLabel = streams.mic.getAudioTracks()[0]?.label ?? '';
    if (BLUETOOTH_HINT.test(micLabel)) {
      warnings.push(`블루투스 마이크(${micLabel})는 16kHz 이하로 녹음되고, 켜는 순간 출력 음질도 떨어집니다. 내장 마이크나 유선 마이크를 권장합니다.`);
    }

    const ctx = this.ctx;
    const tracks = Object.keys(streams) as RecordingTrack[];
    const devices = Object.fromEntries(tracks.map((t) => [t, streams[t]!.getAudioTracks()[0]?.label ?? null]));
    const { dir } = await this.api.start({ mode, sampleRate: ctx.sampleRate, tracks, devices });

    await ctx.resume();
    const node = new AudioWorkletNode(ctx, 'recorder-processor', {
      numberOfInputs: tracks.length,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    // 출력은 쓰지 않지만 그래프가 계속 처리되도록 무음으로 destination에 연결
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    const startMs = Math.round(performance.now() - t0);

    const sources = tracks.map((t, i) => {
      const src = ctx.createMediaStreamSource(streams[t]!);
      src.connect(node, 0, i);
      return src;
    });

    node.port.onmessage = (e: MessageEvent<{ tracks?: Float32Array[] } | null>) => {
      if (!e.data?.tracks) return;
      e.data.tracks.forEach((samples, i) => {
        this.api.chunk(tracks[i], samples);
        this.onLevel?.(tracks[i]!, rmsDb(samples));
      });
    };

    this.active = { mode, node, sink, sources, streams, dir, startedAt: Date.now() };
    return { dir, tracks, warnings, devices, timing: { acquireMs, startMs } };
  }

  async stop({ discard = false }: RecorderStopOptions = {}): Promise<RecorderStopResult | null> {
    if (!this.active) return null;
    const { node, sink, sources, streams } = this.active;
    this.active = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      const prev = node.port.onmessage as ((e: MessageEvent) => void) | null;
      node.port.onmessage = (e) => {
        prev?.(e);
        if (e.data === 'done') {
          clearTimeout(timer);
          resolve();
        }
      };
      node.port.postMessage('stop');
    });
    sources.forEach((s) => s.disconnect());
    node.disconnect();
    sink.disconnect();
    Object.values(streams).forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await this.ctx.suspend();
    return this.api.stop({ discard });
  }
}

export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return 20 * Math.log10(Math.sqrt(sum / Math.max(1, samples.length)) + 1e-10);
}
