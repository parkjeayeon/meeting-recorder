// 녹음 폴더와 설정 백업 (folders.mts) — 임시 폴더와 가짜 받아쓰기 설정으로
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { tmpDir } from '../test/ipc.mjs';
import { DEFAULT_SETTINGS, type DictationSettings, type StoredSettings } from '../dictation/index.mjs';
import { createFolders, readJson, vocabList, type Folders, type FoldersContext } from './folders.mjs';

let home: string;
let stored: StoredSettings;
let saves: unknown[];
let dirChanged: number;
let folders: Folders;

// dictation.json 자리 대신 메모리: getSettings는 기본값 위에 저장한 값
const fakeDictation = (): FoldersContext['dictation'] => ({
  getSettings: () => ({ ...DEFAULT_SETTINGS, meetingLanguage: 'ko', hasApiKey: false, hasHfToken: false, ...stored }) as DictationSettings,
  storedSettings: () => stored,
  saveSettings: (patch) => {
    saves.push(patch);
    stored = { ...stored, ...patch };
    return { ...DEFAULT_SETTINGS, hasApiKey: false, hasHfToken: false, ...stored } as DictationSettings;
  },
});

beforeEach(() => {
  home = tmpDir('mr-folders-');
  stored = {};
  saves = [];
  dirChanged = 0;
  folders = createFolders({ dictation: fakeDictation(), onDirChanged: () => dirChanged++, homedir: () => home });
});

describe('녹음 폴더', () => {
  it('기본은 ~/Documents/MeetingRecorder, 받아쓰기 기록은 그 안의 dictations.jsonl', () => {
    const def = path.join(home, 'Documents', 'MeetingRecorder');
    expect(folders.defaultRecordingsDir).toBe(def);
    expect(folders.recordingsDir()).toBe(def);
    expect(folders.dictationLog()).toBe(path.join(def, 'dictations.jsonl'));
  });

  it('바꾸면 기록 경로도 따라가고 지켜보기에 알린다', () => {
    const next = path.join(home, 'other');
    folders.setRecordingsDir(next);
    expect(folders.recordingsDir()).toBe(next);
    expect(folders.dictationLog()).toBe(path.join(next, 'dictations.jsonl'));
    expect(dirChanged).toBe(1);
  });

  it('recordingDir: 녹음 폴더 바로 아래만 받는다', () => {
    const rec = path.join(home, 'rec');
    folders.setRecordingsDir(rec);
    expect(folders.recordingDir(path.join(rec, '2026-01-01_09-00-00_meeting'))).toBe(path.join(rec, '2026-01-01_09-00-00_meeting'));
    expect(folders.recordingDir(`${rec}/a/../2026-01-02_meeting/`)).toBe(path.join(rec, '2026-01-02_meeting')); // 정리한 경로로 본다
    expect(() => folders.recordingDir(rec)).toThrow('녹음 폴더가 아닙니다'); // 녹음 폴더 자신
    expect(() => folders.recordingDir(path.join(rec, 'm', 'deeper'))).toThrow('녹음 폴더가 아닙니다');
    expect(() => folders.recordingDir(path.join(rec, '..', 'x'))).toThrow('녹음 폴더가 아닙니다'); // 밖으로
    expect(() => folders.recordingDir(`${rec}-evil/x`)).toThrow('녹음 폴더가 아닙니다'); // 이름이 같게 시작하는 다른 폴더
    expect(() => folders.recordingDir('relative-name')).toThrow('녹음 폴더가 아닙니다'); // 지금 작업 폴더 기준으로 풀린다
    expect(() => folders.recordingDir(42)).toThrow(TypeError); // 문자열이 아니면 path.resolve가 던진다 (예전과 같다)
  });
});

describe('설정 백업 (settings.json)', () => {
  it('쓰기: 옮겨 쓸 칸만, 토큰·키는 빼고, 폴더가 없으면 만든다', () => {
    stored = { vocabulary: '가나, 다라', language: 'en', recordingsDir: '/x', apiKey: 'secret', onboarding: { completed: true } };
    folders.writePortableSettings();
    const saved = readJson(path.join(folders.recordingsDir(), 'settings.json')) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['cleanup', 'diarize', 'enabled', 'language', 'meetingLanguage', 'meetingSystemAudio', 'minutes', 'provider', 'savedAt', 'vocabulary']);
    expect(saved.vocabulary).toBe('가나, 다라');
    expect(saved.language).toBe('en');
  });

  it('쓰기: 쓸 수 없으면 조용히 넘어간다', () => {
    const file = path.join(home, 'file');
    fs.writeFileSync(file, 'x');
    folders.setRecordingsDir(path.join(file, 'sub')); // 파일 아래 폴더는 만들 수 없다
    expect(() => folders.writePortableSettings()).not.toThrow();
  });

  it('합치기: 백업이 없으면 아무것도 하지 않는다', () => {
    expect(folders.mergePortableSettings()).toBe(false);
    expect(saves).toEqual([]);
  });

  it('합치기: 새 컴퓨터(사전·언어를 저장한 적 없음)면 백업 값을 그대로 쓴다', () => {
    fs.mkdirSync(folders.recordingsDir(), { recursive: true });
    fs.writeFileSync(path.join(folders.recordingsDir(), 'settings.json'), JSON.stringify({ vocabulary: '가나, 다라', language: 'ja', minutes: false, savedAt: 'x', apiKey: 'no' }));
    expect(folders.mergePortableSettings()).toBe(true);
    expect(saves).toEqual([{ vocabulary: '가나, 다라', language: 'ja', minutes: false }]);
  });

  it('합치기: 이미 쓰던 컴퓨터면 사전 단어만 더한다 (겹치는 것은 한 번, 순서는 지금 것 먼저)', () => {
    stored = { vocabulary: '다라, 마바', language: 'ko' };
    fs.mkdirSync(folders.recordingsDir(), { recursive: true });
    fs.writeFileSync(path.join(folders.recordingsDir(), 'settings.json'), JSON.stringify({ vocabulary: '가나\n다라', language: 'ja' }));
    expect(folders.mergePortableSettings()).toBe(true);
    expect(saves).toEqual([{ vocabulary: '다라, 마바, 가나' }]);
    // 더할 것이 없으면 저장하지 않는다
    saves = [];
    expect(folders.mergePortableSettings()).toBe(false);
    expect(saves).toEqual([]);
  });

  it('합치기: 사전만 저장돼 있어도 새 컴퓨터가 아니다', () => {
    stored = { language: 'ko' };
    fs.mkdirSync(folders.recordingsDir(), { recursive: true });
    fs.writeFileSync(path.join(folders.recordingsDir(), 'settings.json'), JSON.stringify({ language: 'ja', minutes: false }));
    expect(folders.mergePortableSettings()).toBe(false);
  });

  it('사전 글 나누기: 쉼표·줄바꿈, 앞뒤 공백과 빈 칸은 뺀다', () => {
    expect(vocabList(' 가나 ,다라\n\n마바, ')).toEqual(['가나', '다라', '마바']);
    expect(vocabList(undefined)).toEqual([]);
    expect(vocabList(null)).toEqual([]);
  });

  it('readJson: 없거나 깨진 파일은 null', () => {
    expect(readJson(path.join(home, 'none.json'))).toBe(null);
    fs.writeFileSync(path.join(home, 'bad.json'), '{');
    expect(readJson(path.join(home, 'bad.json'))).toBe(null);
  });
});
