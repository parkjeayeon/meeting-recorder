// 연결 설정 창의 토큰·키 (tokens:*, app:openExternal) — 가짜 저장소·가짜 네트워크로 (실제 키체인·네트워크는 쓰지 않는다)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeIpc, type FakeIpc } from '../test/ipc.mjs';
import { registerTokens, type AnthropicClient, type TokensContext } from './tokens.mjs';

let ipc: FakeIpc;
let store: { hfToken?: string; apiKey?: string };
let cliToken: string | null;
let saved: unknown[];
let opened: string[];
let sdkLoads: number;
let listImpl: () => Promise<unknown>;
let clients: unknown[];

// 가짜 Anthropic SDK: 만든 인자를 적고 models.list는 listImpl대로
class FakeAnthropic {
  models = { list: (q: { limit: number }) => (clients.push(['list', q]), listImpl()) };
  constructor(opts: unknown) {
    clients.push(['new', opts]);
  }
}

beforeEach(() => {
  ipc = fakeIpc();
  store = {};
  cliToken = null;
  saved = [];
  opened = [];
  sdkLoads = 0;
  clients = [];
  listImpl = async () => ({ data: [] });
  // dictation.js처럼: 빈 문자열을 저장하면 지운다
  const ctx: TokensContext = {
    dictation: {
      tokenSources: () => ({ hf: { app: Boolean(store.hfToken), cli: Boolean(cliToken) }, anthropic: { app: Boolean(store.apiKey), env: false } }),
      saveSettings: (patch) => {
        saved.push(patch);
        for (const [k, v] of Object.entries(patch)) if (v) store[k as 'hfToken' | 'apiKey'] = v as string; else delete store[k as 'hfToken' | 'apiKey'];
      },
      hfToken: () => store.hfToken ?? null,
      hfCliToken: () => cliToken,
      apiKey: () => store.apiKey ?? null,
    },
    shell: { openExternal: (url) => opened.push(url) },
    anthropic: () => {
      sdkLoads++;
      return FakeAnthropic as unknown as AnthropicClient;
    },
  };
  registerTokens(ipc, ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tokens:status·save·clear', () => {
  it('받는 채널은 다섯', () => {
    expect(ipc.channels()).toEqual(['handle tokens:clear', 'handle tokens:save', 'handle tokens:status', 'handle tokens:verify', 'on app:openExternal']);
  });

  it('앞뒤 빈칸을 지워 저장하고 상태를 돌려준다 (hf가 아니면 API 키)', async () => {
    expect(await ipc.invoke('tokens:save', 'hf', '  hf_fake  ')).toEqual({ hf: { app: true, cli: false }, anthropic: { app: false, env: false } });
    expect(await ipc.invoke('tokens:save', 'anthropic', 'sk-fake')).toEqual({ hf: { app: true, cli: false }, anthropic: { app: true, env: false } });
    expect(await ipc.invoke('tokens:save', 'other', 'sk-2')).toMatchObject({ anthropic: { app: true } });
    expect(saved).toEqual([{ hfToken: 'hf_fake' }, { apiKey: 'sk-fake' }, { apiKey: 'sk-2' }]);
  });

  it('비었거나 빈칸뿐이면(null도) 저장하지 않고 지금 상태만', async () => {
    for (const v of ['', '   ', null, undefined]) expect(await ipc.invoke('tokens:save', 'hf', v)).toEqual({ hf: { app: false, cli: false }, anthropic: { app: false, env: false } });
    expect(saved).toEqual([]);
  });

  it('숫자 같은 값도 글로 바꿔 저장한다', async () => {
    await ipc.invoke('tokens:save', 'anthropic', 12345);
    expect(saved).toEqual([{ apiKey: '12345' }]);
  });

  it('지우기는 빈 문자열을 저장한다', async () => {
    store = { hfToken: 'a', apiKey: 'b' };
    expect(await ipc.invoke('tokens:clear', 'hf')).toEqual({ hf: { app: false, cli: false }, anthropic: { app: true, env: false } });
    expect(await ipc.invoke('tokens:clear', 'anthropic')).toEqual({ hf: { app: false, cli: false }, anthropic: { app: false, env: false } });
    expect(saved).toEqual([{ hfToken: '' }, { apiKey: '' }]);
  });
});

describe('tokens:verify (hf)', () => {
  const stubFetch = (who: { ok: boolean; name?: string }, modelStatus: number) => {
    const fetch = vi.fn(async (url: string, _opts?: unknown) => (url.endsWith('/api/whoami-v2') ? { ok: who.ok, json: async () => ({ name: who.name }) } : { status: modelStatus }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('토큰이 없으면 네트워크를 쓰지 않는다', async () => {
    const fetch = stubFetch({ ok: true }, 200);
    expect(await ipc.invoke('tokens:verify', 'hf')).toEqual({ ok: false, message: '저장된 토큰이 없습니다' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('계정을 읽고 모델 파일을 HEAD로 물어 약관 동의를 본다 (앱 토큰이 없으면 hf 명령줄 로그인 토큰)', async () => {
    cliToken = 'hf_cli';
    const fetch = stubFetch({ ok: true, name: 'tester' }, 302);
    expect(await ipc.invoke('tokens:verify', 'hf')).toEqual({ ok: true, user: 'tester', message: 'tester 계정 · 화자 구분 모델 사용 가능' });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://huggingface.co/api/whoami-v2',
      'https://huggingface.co/pyannote/speaker-diarization-community-1/resolve/main/config.yaml',
    ]);
    const [first, second] = fetch.mock.calls.map((c) => (c as unknown as [string, Record<string, unknown>])[1]);
    expect(first).toMatchObject({ headers: { Authorization: 'Bearer hf_cli' } });
    expect(first!.signal).toBeInstanceOf(AbortSignal);
    expect(second).toMatchObject({ method: 'HEAD', headers: { Authorization: 'Bearer hf_cli' }, redirect: 'manual' });
  });

  it('앱에 저장한 토큰이 먼저, 약관에 동의하지 않았으면(403) 실패', async () => {
    store.hfToken = 'hf_app';
    cliToken = 'hf_cli';
    const fetch = stubFetch({ ok: true, name: 'tester' }, 403);
    expect(await ipc.invoke('tokens:verify', 'hf')).toEqual({ ok: false, user: 'tester', message: 'tester 계정 · 모델 약관에 아직 동의하지 않았습니다' });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer hf_app' } });
  });

  it('토큰이 틀리면 모델은 묻지 않는다', async () => {
    store.hfToken = 'hf_bad';
    const fetch = stubFetch({ ok: false }, 200);
    expect(await ipc.invoke('tokens:verify', 'hf')).toEqual({ ok: false, message: '토큰이 맞지 않습니다 (만료되었거나 잘못 입력됨)' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('네트워크가 실패하면 그 이유를 알린다', async () => {
    store.hfToken = 'hf_x';
    vi.stubGlobal('fetch', async () => {
      throw new Error('fetch failed');
    });
    expect(await ipc.invoke('tokens:verify', 'hf')).toEqual({ ok: false, message: '확인하지 못했습니다: fetch failed' });
  });
});

describe('tokens:verify (API 키)', () => {
  it('키가 없으면 SDK도 불러오지 않는다', async () => {
    expect(await ipc.invoke('tokens:verify', 'anthropic')).toEqual({ ok: false, message: '저장된 API 키가 없습니다' });
    expect(sdkLoads).toBe(0);
  });

  it('모델 목록 하나를 물어 본다 (10초, 다시 시도 없음)', async () => {
    store.apiKey = 'sk-fake';
    expect(await ipc.invoke('tokens:verify', 'anthropic')).toEqual({ ok: true, message: 'API 키 사용 가능' });
    expect(sdkLoads).toBe(1);
    expect(clients).toEqual([['new', { apiKey: 'sk-fake', timeout: 10000, maxRetries: 0 }], ['list', { limit: 1 }]]);
  });

  it('401·403·그 밖의 실패를 나눠 알린다', async () => {
    store.apiKey = 'sk-fake';
    for (const [err, message] of [
      [Object.assign(new Error('unauthorized'), { status: 401 }), 'API 키가 맞지 않습니다'],
      [Object.assign(new Error('forbidden'), { status: 403 }), '이 키로는 접근 권한이 없습니다'],
      [Object.assign(new Error('overloaded'), { status: 529 }), '확인하지 못했습니다: overloaded'],
      [new Error('Connection error.'), '확인하지 못했습니다: Connection error.'],
    ] as const) {
      listImpl = async () => {
        throw err;
      };
      expect(await ipc.invoke('tokens:verify', 'anthropic')).toEqual({ ok: false, message });
    }
  });
});

describe('app:openExternal', () => {
  it('정해 둔 링크만 연다', () => {
    for (const url of ['https://huggingface.co/settings/tokens', 'https://huggingface.co/pyannote/speaker-diarization-community-1', 'https://console.anthropic.com/settings/keys', 'https://brew.sh']) ipc.send('app:openExternal', url);
    for (const url of ['https://example.com', 'file:///etc/passwd', 'https://brew.sh/', null]) ipc.send('app:openExternal', url);
    expect(opened).toEqual(['https://huggingface.co/settings/tokens', 'https://huggingface.co/pyannote/speaker-diarization-community-1', 'https://console.anthropic.com/settings/keys', 'https://brew.sh']);
  });
});
