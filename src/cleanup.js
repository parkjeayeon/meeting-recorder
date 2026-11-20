// LLM 층(src/llm, TypeScript)을 본체에 잇는 자리. 구현은 src/llm에 있고, 여기서는 Electron이 아는 값만 넘긴다.
// 본체의 다른 파일과 scripts/dev의 시험은 이 파일을 불러 쓴다 — 시험이 complete·providerStatus를 가짜로 바꿔 끼우므로
// (scripts/dev/ask-engine-check.js) 내보내는 객체는 바꿀 수 있는 보통 객체로 둔다.
const { app } = require('electron');
const llm = require('../lib/llm/index.mjs');

// 설정 파일·CLAUDE.md·MCP 서버를 읽지 않도록 CLI는 앱 데이터 폴더 안 빈 폴더에서 돌린다
// 사용량 문구를 LLM으로 읽을 때 쓸 계정·키는 지금 설정에서 (dictation.js가 이 파일을 불러 쓰므로 부를 때 가져온다)
llm.configure({
  workRoot: () => app.getPath('userData'),
  credentials: () => {
    const dictation = require('./dictation');
    return { choice: dictation.getSettings().provider, apiKey: dictation.apiKey() };
  },
});

module.exports = { cleanup: llm.cleanup, complete: llm.complete, parseJson: llm.parseJson, providerStatus: llm.providerStatus, providerOrder: llm.providerOrder, PROVIDERS: llm.PROVIDERS };
