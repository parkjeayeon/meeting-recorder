// 받아쓰기 설정과 토큰 (앱 데이터 폴더의 dictation.json). src/dictation.js에서 옮김 (결정 70).
// API 키·Hugging Face 토큰은 macOS 키체인 기반 safeStorage로 암호화해 저장한다 — 암호화·풀기와 앱 데이터 폴더는 부르는 쪽이 넘긴다(Electron을 가져오지 않는다).
// 예전처럼 부를 때마다 파일을 새로 읽고, 환경 변수(ANTHROPIC_API_KEY)와 홈 폴더(hf 명령줄 토큰)도 부를 때 본다.
import fs from 'node:fs';
import path from 'node:path';
import type { Choice } from '../llm/call.mjs';
import { writeJsonAtomic } from '../core/write.mjs'; // 파일 쓰기는 끊겨도 깨지지 않게 (결정 45)

// provider: auto | claude-code | codex | api
// meetingSystemAudio: 회의 녹음에 상대방 소리(시스템 오디오)도 함께 녹음 (화상 회의용, 기본은 오프라인 회의라 꺼 둠)
// minutes: 회의가 끝나면 녹취와 회의록을 자동으로 만든다
// diarize: 회의 화자 구분 (pyannote). 토큰은 `hf auth login`으로 저장한 것을 쓰거나 설정에 넣은 값을 쓴다
// meetingPretranscribe: 회의를 녹음하는 동안 끝난 조각을 미리 받아써 둔다 (결정 83). 화면에 켜고 끄는 곳은 아직 없다
export const DEFAULT_SETTINGS = { enabled: true, language: 'ko', cleanup: true, provider: 'auto', vocabulary: '', meetingSystemAudio: false, minutes: true, diarize: true, meetingPretranscribe: true } as const;

// 사용자가 저장한 설정 (dictation.json의 토큰 빼고). 화면·본체가 다른 칸(onboarding·recordingsDir 등)도 저장하므로 열어 둔다
export interface StoredSettings {
  enabled?: boolean;
  language?: string;
  meetingLanguage?: string;
  cleanup?: boolean;
  provider?: Choice;
  vocabulary?: string;
  meetingSystemAudio?: boolean;
  minutes?: boolean;
  diarize?: boolean;
  meetingPretranscribe?: boolean;
  [key: string]: unknown;
}

// dictation.json 그대로 (암호화한 토큰 포함, base64)
export interface StoredFile extends StoredSettings {
  apiKeyEnc?: string;
  hfTokenEnc?: string;
}

// getSettings가 돌려주는 것: 기본값 위에 저장한 값, 회의 언어, 토큰이 있는지
export interface DictationSettings extends StoredSettings {
  enabled: boolean;
  language: string;
  meetingLanguage: string;
  cleanup: boolean;
  provider: Choice;
  vocabulary: string;
  meetingSystemAudio: boolean;
  minutes: boolean;
  diarize: boolean;
  meetingPretranscribe: boolean;
  hasApiKey: boolean;
  hasHfToken: boolean;
}

// saveSettings에 넘기는 것: 저장할 칸 + 토큰(빈 문자열이면 지운다, 안 주면 그대로)
export interface SettingsPatch extends StoredSettings {
  apiKey?: string;
  hfToken?: string;
}

export interface TokenSources {
  hf: { app: boolean; cli: boolean };
  anthropic: { app: boolean; env: boolean };
}

export interface SettingsDeps {
  userData: () => string; // app.getPath('userData'), 부를 때 읽는다
  encrypt: (plain: string) => Buffer; // safeStorage.encryptString
  decrypt: (encrypted: Buffer) => string; // safeStorage.decryptString
  env: NodeJS.ProcessEnv; // process.env (부를 때 ANTHROPIC_API_KEY를 본다)
  homedir: () => string; // os.homedir()
}

export interface SettingsStore {
  readStored(): StoredFile;
  getSettings(): DictationSettings;
  saveSettings(patch: SettingsPatch): DictationSettings;
  storedSettings(): StoredSettings;
  apiKey(): string | null;
  hfToken(): string | null;
  hfCliToken(): string | null;
  tokenSources(): TokenSources;
}

export function createSettings(deps: SettingsDeps): SettingsStore {
  function settingsPath(): string {
    return path.join(deps.userData(), 'dictation.json');
  }

  // 읽히는 JSON이라도 객체가 아니면(null·배열·문자열·숫자) 깨진 파일처럼 빈 설정으로 본다.
  // 파일은 고쳐 쓰지 않는다 — 다음 saveSettings가 객체로 쓴다
  function readStored(): StoredFile {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as StoredFile) : {};
    } catch {
      return {};
    }
  }

  const hfCliTokenPath = () => path.join(deps.homedir(), '.cache', 'huggingface', 'token');

  function getSettings(): DictationSettings {
    const { apiKeyEnc, hfTokenEnc, ...rest } = readStored();
    return {
      ...DEFAULT_SETTINGS,
      ...rest,
      // 회의 녹취 언어는 받아쓰기 언어와 따로 (2026-11-07). 따로 정한 적이 없으면 예전처럼 받아쓰기 언어를 따른다
      meetingLanguage: rest.meetingLanguage ?? rest.language ?? DEFAULT_SETTINGS.language,
      hasApiKey: Boolean(apiKeyEnc) || Boolean(deps.env.ANTHROPIC_API_KEY),
      hasHfToken: Boolean(hfTokenEnc) || fs.existsSync(hfCliTokenPath()),
    } as DictationSettings; // 저장한 값의 타입은 파일을 믿는다 (예전과 같이 검사하지 않는다)
  }

  function hfToken(): string | null {
    const { hfTokenEnc } = readStored();
    return hfTokenEnc ? deps.decrypt(Buffer.from(hfTokenEnc, 'base64')) : null;
  }

  // `hf auth login`으로 저장된 토큰 (앱에 저장한 토큰이 없을 때 pyannote가 이걸 쓴다)
  function hfCliToken(): string | null {
    try {
      return fs.readFileSync(hfCliTokenPath(), 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  // 연결 설정 창용: 값은 넘기지 않고 어디에 저장돼 있는지만 알려 준다
  function tokenSources(): TokenSources {
    const { apiKeyEnc, hfTokenEnc } = readStored();
    return {
      hf: { app: Boolean(hfTokenEnc), cli: Boolean(hfCliToken()) },
      anthropic: { app: Boolean(apiKeyEnc), env: Boolean(deps.env.ANTHROPIC_API_KEY) },
    };
  }

  function saveSettings(patch: SettingsPatch): DictationSettings {
    const stored = readStored();
    const { apiKey, hfToken: hf, ...rest } = patch;
    // 받아쓰기 언어를 바꿀 때 회의 언어를 따로 정한 적이 없으면, 회의 언어는 바꾸기 전 값으로 고정한다 (왼쪽 아래에서 받아쓰기만 바꿔도 회의 녹취는 그대로)
    if ('language' in rest && stored.meetingLanguage === undefined && rest.language !== (stored.language ?? DEFAULT_SETTINGS.language)) stored.meetingLanguage = stored.language ?? DEFAULT_SETTINGS.language;
    Object.assign(stored, rest);
    if (hf !== undefined) {
      if (hf) stored.hfTokenEnc = deps.encrypt(hf).toString('base64');
      else delete stored.hfTokenEnc;
    }
    if (apiKey !== undefined) {
      if (apiKey) stored.apiKeyEnc = deps.encrypt(apiKey).toString('base64');
      else delete stored.apiKeyEnc;
    }
    writeJsonAtomic(settingsPath(), stored); // 설정·암호화한 토큰이 들어 있다
    return getSettings();
  }

  function apiKey(): string | null {
    const { apiKeyEnc } = readStored();
    if (apiKeyEnc) return deps.decrypt(Buffer.from(apiKeyEnc, 'base64'));
    return deps.env.ANTHROPIC_API_KEY || null;
  }

  // 사용자가 실제로 저장한 설정만 (기본값·토큰 제외)
  function storedSettings(): StoredSettings {
    const { apiKeyEnc, hfTokenEnc, ...rest } = readStored();
    return rest;
  }

  return { readStored, getSettings, saveSettings, storedSettings, apiKey, hfToken, hfCliToken, tokenSources };
}
