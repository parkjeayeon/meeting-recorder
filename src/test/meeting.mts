// src/meeting 시험용: 지어낸 소리(WAV)와 가짜 바깥 함수들 (Whisper·LLM·용어 설명·샌드박스). 실제 녹음·설정·앱 데이터는 쓰지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CompleteOptions } from '../llm/call.mjs';
import { configure, type DedicatedServer, type MeetingDeps, type MeetingSettings } from '../meeting/deps.mjs';
import type { Segment } from '../meeting/transcript.mjs';

// 큰 잡음(0이 되지 않는 톱니)과, 그 사이 [a, b)초는 무음
export const noise = (rate: number, sec: number, quiet: [number, number][] = []): Int16Array => {
  const pcm = new Int16Array(Math.round(rate * sec));
  for (let i = 0; i < pcm.length; i++) pcm[i] = (i % 2 ? 1 : -1) * (1000 + (i % 500));
  for (const [a, b] of quiet) pcm.fill(0, Math.round(a * rate), Math.round(b * rate));
  return pcm;
};

// 표준 44바이트 머리의 16bit 모노 WAV
export const wavFile = (file: string, rate: number, pcm: Int16Array): void => {
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + body.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(body.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, body]));
};

export const tmpDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
export const readJson = (dir: string, f: string): any => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

// 회의 폴더: mic.wav(16kHz) + meta.json
export function meetingDir(root: string, name: string, { sec = 30, rate = 16000, quiet = [] as [number, number][], meta = {} as Record<string, unknown> } = {}): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  wavFile(path.join(dir, 'mic.wav'), rate, noise(rate, sec, quiet));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mode: 'meeting', startedAt: '2026-11-02T05:00:00.000Z', files: { mic: { file: 'mic.wav', durationSec: sec } }, ...meta }, null, 2));
  return dir;
}

export interface AsrCall {
  file: string; // 파일 이름만
  language: string | undefined;
  port: number | null | undefined;
  noContext: boolean | undefined;
  argc: number;
}

export interface Fakes {
  deps: MeetingDeps;
  settings: MeetingSettings;
  asr: AsrCall[];
  llm: CompleteOptions[];
  servers: { modelFile: string; vad: unknown; argc: number }[];
  glossary: string[];
  stopped: number;
  progress: ((p: number) => void) | null;
  online: boolean;
  isOnlineCalls: number;
}

// 가짜를 만들어 configure()로 넘긴다. transcribe/complete는 시험마다 바꿔 끼운다
export function fakeDeps(userData: string, opts: { transcribe?: (file: string, call: AsrCall) => Segment[] | Promise<Segment[]>; complete?: (o: CompleteOptions) => Promise<{ text: string; provider: string }>; server?: 'ok' | 'fail' | 'null' } = {}): Fakes {
  const f: Fakes = {
    settings: { provider: 'auto', language: 'ko', meetingLanguage: 'en', vocabulary: '', diarize: false },
    asr: [],
    llm: [],
    servers: [],
    glossary: [],
    stopped: 0,
    progress: null,
    online: true,
    isOnlineCalls: 0,
    deps: null as unknown as MeetingDeps,
  };
  const server: DedicatedServer = {
    port: 4321,
    stop: () => void f.stopped++,
    onProgress: (cb) => void (f.progress = cb),
  };
  f.deps = {
    userData: () => userData,
    isPackaged: () => false,
    resourcesPath: () => path.join(userData, 'no-resources'),
    isOnline: () => (f.isOnlineCalls++, f.online),
    getSettings: () => ({ ...f.settings }),
    apiKey: () => 'fake-key',
    transcribeSegments: async (...args) => {
      const [file, asr, port, o] = args;
      const call: AsrCall = { file: path.basename(file), language: asr.language, port, noContext: o?.noContext, argc: args.length };
      f.asr.push(call);
      return (await opts.transcribe?.(file, call)) ?? [];
    },
    startDedicatedServer: async (...args) => {
      const [modelFile, o] = args;
      f.servers.push({ modelFile, vad: o?.vad, argc: args.length });
      if (opts.server === 'fail') throw new Error('회의용 음성 인식 모델을 불러오지 못했습니다');
      if (opts.server === 'null') return null;
      return server;
    },
    complete: async (o) => {
      f.llm.push(o);
      if (!opts.complete) throw new Error('LLM 없음');
      return opts.complete(o);
    },
    makeGlossary: async (dir) => void f.glossary.push(dir),
    sandboxWrap: (cmd, args) => [cmd, args],
    sandboxCacheEnv: (dir) => ({ XDG_CACHE_HOME: path.join(dir, 'cache') }),
  };
  configure(f.deps);
  return f;
}

// 정리본 프롬프트면 받은 줄을 그대로, 회의록 프롬프트면 짧은 회의록을 돌려주는 가짜 LLM
export const echoComplete = async (o: CompleteOptions): Promise<{ text: string; provider: string }> => {
  if (o.system.startsWith('You prune')) return { text: o.input.replace(/^<script>\n|\n<\/script>$/g, ''), provider: 'fake' };
  return { text: '# 배포 일정 정리\n\n## 요약\n배포 일정을 정했습니다.\n\n## 결정 사항\n- 없음\n\n## 할 일\n- 없음', provider: 'fake' };
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
