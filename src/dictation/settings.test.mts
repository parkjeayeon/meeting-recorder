// 받아쓰기 설정·토큰 (src/dictation/settings.mts) — 임시 앱 데이터 폴더·임시 홈·가짜 암호화로 (실제 앱 데이터 폴더·키체인은 쓰지 않는다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettings, DEFAULT_SETTINGS, type SettingsStore } from './settings.mjs';

let root: string;
let userData: string;
let home: string;
let env: NodeJS.ProcessEnv;
let store: SettingsStore;

// 가짜 safeStorage: 앞에 표시를 붙인 글자 그대로 (저장된 base64가 평문이 아닌지 볼 수 있게 뒤집는다)
const encrypt = (plain: string) => Buffer.from(`enc:${[...plain].reverse().join('')}`);
const decrypt = (b: Buffer) => [...b.toString().slice(4)].reverse().join('');

const file = () => path.join(userData, 'dictation.json');
const readFile = () => JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>;
const writeFile = (v: unknown) => fs.writeFileSync(file(), JSON.stringify(v));
const putCliToken = (text: string) => {
  fs.mkdirSync(path.join(home, '.cache', 'huggingface'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cache', 'huggingface', 'token'), text);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-dictation-settings-'));
  userData = path.join(root, 'userData');
  home = path.join(root, 'home');
  fs.mkdirSync(userData);
  fs.mkdirSync(home);
  env = {};
  store = createSettings({ userData: () => userData, encrypt, decrypt, env, homedir: () => home });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('getSettings', () => {
  it('파일이 없으면 기본값, 회의 언어는 받아쓰기 언어, 토큰 없음', () => {
    expect(store.getSettings()).toEqual({ ...DEFAULT_SETTINGS, meetingLanguage: 'ko', hasApiKey: false, hasHfToken: false });
  });

  it('폰 녹음(결정 84)은 기본으로 꺼짐 — 받을 폴더 없음, 지켜보기·회의록 복사 끔. 저장한 값은 그대로 읽는다', () => {
    expect(store.getSettings()).toMatchObject({ inboxDir: null, inboxEnabled: false, inboxCopyMinutes: false });
    store.saveSettings({ inboxDir: '/x/Drive/녹음', inboxEnabled: true });
    expect(store.getSettings()).toMatchObject({ inboxDir: '/x/Drive/녹음', inboxEnabled: true, inboxCopyMinutes: false });
    store.saveSettings({ inboxDir: null, inboxEnabled: false, inboxCopyMinutes: false });
    expect(store.getSettings()).toMatchObject({ inboxDir: null, inboxEnabled: false, inboxCopyMinutes: false });
  });

  it('깨진 파일도 기본값', () => {
    fs.writeFileSync(file(), '{ 깨짐');
    expect(store.getSettings().language).toBe('ko');
  });

  it('읽히지만 객체가 아닌 파일(null·배열·문자열·숫자)도 깨진 파일처럼 기본값, 읽을 때 파일은 고치지 않는다', () => {
    for (const v of [null, ['a', 'b'], 'ab', 7]) {
      writeFile(v);
      const before = fs.readFileSync(file(), 'utf8');
      expect(store.getSettings()).toEqual({ ...DEFAULT_SETTINGS, meetingLanguage: 'ko', hasApiKey: false, hasHfToken: false });
      expect(store.storedSettings()).toEqual({});
      expect(store.apiKey()).toBe(null);
      expect(store.tokenSources()).toEqual({ hf: { app: false, cli: false }, anthropic: { app: false, env: false } });
      expect(fs.readFileSync(file(), 'utf8')).toBe(before);
      // 다음 저장은 객체로 쓴다
      store.saveSettings({ language: 'en' });
      expect(readFile()).toEqual({ language: 'en', meetingLanguage: 'ko' });
    }
  });

  it('저장한 값이 기본값 위에, 모르는 칸도 그대로', () => {
    writeFile({ language: 'en', cleanup: false, recordingsDir: '/x' });
    expect(store.getSettings()).toMatchObject({ language: 'en', cleanup: false, recordingsDir: '/x', enabled: true, provider: 'auto' });
  });

  it('회의 언어: 따로 정했으면 그것, 아니면 받아쓰기 언어, 둘 다 없으면 ko', () => {
    writeFile({ language: 'ja' });
    expect(store.getSettings().meetingLanguage).toBe('ja');
    writeFile({ language: 'ja', meetingLanguage: 'en' });
    expect(store.getSettings().meetingLanguage).toBe('en');
    writeFile({});
    expect(store.getSettings().meetingLanguage).toBe('ko');
  });

  it('암호화한 토큰은 내보내지 않고 있는지만', () => {
    writeFile({ apiKeyEnc: 'eA==', hfTokenEnc: 'eA==' });
    const s = store.getSettings();
    expect(s).not.toHaveProperty('apiKeyEnc');
    expect(s).not.toHaveProperty('hfTokenEnc');
    expect(s.hasApiKey).toBe(true);
    expect(s.hasHfToken).toBe(true);
  });

  it('hasApiKey는 환경 변수도, hasHfToken은 hf 명령줄 토큰 파일도 (부를 때 본다)', () => {
    expect(store.getSettings()).toMatchObject({ hasApiKey: false, hasHfToken: false });
    env.ANTHROPIC_API_KEY = 'sk-env';
    putCliToken('');
    expect(store.getSettings()).toMatchObject({ hasApiKey: true, hasHfToken: true }); // 빈 파일이어도 있으면 true (예전 그대로)
  });
});

describe('saveSettings', () => {
  it('고친 칸만 합쳐 저장하고 getSettings를 돌려준다', () => {
    writeFile({ cleanup: false, vocabulary: 'A' });
    const out = store.saveSettings({ vocabulary: 'B' });
    expect(readFile()).toEqual({ cleanup: false, vocabulary: 'B' });
    expect(out).toEqual(store.getSettings());
  });

  it('받아쓰기 언어를 처음 바꾸면 회의 언어를 바꾸기 전 값으로 고정한다', () => {
    store.saveSettings({ language: 'en' });
    expect(readFile()).toEqual({ language: 'en', meetingLanguage: 'ko' }); // 기본값 ko로 고정
    store.saveSettings({ language: 'ja' });
    expect(readFile()).toEqual({ language: 'ja', meetingLanguage: 'ko' }); // 이미 있으면 그대로
  });

  it('저장한 받아쓰기 언어에서 바꾸면 그 값으로 고정', () => {
    writeFile({ language: 'ja' });
    store.saveSettings({ language: 'en' });
    expect(readFile()).toEqual({ language: 'en', meetingLanguage: 'ja' });
  });

  it('같은 언어로 저장하거나 언어를 안 주면 고정하지 않는다', () => {
    store.saveSettings({ language: 'ko' });
    expect(readFile()).toEqual({ language: 'ko' });
    store.saveSettings({ cleanup: false });
    expect(readFile()).toEqual({ language: 'ko', cleanup: false });
  });

  it('회의 언어를 같이 주면 그 값이 이긴다', () => {
    store.saveSettings({ language: 'en', meetingLanguage: 'ja' });
    expect(readFile()).toEqual({ language: 'en', meetingLanguage: 'ja' });
  });

  it('토큰은 암호화해 base64로, 빈 문자열이면 지우고, 안 주면 그대로', () => {
    store.saveSettings({ apiKey: 'sk-app', hfToken: 'hf_app' });
    const saved = readFile();
    expect(saved).not.toHaveProperty('apiKey');
    expect(saved).not.toHaveProperty('hfToken');
    expect(saved.apiKeyEnc).toBe(encrypt('sk-app').toString('base64'));
    expect(saved.hfTokenEnc).toBe(encrypt('hf_app').toString('base64'));
    expect(store.apiKey()).toBe('sk-app');
    expect(store.hfToken()).toBe('hf_app');

    store.saveSettings({ vocabulary: 'x' });
    expect(store.apiKey()).toBe('sk-app');
    expect(store.hfToken()).toBe('hf_app');

    store.saveSettings({ hfToken: '' });
    expect(readFile()).not.toHaveProperty('hfTokenEnc');
    expect(store.hfToken()).toBeNull();
    expect(store.apiKey()).toBe('sk-app');

    store.saveSettings({ apiKey: '' });
    expect(readFile()).not.toHaveProperty('apiKeyEnc');
    expect(store.apiKey()).toBeNull();
  });
});

describe('키·토큰', () => {
  it('apiKey: 앱에 저장한 것이 먼저, 없으면 환경 변수, 둘 다 없으면 null', () => {
    expect(store.apiKey()).toBeNull();
    env.ANTHROPIC_API_KEY = 'sk-env';
    expect(store.apiKey()).toBe('sk-env');
    store.saveSettings({ apiKey: 'sk-app' });
    expect(store.apiKey()).toBe('sk-app');
    env.ANTHROPIC_API_KEY = '';
    store.saveSettings({ apiKey: '' });
    expect(store.apiKey()).toBeNull(); // 빈 환경 변수는 없는 것
  });

  it('hfCliToken: 앞뒤 공백을 뺀 값, 비었거나 없으면 null', () => {
    expect(store.hfCliToken()).toBeNull();
    putCliToken('  hf_cli \n');
    expect(store.hfCliToken()).toBe('hf_cli');
    putCliToken('\n');
    expect(store.hfCliToken()).toBeNull();
  });

  it('tokenSources: 값 없이 어디에 있는지만', () => {
    expect(store.tokenSources()).toEqual({ hf: { app: false, cli: false }, anthropic: { app: false, env: false } });
    putCliToken('hf_cli');
    env.ANTHROPIC_API_KEY = 'sk-env';
    expect(store.tokenSources()).toEqual({ hf: { app: false, cli: true }, anthropic: { app: false, env: true } });
    store.saveSettings({ apiKey: 'sk-app', hfToken: 'hf_app' });
    expect(store.tokenSources()).toEqual({ hf: { app: true, cli: true }, anthropic: { app: true, env: true } });
  });
});

describe('storedSettings', () => {
  it('저장한 것만 — 기본값·토큰·hasApiKey 없이', () => {
    expect(store.storedSettings()).toEqual({});
    store.saveSettings({ language: 'en', apiKey: 'sk', hfToken: 'hf' });
    expect(store.storedSettings()).toEqual({ language: 'en', meetingLanguage: 'ko' });
  });
});
