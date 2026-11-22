// ── 녹음 폴더와 사전·설정 백업 ─────────────────────────────────────────────
// src/main.js에서 옮김 (결정 70). 지금 녹음 폴더(RECORDINGS_DIR)와 받아쓰기 기록 경로(DICTATION_LOG)는 여기만 갖고,
// 다른 구역은 recordingsDir()·dictationLog()로 부를 때 읽는다. 폴더를 바꾸면(setRecordingsDir) 본체가 넘긴 onDirChanged로
// 폴더 지켜보기(watch.mts)에 알린다. 렌더러가 넘긴 경로를 녹음 폴더 안의 것만 받는 recordingDir()도 여기.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as core from '../core/index.mjs';
import type { Dictation, SettingsPatch } from '../dictation/index.mjs';
import { DEFAULT_SETTINGS } from '../dictation/settings.mjs'; // 기본값만 (Electron·서버를 가져오지 않는다)

// ── 사전·설정 백업: 녹음 폴더의 settings.json에 같이 적어 두어, 녹음 폴더만 옮겨도 이어 쓸 수 있게 한다 (토큰·키는 넣지 않는다)
export const PORTABLE_KEYS = ['vocabulary', 'language', 'meetingLanguage', 'enabled', 'cleanup', 'provider', 'minutes', 'diarize', 'meetingSystemAudio'] as const;
// 문자열이 아닌 값(손으로 고친 파일의 숫자·배열·객체·null)은 빈 사전으로 본다
export const vocabList = (v: unknown): string[] => (typeof v === 'string' ? v : '').split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

// 옮겨 쓸 칸마다 기본 설정의 값 모양 (회의 언어는 기본값이 없고 받아쓰기 언어를 따르므로 문자열)
const PORTABLE_TYPES: Record<(typeof PORTABLE_KEYS)[number], string> = {
  vocabulary: typeof DEFAULT_SETTINGS.vocabulary,
  language: typeof DEFAULT_SETTINGS.language,
  meetingLanguage: 'string',
  enabled: typeof DEFAULT_SETTINGS.enabled,
  cleanup: typeof DEFAULT_SETTINGS.cleanup,
  provider: typeof DEFAULT_SETTINGS.provider,
  minutes: typeof DEFAULT_SETTINGS.minutes,
  diarize: typeof DEFAULT_SETTINGS.diarize,
  meetingSystemAudio: typeof DEFAULT_SETTINGS.meetingSystemAudio,
};

export function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export interface FoldersContext {
  dictation: Pick<Dictation, 'getSettings' | 'storedSettings' | 'saveSettings'>;
  onDirChanged: () => void; // 녹음 폴더가 바뀌었다 → 지켜보던 중이면 새 폴더를 지켜본다
  homedir?: () => string; // 시험용 (기본은 os.homedir)
}

export interface Folders {
  defaultRecordingsDir: string; // ~/Documents/MeetingRecorder
  recordingsDir(): string; // 지금 녹음 폴더 (설정 › 받아쓰기 › 녹음 폴더에서 바꿀 수 있다)
  dictationLog(): string; // 받아쓰기 기록 파일 (녹음 폴더의 dictations.jsonl)
  setRecordingsDir(dir: string): void;
  writePortableSettings(): void;
  mergePortableSettings(): boolean;
  recordingDir(dir: unknown): string; // 녹음 폴더 바로 아래 폴더가 아니면 던진다
}

export function createFolders(ctx: FoldersContext): Folders {
  const { dictation } = ctx;
  const DEFAULT_RECORDINGS_DIR = path.join((ctx.homedir ?? os.homedir)(), 'Documents', 'MeetingRecorder');
  let RECORDINGS_DIR = DEFAULT_RECORDINGS_DIR; // 설정 › 받아쓰기 › 녹음 폴더에서 바꿀 수 있다
  // 받아쓰기는 음성을 남기지 않는다: 임시 폴더에 녹음 → 변환·입력 → 음성 삭제, 데이터만 이 파일에 한 줄씩 쌓는다
  let DICTATION_LOG = path.join(RECORDINGS_DIR, 'dictations.jsonl');

  const portableFile = () => path.join(RECORDINGS_DIR, 'settings.json');

  function writePortableSettings(): void {
    const s = dictation.getSettings();
    try {
      fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
      core.writeJsonAtomic(portableFile(), { ...Object.fromEntries(PORTABLE_KEYS.map((k) => [k, s[k]])), savedAt: new Date() });
    } catch {}
  }

  // 녹음 폴더에 저장된 설정을 읽어 온다. 앱 설정이 비어 있으면(새 컴퓨터) 그대로 쓰고, 아니면 사전 단어만 합친다
  function mergePortableSettings(): boolean {
    const saved = readJson(portableFile()) as Record<string, unknown> | null;
    if (!saved) return false;
    const stored = dictation.storedSettings();
    const fresh = !('vocabulary' in stored) && !('language' in stored);
    // 새 컴퓨터면 파일에 적힌 값을 넘기되, 기본 설정과 모양(문자열·참거짓)이 다른 값은 옮기지 않는다 (손으로 고친 파일)
    const patch: Record<string, unknown> = {};
    if (fresh) for (const k of PORTABLE_KEYS) if (saved[k] !== undefined && typeof saved[k] === PORTABLE_TYPES[k]) patch[k] = saved[k];
    // 문자열이 아닌 사전 값은 빈 사전으로 본다 (vocabList)
    const words = [...new Set([...vocabList(stored.vocabulary), ...vocabList(saved.vocabulary)])];
    if (words.join(', ') !== vocabList(stored.vocabulary).join(', ')) patch.vocabulary = words.join(', ');
    if (Object.keys(patch).length) dictation.saveSettings(patch as SettingsPatch);
    return Object.keys(patch).length > 0;
  }

  function setRecordingsDir(dir: string): void {
    RECORDINGS_DIR = dir;
    DICTATION_LOG = path.join(dir, 'dictations.jsonl');
    ctx.onDirChanged(); // 앱 실행 중 녹음 폴더를 바꾸면 새 폴더를 지켜본다
  }

  // 렌더러가 넘긴 경로는 녹음 폴더 안의 것만 받는다 (문자열이 아니면 예전처럼 path.resolve가 던진다)
  function recordingDir(dir: unknown): string {
    const resolved = path.resolve(dir as string);
    if (path.dirname(resolved) !== RECORDINGS_DIR) throw new Error('녹음 폴더가 아닙니다');
    return resolved;
  }

  return {
    defaultRecordingsDir: DEFAULT_RECORDINGS_DIR,
    recordingsDir: () => RECORDINGS_DIR,
    dictationLog: () => DICTATION_LOG,
    setRecordingsDir,
    writePortableSettings,
    mergePortableSettings,
    recordingDir,
  };
}
