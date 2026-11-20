// ── 연결 설정 창: 토큰·키 저장, 삭제, 확인 ─────────────────────────────────
// src/main.js에서 옮김 (결정 70). Electron을 가져오지 않는다: 토큰 저장소(dictation.js), 링크 열기(shell),
// Anthropic SDK는 본체가 ctx로 넘긴다. 토큰 확인의 네트워크는 예전처럼 전역 fetch를 쓴다.
import type { Ipc } from './ipc.mjs';

export const DIARIZE_MODEL = 'pyannote/speaker-diarization-community-1';
export const EXTERNAL_LINKS = new Set([
  'https://huggingface.co/settings/tokens',
  `https://huggingface.co/${DIARIZE_MODEL}`,
  'https://console.anthropic.com/settings/keys',
  'https://brew.sh',
]);

// 앱에 저장한 것 / 앱 밖(hf 명령줄 로그인, 환경 변수)에 있는 것 (dictation.tokenSources)
export interface TokenSources {
  hf: { app: boolean; cli: boolean };
  anthropic: { app: boolean; env: boolean };
}

export interface VerifyResult {
  ok: boolean;
  message: string;
  user?: string;
}

// 쓰는 것만: new Anthropic({…}).models.list({ limit: 1 })
export type AnthropicClient = new (opts: { apiKey: string; timeout: number; maxRetries: number }) => {
  models: { list(query: { limit: number }): Promise<unknown> };
};

export interface TokensContext {
  dictation: {
    tokenSources(): TokenSources;
    saveSettings(patch: { hfToken: string } | { apiKey: string }): unknown; // 토큰·키는 safeStorage로 암호화해 저장한다
    hfToken(): string | null;
    hfCliToken(): string | null;
    apiKey(): string | null;
  };
  shell: { openExternal(url: string): unknown };
  anthropic: () => AnthropicClient; // require('@anthropic-ai/sdk').default — 키를 확인할 때만 불러온다
}

export function registerTokens(ipc: Ipc, ctx: TokensContext): void {
  ipc.handle('tokens:status', () => ctx.dictation.tokenSources());
  ipc.handle('tokens:save', (_e, kind, value) => {
    const v = String(value ?? '').trim();
    if (!v) return ctx.dictation.tokenSources();
    ctx.dictation.saveSettings(kind === 'hf' ? { hfToken: v } : { apiKey: v });
    return ctx.dictation.tokenSources();
  });
  ipc.handle('tokens:clear', (_e, kind) => {
    ctx.dictation.saveSettings(kind === 'hf' ? { hfToken: '' } : { apiKey: '' });
    return ctx.dictation.tokenSources();
  });
  ipc.handle('tokens:verify', async (_e, kind): Promise<VerifyResult> => {
    try {
      if (kind === 'hf') {
        const token = ctx.dictation.hfToken() ?? ctx.dictation.hfCliToken();
        if (!token) return { ok: false, message: '저장된 토큰이 없습니다' };
        const headers = { Authorization: `Bearer ${token}` };
        const who = await fetch('https://huggingface.co/api/whoami-v2', { headers, signal: AbortSignal.timeout(10000) });
        if (!who.ok) return { ok: false, message: '토큰이 맞지 않습니다 (만료되었거나 잘못 입력됨)' };
        const user = ((await who.json()) as { name: string }).name;
        // 약관에 동의하지 않은 계정은 모델 파일을 받을 수 없다 (403)
        const model = await fetch(`https://huggingface.co/${DIARIZE_MODEL}/resolve/main/config.yaml`, {
          method: 'HEAD',
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
        });
        const access = model.status < 400;
        return {
          ok: access,
          user,
          message: access ? `${user} 계정 · 화자 구분 모델 사용 가능` : `${user} 계정 · 모델 약관에 아직 동의하지 않았습니다`,
        };
      }
      const key = ctx.dictation.apiKey();
      if (!key) return { ok: false, message: '저장된 API 키가 없습니다' };
      const Anthropic = ctx.anthropic();
      await new Anthropic({ apiKey: key, timeout: 10000, maxRetries: 0 }).models.list({ limit: 1 });
      return { ok: true, message: 'API 키 사용 가능' };
    } catch (caught) {
      const err = caught as { status?: unknown; message?: unknown };
      const status = err?.status;
      if (status === 401) return { ok: false, message: 'API 키가 맞지 않습니다' };
      if (status === 403) return { ok: false, message: '이 키로는 접근 권한이 없습니다' };
      return { ok: false, message: `확인하지 못했습니다: ${err.message}` };
    }
  });
  ipc.on('app:openExternal', (_e, url) => {
    if (EXTERNAL_LINKS.has(url as string)) ctx.shell.openExternal(url as string);
  });
}
