// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recorder } from './capture.ts';
import { rmsDb } from './capture.ts';
import type { RecorderApi } from '../../shared/api/index.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function media(label: string, events: string[], video = false, audio = true) {
  const audioTrack = { label, stop: vi.fn(() => { events.push(`stop:${label}`); }) };
  const videoTrack = { stop: vi.fn(() => { events.push('stop:video'); }) };
  const tracks = [...(audio ? [audioTrack] : []), ...(video ? [videoTrack] : [])];
  const stream = {
    getAudioTracks: () => audio ? [audioTrack] : [],
    getVideoTracks: () => video ? [videoTrack] : [],
    getTracks: () => tracks,
    removeTrack: vi.fn((track: typeof videoTrack) => { tracks.splice(tracks.indexOf(track), 1); }),
  };
  return { stream: stream as unknown as MediaStream, audioTrack, videoTrack, removeTrack: stream.removeTrack };
}

function setup(label = 'Built-in Microphone') {
  const events: string[] = [];
  const mic = media(label, events);
  const system = media('System Audio', events, true);
  const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => {
    events.push('getMic');
    return Promise.resolve(mic.stream);
  });
  const getDisplayMedia = vi.fn((_constraints: DisplayMediaStreamOptions) => {
    events.push('getSystem');
    return Promise.resolve(system.stream);
  });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, getDisplayMedia } });
  const destination = {};
  const sink = {
    gain: { value: 1 },
    connect: vi.fn((target: unknown) => { events.push('sink.connect'); return target; }),
    disconnect: vi.fn(() => { events.push('sink.disconnect'); }),
  };
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn((_message: unknown) => { events.push('port.stop'); }),
  };
  const node = {
    port,
    connect: vi.fn((target: unknown) => { events.push('node.connect'); return target; }),
    disconnect: vi.fn(() => { events.push('node.disconnect'); }),
  };
  const sources: { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    sampleRate: 48000,
    destination,
    audioWorklet: { addModule: vi.fn((_url: string) => {
      events.push('addModule');
      return Promise.resolve();
    }) },
    suspend: vi.fn(() => { events.push('suspend'); return Promise.resolve(); }),
    resume: vi.fn(() => { events.push('resume'); return Promise.resolve(); }),
    createGain: vi.fn(() => { events.push('createGain'); return sink; }),
    createMediaStreamSource: vi.fn((stream: MediaStream) => {
      const name = stream === mic.stream ? 'mic' : 'system';
      events.push(`source:${name}`);
      const source = {
        connect: vi.fn(() => { events.push(`connect:${name}`); }),
        disconnect: vi.fn(() => { events.push(`disconnect:${name}`); }),
      };
      sources.push(source);
      return source;
    }),
  };
  const AudioContext = vi.fn(function (_options: AudioContextOptions) {
    events.push('context');
    return ctx;
  });
  const AudioWorkletNode = vi.fn(function (_ctx: AudioContext, _name: string, _options: AudioWorkletNodeOptions) {
    events.push('worklet');
    return node;
  });
  vi.stubGlobal('AudioContext', AudioContext);
  vi.stubGlobal('AudioWorkletNode', AudioWorkletNode);
  const saved = {
    dir: '/recordings/test', mode: 'meeting', sampleRate: 48000, bitDepth: 16,
    startedAt: new Date(1000), endedAt: new Date(2000),
    devices: { mic: label }, files: { mic: { file: 'mic.wav', durationSec: 1 } },
  };
  const api = {
    start: vi.fn<RecorderApi['start']>(async () => { events.push('api.start'); return { dir: saved.dir }; }),
    chunk: vi.fn<RecorderApi['chunk']>((track) => { events.push(`chunk:${track}`); }),
    stop: vi.fn<RecorderApi['stop']>(async () => { events.push('api.stop'); return saved; }),
  } satisfies Pick<RecorderApi, 'start' | 'chunk' | 'stop'>;
  const onLevel = vi.fn((track: string, _db: number) => { events.push(`level:${track}`); });
  const recorder = new Recorder({ api, onLevel });
  const emit = (data: unknown) => port.onmessage?.({ data } as MessageEvent);
  return { recorder, api, onLevel, saved, events, mic, system, getUserMedia, getDisplayMedia,
    ctx, sink, node, sources, AudioContext, AudioWorkletNode, emit };
}

const memo = { mode: 'memo' as const, echoCancellation: false };
const meeting = { mode: 'meeting' as const, echoCancellation: true, includeSystem: true };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Recorder prepare and acquisition', () => {
  it('caches pending and completed preparation and suspends after loading the relative worklet', async () => {
    const h = setup();
    const module = deferred<void>();
    h.ctx.audioWorklet.addModule.mockReturnValue(module.promise);
    const first = h.recorder.prepare();
    const second = h.recorder.prepare();
    expect(h.AudioContext).toHaveBeenCalledExactlyOnceWith({ sampleRate: 48000, latencyHint: 'interactive' });
    expect(h.ctx.audioWorklet.addModule).toHaveBeenCalledExactlyOnceWith('recorder-worklet.js');
    expect(h.ctx.suspend).not.toHaveBeenCalled();
    module.resolve();
    await Promise.all([first, second]);
    await h.recorder.prepare();
    expect(h.ctx.suspend).toHaveBeenCalledOnce();
    expect(h.AudioContext).toHaveBeenCalledOnce();
    expect(h.recorder.isRecording).toBe(false);
  });

  it.each(['module', 'suspend'] as const)('caches a rejected %s preparation without retrying', async (stage) => {
    const h = setup();
    const error = new Error('prepare failed');
    const operation = stage === 'module' ? h.ctx.audioWorklet.addModule : h.ctx.suspend;
    operation.mockRejectedValue(error);
    await expect(h.recorder.prepare()).rejects.toBe(error);
    await expect(h.recorder.prepare()).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
    expect(h.AudioContext).toHaveBeenCalledOnce();
    expect(h.ctx.suspend).toHaveBeenCalledTimes(stage === 'module' ? 0 : 1);
  });

  it.each([
    { deviceId: undefined, echoCancellation: false, wanted: undefined },
    { deviceId: '', echoCancellation: true, wanted: undefined },
    { deviceId: 'chosen-mic', echoCancellation: true, wanted: { exact: 'chosen-mic' } },
  ])('keeps every microphone constraint for $deviceId', async ({ deviceId, echoCancellation, wanted }) => {
    const h = setup();
    await expect(h.recorder.getMic({ deviceId, echoCancellation })).resolves.toBe(h.mic.stream);
    expect(h.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: {
      deviceId: wanted, echoCancellation, noiseSuppression: false, autoGainControl: false,
      channelCount: 1, sampleRate: 48000,
    } });
  });

  it('requests display audio and stops/removes video tracks before returning the stream', async () => {
    const h = setup();
    await expect(h.recorder.getSystemAudio()).resolves.toBe(h.system.stream);
    expect(h.getDisplayMedia).toHaveBeenCalledExactlyOnceWith({ audio: true, video: false });
    expect(h.system.videoTrack.stop).toHaveBeenCalledOnce();
    expect(h.system.removeTrack).toHaveBeenCalledExactlyOnceWith(h.system.videoTrack);
    expect(h.system.audioTrack.stop).not.toHaveBeenCalled();
    expect(h.system.stream.getTracks()).toEqual([h.system.audioTrack]);
  });

  it('rejects display streams without audio after removing video', async () => {
    const h = setup();
    const empty = media('empty', h.events, true, false);
    h.getDisplayMedia.mockResolvedValue(empty.stream);
    await expect(h.recorder.getSystemAudio()).rejects.toThrow('시스템 오디오 트랙이 없습니다. 권한(화면 및 시스템 오디오 녹음)을 확인하세요.');
    expect(empty.videoTrack.stop).toHaveBeenCalledOnce();
    expect(empty.stream.getTracks()).toEqual([]);
  });
});

describe('Recorder start and chunks', () => {
  it('acquires mic/system/prepare together, waits for all, and wires the graph in order', async () => {
    const h = setup();
    const mic = deferred<MediaStream>();
    const system = deferred<MediaStream>();
    const module = deferred<void>();
    h.getUserMedia.mockReturnValue(mic.promise);
    h.getDisplayMedia.mockReturnValue(system.promise);
    h.ctx.audioWorklet.addModule.mockReturnValue(module.promise);
    vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(22.6).mockReturnValueOnce(40.2);
    vi.setSystemTime(123456);
    expect(h.recorder.isRecording).toBe(false);
    const starting = h.recorder.start(meeting);
    expect(h.getUserMedia.mock.invocationCallOrder[0]).toBeLessThan(h.getDisplayMedia.mock.invocationCallOrder[0]!);
    expect(h.getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(h.AudioContext.mock.invocationCallOrder[0]!);
    expect(h.recorder.isRecording).toBe(false);
    mic.resolve(h.mic.stream);
    system.resolve(h.system.stream);
    await Promise.resolve();
    expect(h.api.start).not.toHaveBeenCalled();
    module.resolve();
    const result = await starting;
    expect(result).toEqual({ dir: h.saved.dir, tracks: ['mic', 'system'], warnings: [],
      devices: { mic: 'Built-in Microphone', system: 'System Audio' }, timing: { acquireMs: 13, startMs: 30 } });
    expect(h.api.start).toHaveBeenCalledExactlyOnceWith({ mode: 'meeting', sampleRate: 48000,
      tracks: ['mic', 'system'], devices: { mic: 'Built-in Microphone', system: 'System Audio' } });
    expect(h.events.slice(h.events.indexOf('api.start'))).toEqual([
      'api.start', 'resume', 'worklet', 'createGain', 'node.connect', 'sink.connect',
      'source:mic', 'connect:mic', 'source:system', 'connect:system',
    ]);
    expect(h.AudioWorkletNode).toHaveBeenCalledExactlyOnceWith(h.ctx, 'recorder-processor', {
      numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1],
    });
    expect(h.sink.gain.value).toBe(0);
    expect(h.node.connect).toHaveBeenCalledWith(h.sink);
    expect(h.sink.connect).toHaveBeenCalledWith(h.ctx.destination);
    expect(h.ctx.createMediaStreamSource.mock.calls).toEqual([[h.mic.stream], [h.system.stream]]);
    expect(h.sources[0]!.connect).toHaveBeenCalledWith(h.node, 0, 0);
    expect(h.sources[1]!.connect).toHaveBeenCalledWith(h.node, 0, 1);
    expect(h.recorder.active).toMatchObject({ mode: 'meeting', dir: h.saved.dir, startedAt: 123456 });
    expect(h.recorder.isRecording).toBe(true);
    await expect(h.recorder.start(memo)).resolves.toBeUndefined();
    expect(h.api.start).toHaveBeenCalledOnce();
    expect(h.getUserMedia).toHaveBeenCalledOnce();
  });

  it('defaults to mic-only capture and uses the context sample rate in the API request', async () => {
    const h = setup();
    h.ctx.sampleRate = 44100;
    const result = await h.recorder.start(memo);
    expect(result?.tracks).toEqual(['mic']);
    expect(result?.warnings).toEqual([]);
    expect(h.getDisplayMedia).not.toHaveBeenCalled();
    expect(h.api.start).toHaveBeenCalledWith({ mode: 'memo', sampleRate: 44100,
      tracks: ['mic'], devices: { mic: 'Built-in Microphone' } });
    expect(h.AudioWorkletNode).toHaveBeenCalledWith(h.ctx, 'recorder-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    });
  });

  it('continues mic-only on system failure, warning before the Bluetooth hint', async () => {
    const h = setup('AirPods Pro');
    h.getDisplayMedia.mockRejectedValue(new Error('permission denied'));
    const result = await h.recorder.start(meeting);
    expect(result?.tracks).toEqual(['mic']);
    expect(result?.devices).toEqual({ mic: 'AirPods Pro' });
    expect(result?.warnings).toEqual([
      '시스템 오디오를 받지 못해 마이크만 녹음합니다: permission denied',
      '블루투스 마이크(AirPods Pro)는 16kHz 이하로 녹음되고, 켜는 순간 출력 음질도 떨어집니다. 내장 마이크나 유선 마이크를 권장합니다.',
    ]);
    expect(h.recorder.isRecording).toBe(true);
  });

  it.each(['BLUETOOTH', 'Galaxy Buds', 'Headset', 'Hands-Free', 'handsfree', 'Beats', 'Jabra', 'Bose', 'WH-1000XM5', 'WF-1000XM4'])('keeps the Bluetooth hint for %s', async (label) => {
    const h = setup(label);
    const result = await h.recorder.start(memo);
    expect(result?.warnings).toEqual([
      `블루투스 마이크(${label})는 16kHz 이하로 녹음되고, 켜는 순간 출력 음질도 떨어집니다. 내장 마이크나 유선 마이크를 권장합니다.`,
    ]);
  });

  it('keeps missing microphone labels as null device metadata', async () => {
    const h = setup();
    const empty = media('empty', h.events, false, false);
    h.getUserMedia.mockResolvedValue(empty.stream);
    const result = await h.recorder.start(memo);
    expect(result?.devices).toEqual({ mic: null });
    expect(result?.warnings).toEqual([]);
  });

  it('waits for system acquisition before stopping its tracks and rethrowing mic failure', async () => {
    const h = setup();
    const error = new Error('mic denied');
    const system = deferred<MediaStream>();
    h.getUserMedia.mockRejectedValue(error);
    h.getDisplayMedia.mockReturnValue(system.promise);
    const starting = h.recorder.start(meeting);
    const rejected = expect(starting).rejects.toBe(error);
    await Promise.resolve();
    expect(h.system.audioTrack.stop).not.toHaveBeenCalled();
    system.resolve(h.system.stream);
    await rejected;
    expect(h.system.audioTrack.stop).toHaveBeenCalledOnce();
    expect(h.api.start).not.toHaveBeenCalled();
    expect(h.recorder.isRecording).toBe(false);
  });

  it('preserves mic failure when both media requests fail', async () => {
    const h = setup();
    const error = new Error('mic denied');
    h.getUserMedia.mockRejectedValue(error);
    h.getDisplayMedia.mockRejectedValue(new Error('system denied'));
    await expect(h.recorder.start(meeting)).rejects.toBe(error);
    expect(h.api.start).not.toHaveBeenCalled();
  });

  it('continues start even when the cached prepare promise rejected', async () => {
    const h = setup();
    const error = new Error('worklet unavailable');
    h.ctx.audioWorklet.addModule.mockRejectedValue(error);
    await expect(h.recorder.prepare()).rejects.toBe(error);
    await expect(h.recorder.start(memo)).resolves.toMatchObject({ tracks: ['mic'] });
    expect(h.ctx.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(h.ctx.suspend).not.toHaveBeenCalled();
    expect(h.recorder.isRecording).toBe(true);
  });

  it.each(['api', 'resume', 'worklet'] as const)('does not add cleanup on partial start failure at %s', async (stage) => {
    const h = setup();
    const error = new Error('start failed');
    if (stage === 'api') h.api.start.mockRejectedValue(error);
    if (stage === 'resume') h.ctx.resume.mockRejectedValue(error);
    if (stage === 'worklet') h.AudioWorkletNode.mockImplementation(function () { throw error; });
    await expect(h.recorder.start(meeting)).rejects.toBe(error);
    expect(h.recorder.isRecording).toBe(false);
    expect(h.mic.audioTrack.stop).not.toHaveBeenCalled();
    expect(h.system.audioTrack.stop).not.toHaveBeenCalled();
    expect(h.ctx.suspend).toHaveBeenCalledOnce();
    expect(h.api.stop).not.toHaveBeenCalled();
  });

  it('forwards each original chunk before its RMS callback and ignores non-chunk messages', async () => {
    const h = setup();
    await h.recorder.start(meeting);
    h.events.length = 0;
    h.emit(null);
    h.emit('done');
    h.emit({ unrelated: true });
    expect(h.api.chunk).not.toHaveBeenCalled();
    const mic = new Float32Array([0.5, -0.5]);
    const system = new Float32Array([1, -1]);
    h.emit({ tracks: [mic, system] });
    expect(h.events).toEqual(['chunk:mic', 'level:mic', 'chunk:system', 'level:system']);
    expect(h.api.chunk.mock.calls).toEqual([['mic', mic], ['system', system]]);
    expect(h.api.chunk.mock.calls[0]![1]).toBe(mic);
    expect(h.onLevel.mock.calls[0]![0]).toBe('mic');
    expect(h.onLevel.mock.calls[0]![1]).toBeCloseTo(-6.0205999115, 8);
    expect(h.onLevel.mock.calls[1]![1]).toBeCloseTo(0, 8);
  });

  it('forwards chunks without an optional level callback', async () => {
    const h = setup();
    const recorder = new Recorder({ api: h.api });
    await recorder.start(memo);
    const samples = new Float32Array([0]);
    h.emit({ tracks: [samples] });
    expect(h.api.chunk).toHaveBeenCalledExactlyOnceWith('mic', samples);
  });
});

describe('Recorder stop', () => {
  it('returns null while idle without touching media or the API', async () => {
    const h = setup();
    await expect(h.recorder.stop()).resolves.toBeNull();
    expect(h.recorder.isRecording).toBe(false);
    expect(h.events).toEqual([]);
  });

  it('clears active before posting stop, drains trailing chunks until done, then cleans up and awaits API stop', async () => {
    const h = setup();
    await h.recorder.start(meeting);
    h.events.length = 0;
    const stopped = deferred<typeof h.saved>();
    h.api.stop.mockImplementation(() => { h.events.push('api.stop'); return stopped.promise; });
    h.node.port.postMessage.mockImplementation(() => {
      expect(h.recorder.isRecording).toBe(false);
      h.events.push('port.stop');
    });
    const stopping = h.recorder.stop();
    expect(h.events).toEqual(['port.stop']);
    expect(h.node.port.postMessage).toHaveBeenCalledWith('stop');
    await expect(h.recorder.stop()).resolves.toBeNull();
    const samples = new Float32Array([0.5]);
    h.emit({ tracks: [samples, samples] });
    expect(h.api.stop).not.toHaveBeenCalled();
    h.emit('done');
    let settled = false;
    void stopping.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.events).toEqual([
      'port.stop', 'chunk:mic', 'level:mic', 'chunk:system', 'level:system',
      'disconnect:mic', 'disconnect:system', 'node.disconnect', 'sink.disconnect',
      'stop:Built-in Microphone', 'stop:System Audio', 'suspend', 'api.stop',
    ]);
    expect(h.api.stop).toHaveBeenCalledExactlyOnceWith({ discard: false });
    expect(settled).toBe(false);
    stopped.resolve(h.saved);
    await expect(stopping).resolves.toBe(h.saved);
    expect(h.recorder.isRecording).toBe(false);
  });

  it('drains for exactly 1000 ms without done and waits for suspend before passing discard', async () => {
    const h = setup();
    await h.recorder.start(memo);
    h.events.length = 0;
    const suspended = deferred<void>();
    h.ctx.suspend.mockImplementation(() => { h.events.push('suspend'); return suspended.promise; });
    h.api.stop.mockResolvedValue(null);
    const stopping = h.recorder.stop({ discard: true });
    await vi.advanceTimersByTimeAsync(999);
    expect(h.events).toEqual(['port.stop']);
    expect(h.recorder.isRecording).toBe(false);
    const samples = new Float32Array([0]);
    h.emit({ tracks: [samples] });
    expect(h.api.chunk).toHaveBeenCalledWith('mic', samples);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.events).toEqual(['port.stop', 'chunk:mic', 'level:mic', 'disconnect:mic',
      'node.disconnect', 'sink.disconnect', 'stop:Built-in Microphone', 'suspend']);
    expect(h.api.stop).not.toHaveBeenCalled();
    suspended.resolve();
    await expect(stopping).resolves.toBeNull();
    expect(h.api.stop).toHaveBeenCalledExactlyOnceWith({ discard: true });
  });

  it('handles done sent synchronously in response to stop and can record again', async () => {
    const h = setup();
    await h.recorder.start(memo);
    h.node.port.postMessage.mockImplementation(() => { h.emit('done'); });
    await h.recorder.stop();
    expect(vi.getTimerCount()).toBe(0);
    await h.recorder.start(memo);
    expect(h.recorder.isRecording).toBe(true);
    expect(h.AudioContext).toHaveBeenCalledOnce();
    expect(h.api.start).toHaveBeenCalledTimes(2);
  });

  it.each(['suspend', 'api'] as const)('propagates %s stop failure with recording already inactive', async (stage) => {
    const h = setup();
    await h.recorder.start(memo);
    const error = new Error('stop failed');
    if (stage === 'suspend') h.ctx.suspend.mockRejectedValue(error);
    else h.api.stop.mockRejectedValue(error);
    h.node.port.postMessage.mockImplementation(() => { h.emit('done'); });
    await expect(h.recorder.stop()).rejects.toBe(error);
    expect(h.recorder.isRecording).toBe(false);
    expect(h.mic.audioTrack.stop).toHaveBeenCalledOnce();
    expect(h.api.stop).toHaveBeenCalledTimes(stage === 'api' ? 1 : 0);
  });
});

describe('rmsDb', () => {
  it.each([
    { samples: [], db: -200 },
    { samples: [0, 0], db: -200 },
    { samples: [1, -1], db: 0 },
    { samples: [0.5, -0.5], db: -6.0205999115 },
    { samples: [0, 1], db: -3.0102999554 },
  ])('computes RMS for $samples', ({ samples, db }) => {
    expect(rmsDb(new Float32Array(samples))).toBeCloseTo(db, 8);
  });
});
