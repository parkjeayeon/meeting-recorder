// LLM 층: 다듬기 계정(Claude Code·Codex·API 키) 고르기, 호출, 받아쓴 글 다듬기, 남은 사용량.
// Electron 없이 돈다. 본체(CommonJS)는 src/cleanup.js·src/usage.js가 require('../lib/llm/index.mjs')로 불러 쓴다.
import { setUsageHooks } from './call.mjs';
import { setWorkRoot } from './providers.mjs';
import { markExhausted, setCredentials, usedForRouting } from './usage.mjs';
import type { Choice } from './call.mjs';

// 계정 고르기가 사용량을 보게 잇는다 (call.mts와 usage.mts가 서로 가져오지 않게 여기서)
setUsageHooks({ usedForRouting, markExhausted });

// 본체가 아는 값: workRoot(CLI를 돌릴 빈 폴더를 둘 곳 — 앱 데이터 폴더), credentials(지금 설정의 다듬기 계정·API 키)
export function configure(opts: { workRoot?: () => string; credentials?: () => { choice: Choice; apiKey: string | null } }): void {
  if (opts.workRoot) setWorkRoot(opts.workRoot);
  if (opts.credentials) setCredentials(opts.credentials);
}

export { PROVIDERS, providerStatus, type ProviderId, type ProviderStatus } from './providers.mjs';
export { complete, providerOrder, type Choice, type Effort, type CompleteOptions } from './call.mjs';
export { cleanup, systemFor, type CleanupResult } from './cleanup.mjs';
export { parseJson, splitChunks, joinCleaned, mapLimit } from './text.mjs';
export { usage, fromClaudeText, usedForRouting, markExhausted, type UsageValue } from './usage.mjs';
