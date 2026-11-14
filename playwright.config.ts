// E2E 시험(Playwright Electron) — 가짜 API로 메인 창을 띄워 사용자가 하는 일을 해 본다 (docs/testing.md).
//   npm run build:renderer && npx playwright test [이름 일부]
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts', // vitest가 집지 않게 .test/.spec이 아닌 이름
  outputDir: '.work/e2e/results',
  reporter: [['list'], ['html', { outputFolder: '.work/e2e/report', open: 'never' }]],
  timeout: 30000,
  expect: { timeout: 4000 },
  fullyParallel: true,
  workers: 4,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'e2e', grepInvert: /@screens/ },
    // 화면 캡처 비교: 기준 그림은 이 컴퓨터에만 (e2e/screens.e2e.ts)
    { name: 'screens', grep: /@screens/, snapshotPathTemplate: '.work/e2e/screens/{testName}/{arg}{ext}', expect: { toHaveScreenshot: { maxDiffPixels: 0 } } },
  ],
});
