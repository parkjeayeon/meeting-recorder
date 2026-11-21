// 외부 프로그램을 macOS 샌드박스(sandbox-exec)로 감싸기. 구현은 src/core/sandbox.mts (TypeScript, 결정 70), 앞문은 플랫폼 층 (결정 78).
// 설치 도구(setup.js)·받아쓰기(dictation.js)·회의록(minutes.js)과 scripts/dev/sandbox-check.js가 이 경로로 불러 쓴다.
const { wrap, profile, cacheEnv } = require('../lib/platform/index.mjs').platform.sandbox;

module.exports = { wrap, profile, cacheEnv };
