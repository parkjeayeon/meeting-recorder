// 시험마다 새 예시 회의 폴더·새 설정 폴더로 앱(가짜 API)을 띄운다 — 앞 시험이 바꾼 파일·설정이 뒤에 번지지 않는다.
import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { makeMeeting } = require('../scripts/dev/verify/fixture.js'); // package.json이 CommonJS라 Playwright도 CommonJS로 옮겨 돌린다

// 기본값: 시험이 켠 상태(폴더 막힘·회의록 멈춤 등)만 다르게 — 옛 feature-test.js의 기본과 같다
const BASE = { STUB_MANY: '0', STUB_DICTS: '0', STUB_STRAY: 'none', STUB_HISTORY_DICTS: '', STUB_JOB_MS: '300', STUB_ASK_MS: '100', STUB_FOLDER: '', STUB_MINUTES: '', STUB_GUESS: '' }; // ''는 지움 (셸에 남은 값이 번지지 않게)
// 화면 오류로 치지 않는 것 (가짜 화면에 없는 rec:// 소리 파일 등)
const IGNORED_ERRORS = /rec:\/\/|net::ERR|Autofill/;

type Stub = Record<string, string>;
export type Fixtures = {
  stub: Stub;
  /** 예시 회의 폴더 없이 띄운다 (회의가 하나도 없을 때) */
  noMeeting: boolean;
  /** 예시 회의 폴더를 만드는 함수 (기본: verify/fixture.js의 makeMeeting) */
  makeDir: () => string;
  /** 띄울 진입점 (기본: 메인 창 e2e/main.cjs) */
  entry: string;
  dir: string;
  id: string;
  app: ElectronApplication;
  page: Page;
  /** 가짜 API가 받은 호출 [이름, 인자] 전부 */
  log: () => Promise<[string, unknown[]][]>;
  /** 가짜 API가 받은 이 이름의 호출 인자들 */
  called: (name: string) => Promise<unknown[][]>;
  /** 회의 화면으로 옮기고 탭이 그려질 때까지 */
  go: (hash: string) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  stub: [{}, { option: true }],
  noMeeting: [false, { option: true }],
  // 함수 값은 fixture 함수로 읽히므로 use()로 넘긴다 — 시험 파일에서는 test.use({ makeDir: async ({}, use) => use(() => …) })
  makeDir: [async ({}, use) => use(() => makeMeeting()), { option: true }],
  entry: [path.join(__dirname, 'main.cjs'), { option: true }],
  dir: async ({ noMeeting, makeDir }, use) => {
    const dir = noMeeting ? '' : makeDir();
    await use(dir);
    if (dir.startsWith(os.tmpdir())) fs.rmSync(path.dirname(dir), { recursive: true, force: true }); // makeMeeting이 만든 임시 폴더째
  },
  id: async ({ dir }, use) => use(path.basename(dir)),
  app: async ({ stub, dir, entry }, use) => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-e2e-'));
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...BASE, ...stub, E2E_USER_DATA: userData };
    if (dir) env.STUB_MEETING_DIR = dir; else delete env.STUB_MEETING_DIR;
    for (const [k, v] of Object.entries(env)) if (v === '') delete env[k];
    const app = await _electron.launch({ args: [entry], env });
    await use(app);
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  },
  page: async ({ app }, use, testInfo) => {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORED_ERRORS.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForLoadState('domcontentloaded');
    await use(page);
    if (testInfo.status === testInfo.expectedStatus) expect(errors, '화면 오류 없음').toEqual([]);
  },
  log: async ({ page }, use) => use(() => page.evaluate(() => (window as unknown as { stubLog: () => [string, unknown[]][] }).stubLog())),
  called: async ({ log }, use) => use(async (name) => (await log()).filter(([n]) => n === name).map(([, a]) => a)),
  go: async ({ page }, use) => use(async (hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    if (hash.startsWith('#meeting/')) await expect(page.getByRole('tab', { selected: true }).or(page.locator('.page', { hasText: '다시 쓰기' })).first()).toBeVisible();
  }),
});

export { expect };
