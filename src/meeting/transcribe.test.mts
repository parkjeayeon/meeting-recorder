import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeDeps, meetingDir, readJson, tmpDir } from '../test/meeting.mjs';
import { DIARIZE_MODEL_DIR, diarizeAvailable } from './diarize.mjs';
import { MEETING_MODEL, meetingAsr, transcribeMeeting, type MeetingMeta } from './transcribe.mjs';
import type { Segment } from './transcript.mjs';

// 조각 하나의 녹취: 4~24초가 같은 문장 반복(findLoops가 찾는다) → 그 구간만 앞 문장 없이 다시 받아쓴다
const LOOPING: Segment[] = [
  { start: 0, end: 4, text: '안건부터 보겠습니다' },
  { start: 4, end: 9, text: '다음 주까지 정리해 주세요' },
  { start: 9, end: 14, text: '다음 주까지 정리해 주세요' },
  { start: 14, end: 19, text: '다음 주까지 정리해 주세요' },
  { start: 19, end: 24, text: '다음 주까지 정리해 주세요' },
  { start: 24, end: 27, text: '네 알겠습니다' },
];
const REDONE: Segment[] = [{ start: 0.5, end: 4, text: '정리는 제가 맡겠습니다' }];

let root = '';
let userData = '';
beforeEach(() => {
  root = tmpDir('mr-transcribe-');
  userData = path.join(root, 'userData');
  fs.mkdirSync(userData);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

type Reported = { status: string; extra: Record<string, unknown> };
const run = async (dir: string, settings: Parameters<typeof transcribeMeeting>[2], speakers: number | null = null) => {
  const reports: Reported[] = [];
  const timing: Record<string, unknown> = {};
  const meta: MeetingMeta = readJson(dir, 'meta.json');
  const r = await transcribeMeeting(dir, meta, settings, speakers, timing, (status, extra = {}) => reports.push({ status, extra }));
  return { ...r, reports, timing, progress: reports.map((x) => x.extra.progress as number) };
};
const leftovers = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('.'));
const nondecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]!);

describe('transcribeMeeting', () => {
  it('조각 녹취 → 반복 구간만 다시 → segments.json·transcript.txt, 임시 파일은 지운다', async () => {
    const dir = meetingDir(root, 'm1');
    const f = fakeDeps(userData, {
      transcribe: (file) => {
        if (file.endsWith('.redo.wav')) return REDONE;
        f.progress?.(0.25);
        f.progress?.(0.255); // 1% 단위로만 기록
        f.progress?.(0.5);
        return LOOPING;
      },
    });
    const r = await run(dir, f.settings);

    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe('[00:00] 안건부터 보겠습니다\n[00:04] 정리는 제가 맡겠습니다\n[00:24] 네 알겠습니다\n');
    expect(r.transcript).toBe('[00:00] 안건부터 보겠습니다\n[00:04] 정리는 제가 맡겠습니다\n[00:24] 네 알겠습니다');
    expect(r.diarizeInfo).toEqual({ speakers: 0, diarizeError: null });

    const seg = readJson(dir, 'segments.json');
    expect(Object.keys(seg)).toEqual(['model', 'tracks', 'redo', 'segments']); // VAD를 안 켰으면 vad 칸이 없다
    expect(seg.model).toBe('large-v3');
    expect(seg.tracks).toEqual(['mic']);
    expect(seg.redo).toEqual([{ start: 4, end: 24, stillLooping: false, ms: expect.any(Number), track: 'mic' }]);
    expect(seg.segments.map((s: Segment) => [s.start, s.text])).toEqual([
      [0, '안건부터 보겠습니다'],
      [4.5, '정리는 제가 맡겠습니다'],
      [24, '네 알겠습니다'],
    ]);
    expect(fs.existsSync(path.join(dir, 'diarization.json'))).toBe(false);

    // 회의 언어로, 회의용 서버의 포트로. 다시 받아쓰기는 앞 문장 없이
    expect(f.asr).toEqual([
      { file: '.piece-0.wav', language: 'en', port: 4321, noContext: undefined, argc: 3 },
      { file: '.piece-0.wav.redo.wav', language: 'en', port: 4321, noContext: true, argc: 4 },
    ]);
    expect(f.servers).toEqual([{ modelFile: path.join(userData, 'models', MEETING_MODEL), vad: null, argc: 2 }]);
    expect(f.stopped).toBeGreaterThanOrEqual(1);
    expect(f.progress).toBeNull(); // 다시 받아쓰기 전에 진행률 콜백을 뗀다

    expect(r.progress).toEqual([0, 0.25, 0.5, 1]);
    expect(r.reports.every((x) => x.status === 'transcribe')).toBe(true);
    expect(r.timing).toMatchObject({ model: 'large-v3', transcribeMs: expect.any(Number), redo: seg.redo });
    expect(r.timing.vad).toBeUndefined();
    expect(leftovers(dir)).toEqual([]);
  });

  it('긴 녹음은 조각마다 받아쓰고 진행률은 전체로 환산해 줄지 않는다', async () => {
    // 1kHz로 11분 — 조각 내기·진행률은 WAV 머리의 표본율을 그대로 쓴다 (16kHz 11분짜리를 만들지 않으려고)
    const dir = meetingDir(root, 'long', { sec: 660, rate: 1000, quiet: [[598, 602]] });
    const f = fakeDeps(userData, {
      transcribe: (file) => {
        f.progress?.(0.5);
        return [{ start: 1, end: 3, text: `${file.includes('piece-0') ? '첫' : '둘째'} 조각` }];
      },
    });
    const r = await run(dir, f.settings);
    expect(f.asr.map((c) => c.file)).toEqual(['.piece-0.wav', '.piece-1.wav']);
    expect(r.progress).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(nondecreasing(r.progress)).toBe(true);
    const seg = readJson(dir, 'segments.json');
    expect(seg.segments[1].start).toBeGreaterThan(598); // 둘째 조각은 자른 자리만큼 뒤로
    expect(seg.redo).toEqual([]);
    expect(r.timing.redo).toBeUndefined();
    expect(leftovers(dir)).toEqual([]);
  });

  it('회의용 서버를 못 띄우면 받아쓰기용 모델(turbo)로 기록하고 포트 없이 받아쓴다', async () => {
    for (const mode of ['fail', 'null'] as const) {
      const dir = meetingDir(root, `no-server-${mode}`);
      const f = fakeDeps(userData, { server: mode, transcribe: () => [{ start: 0, end: 2, text: '안녕하세요' }] });
      const r = await run(dir, f.settings);
      expect(r.timing.model).toBe('large-v3-turbo');
      expect(readJson(dir, 'segments.json').model).toBe('large-v3-turbo');
      expect(f.asr[0]!.port).toBeNull();
      expect(r.progress).toEqual([0, 1]); // 서버가 없으면 조각 안 진행률도 없다
      expect(leftovers(dir)).toEqual([]);
    }
  });

  describe('MR_MEETING_VAD (개발자용 스위치)', () => {
    const saved = process.env.MR_MEETING_VAD;
    afterEach(() => {
      if (saved === undefined) delete process.env.MR_MEETING_VAD;
      else process.env.MR_MEETING_VAD = saved;
    });

    it('모델 파일이 있고 회의용 서버가 떴을 때만 segments.json·timing에 vad 값을 남긴다 (모델 경로는 빼고)', async () => {
      const model = path.join(root, 'silero.bin');
      fs.writeFileSync(model, 'x');
      process.env.MR_MEETING_VAD = model;
      const dir = meetingDir(root, 'vad');
      const f = fakeDeps(userData, { transcribe: () => [{ start: 0, end: 2, text: '안녕하세요' }] });
      const r = await run(dir, f.settings);
      expect(f.servers[0]!.vad).toEqual({ model, threshold: 0.3, padMs: 200, minSilenceMs: 500 });
      const seg = readJson(dir, 'segments.json');
      expect(Object.keys(seg)).toEqual(['model', 'vad', 'tracks', 'redo', 'segments']);
      expect(seg.vad).toEqual({ threshold: 0.3, padMs: 200, minSilenceMs: 500 });
      expect(r.timing.vad).toEqual(seg.vad);

      const dir2 = meetingDir(root, 'vad-no-server');
      fakeDeps(userData, { server: 'fail', transcribe: () => [{ start: 0, end: 2, text: '안녕하세요' }] });
      const r2 = await run(dir2, f.settings);
      expect(Object.keys(readJson(dir2, 'segments.json'))).toEqual(['model', 'tracks', 'redo', 'segments']);
      expect(r2.timing.vad).toBeUndefined();
    });

    it('모델 파일이 없으면 끈다', async () => {
      process.env.MR_MEETING_VAD = path.join(root, 'none.bin');
      const dir = meetingDir(root, 'vad-missing');
      const f = fakeDeps(userData, { transcribe: () => [] });
      await run(dir, f.settings);
      expect(f.servers[0]!.vad).toBeNull();
      expect(Object.keys(readJson(dir, 'segments.json'))).not.toContain('vad');
    });
  });

  describe('화자 구분 (가짜 파이썬 환경)', () => {
    // 앱 전용 파이썬 자리에 가짜 실행 파일을 두고, 모델 폴더도 앱 데이터 안에 미리 만들어 둔다 (~/.cache를 보지 않게)
    const fakePython = (script: string) => {
      const bin = path.join(userData, 'diarize-env', 'bin');
      fs.mkdirSync(bin, { recursive: true });
      fs.writeFileSync(path.join(bin, 'python'), `#!/bin/sh\necho "$@" > "$(dirname "$0")/args.txt"\necho "$HF_HUB_OFFLINE $PYTORCH_ENABLE_MPS_FALLBACK" >> "$(dirname "$0")/args.txt"\n${script}\n`, { mode: 0o755 });
      fs.mkdirSync(path.join(userData, 'hf-cache', DIARIZE_MODEL_DIR, 'snapshots'), { recursive: true });
      return bin;
    };
    const turns = [
      { start: 0, end: 4.2, speaker: 'SPEAKER_00' },
      { start: 4.2, end: 23.9, speaker: 'SPEAKER_01' },
      { start: 23.9, end: 30, speaker: 'SPEAKER_00' },
    ];

    it('설정에서 켜고 환경이 있으면 녹취와 함께 돌려 화자를 붙이고 diarization.json을 남긴다', async () => {
      const dir = meetingDir(root, 'diarize');
      const bin = fakePython(`cat "$(dirname "$0")/out.json"`);
      fs.writeFileSync(path.join(bin, 'out.json'), JSON.stringify({ segments: turns }));
      const f = fakeDeps(userData, { transcribe: (file) => (file.endsWith('.redo.wav') ? REDONE : LOOPING) });
      expect(diarizeAvailable()).toBe(true);
      const r = await run(dir, { ...f.settings, diarize: true }, 2);

      const [args, env] = fs.readFileSync(path.join(bin, 'args.txt'), 'utf8').trim().split('\n');
      expect(args).toMatch(/^-I .*native\/diarize\.py .*\.mic-16k\.wav --speakers 2$/);
      expect(env).toBe('1 1'); // 오프라인으로
      expect(r.diarizeInfo).toEqual({ speakers: 2, diarizeError: null });
      expect(r.transcript).toBe('[00:00] [화자 1] 안건부터 보겠습니다\n[00:04] [화자 2] 정리는 제가 맡겠습니다\n[00:24] [화자 1] 네 알겠습니다');
      expect(readJson(dir, 'diarization.json')).toEqual({ segments: turns });
      expect(r.timing.diarizeMs).toEqual(expect.any(Number));
      expect(r.reports.slice(1).every((x) => x.extra.diarizing === true)).toBe(true);
      expect(leftovers(dir)).toEqual([]);
    });

    it('화자 구분이 실패해도 녹취는 남기고 까닭을 돌려준다', async () => {
      const dir = meetingDir(root, 'diarize-fail');
      fakePython('echo "HTTP 401 Unauthorized" >&2\nexit 1');
      const f = fakeDeps(userData, { transcribe: () => [{ start: 0, end: 2, text: '안녕하세요' }] });
      const r = await run(dir, { ...f.settings, diarize: true });
      expect(r.diarizeInfo).toEqual({ speakers: 0, diarizeError: 'Hugging Face 토큰이 없거나 모델 약관에 동의하지 않았습니다' });
      expect(r.transcript).toBe('[00:00] 안녕하세요');
      expect(fs.existsSync(path.join(dir, 'diarization.json'))).toBe(false);
    });

    it('모델이 없으면 설치하라고 알린다', async () => {
      const dir = meetingDir(root, 'diarize-no-model');
      fakePython('exit 0');
      fs.rmSync(path.join(userData, 'hf-cache', DIARIZE_MODEL_DIR), { recursive: true });
      fs.mkdirSync(path.join(userData, 'hf-cache', DIARIZE_MODEL_DIR)); // 폴더는 있고 snapshots가 없음 → ~/.cache에서 복사하지 않는다
      const f = fakeDeps(userData, { transcribe: () => [{ start: 0, end: 2, text: '안녕하세요' }] });
      const r = await run(dir, { ...f.settings, diarize: true });
      expect(r.diarizeInfo.diarizeError).toBe('화자 구분 모델이 없습니다. 설정 › 엔진에서 설치하세요');
    });

    it('환경이 없거나 설정에서 껐으면 돌리지 않는다', async () => {
      const dir = meetingDir(root, 'diarize-off');
      const f = fakeDeps(userData, { transcribe: () => [{ start: 0, end: 2, text: '안녕하세요' }] });
      expect(diarizeAvailable()).toBe(false);
      const r = await run(dir, { ...f.settings, diarize: true });
      expect(r.reports.every((x) => x.extra.diarizing !== true)).toBe(true);
      expect(r.timing.diarizeMs).toBeUndefined();
    });
  });
});

describe('meetingAsr', () => {
  it('회의 언어가 있으면 그것으로, 없으면 받아쓰기 언어로', () => {
    expect(meetingAsr({ provider: 'auto', language: 'ko', meetingLanguage: 'en' }).language).toBe('en');
    expect(meetingAsr({ provider: 'auto', language: 'ko', meetingLanguage: '' }).language).toBe('ko');
  });
});
