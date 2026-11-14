// 화면 캡처 비교 (scripts/dev/screens.js를 옮긴 것) — 가짜 데이터로 화면마다 찍어 기준 그림과 픽셀로 비교한다.
// 기준은 이 컴퓨터의 .work/e2e/screens/에만 (가짜 데이터에 '지금' 기준 시각이 있어 저장소에 올리지 않는다):
//   바꾸기 전: npm run test:screens -- --update-snapshots   →   바꾼 뒤: npm run test:screens   (다르면 .work/e2e/report에 차이 그림)
// STUB_FLOW·STUB_ACTIONS=<json 경로>로 흐름도·액션 예시를 바꿔 볼 수 있다 — 실제 회의 내용이 찍히니 결과를 저장소에 올리지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './app.ts';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { FLOW, ACTIONS } = require('../scripts/dev/verify/fixture.js'); // 흐름도·액션 예시는 검증 도구와 한 벌

function makeScreensMeeting() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-stub-')) + '/2026-11-01_23-00-00_meeting';
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?', '[00:06] [화자 2] 네, 화요일 오전이 좋을 것 같아요.', '[00:11] [화자 1] QA는 월요일까지 끝낼 수 있죠?', '[00:15] [화자 2] 랩캐시도 쪽 확인만 하면 됩니다.'];
  fs.writeFileSync(path.join(dir, 'transcript.txt'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'script-clean.txt'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'minutes.md'), '# 예시 회의: 배포 일정 정리\n\n## 요약\n배포 일정과 QA 범위를 정리함.\n\n## 결정 사항\n- 배포는 화요일 오전 (00:06)\n- QA 범위는 결제·로그인·알림 세 가지로 좁히고, 나머지는 배포 뒤 모니터링으로 확인하기로 함. 일정이 밀리면 알림은 다음 배포로 넘김 (00:11).\n\n## 할 일\n- [ ] QA 마치기 — 담당: 화자 2, 기한: 월요일\n\n## 확인 필요\n- "랩캐시도"(00:15): Memcached로 추정됨\n');
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify({ items: [{ id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '캐시 관련 용어가 잘못 인식된 것으로 보임', status: 'open' }, { id: 'r2', kind: 'lost', at: '00:20', heard: null, note: '00:20~00:40 구간 녹음이 빠져 QA 범위 이야기 앞부분이 없음', status: 'open' }] }));
  fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify({ terms: [
    { id: 'g1', term: 'QA', note: '출시 전에 기능이 제대로 동작하는지 확인하는 품질 검사', basis: 'general', status: 'confirmed', source: 'llm', at: ['00:11'] },
    { id: 'g2', term: '알림', note: '앱 푸시 알림 기능. 이번 배포 범위에서 빠질 수 있음', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
    { id: 'g3', term: '랩캐시도', note: '회의에서 설명 없음', basis: 'unknown', status: 'suggested', source: 'llm', at: ['00:15'] },
  ] }));
  fs.writeFileSync(path.join(dir, 'flow.json'), process.env.STUB_FLOW ? fs.readFileSync(process.env.STUB_FLOW) : JSON.stringify(FLOW));
  fs.writeFileSync(path.join(dir, 'actions.json'), process.env.STUB_ACTIONS ? fs.readFileSync(process.env.STUB_ACTIONS) : JSON.stringify(ACTIONS));
  return dir;
}

test.use({ makeDir: async ({}, use) => use(makeScreensMeeting), stub: { STUB_MANY: '', STUB_DICTS: '', STUB_STRAY: '', STUB_JOB_MS: '', STUB_ASK_MS: '' } });

// 홈 인사말은 찍는 시각(아침·저녁·밤)에 따라 바뀌어 가린다 — 문구는 단위 시험(pages/home/model.test.ts)이 본다
const shot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', mask: [page.locator('.page.home .hello h1')] });
const tab = (page: Page, name: string) => page.getByRole('tab').filter({ hasText: new RegExp(`^${name}`) }).click();
const backFromChat = (page: Page) => page.locator('.chat-head .icon-btn').click();

// screens.js와 같은 차례로 화면을 옮겨 가며 찍는다
async function tour(page: Page, id: string) {
  await expect(page.locator('#view')).not.toBeEmpty();
  for (const hash of ['#home', '#dictations', '#meetings']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await shot(page, hash.slice(1));
  }
  await page.locator('.page-head .btn', { hasText: '파일 가져오기' }).click();
  await shot(page, 'import-sheet');
  await page.evaluate(() => (document.getElementById('importSheet') as HTMLDialogElement).close());
  await page.evaluate((h) => { location.hash = h; }, `#meeting/${id}`);
  await expect(page.getByRole('tab', { selected: true })).toBeVisible();
  await shot(page, 'meeting');
  await page.keyboard.press('Meta+f');
  await page.locator('.find-bar input').fill('배포');
  await page.locator('.find-bar input').press('Enter');
  await shot(page, 'meeting-find');
  await page.locator('.find-bar input').press('Escape');
  await shot(page, 'meeting-find-closed');
  await tab(page, '확인 필요');
  await shot(page, 'meeting-review');
  await page.locator('.ritem button', { hasText: '구간 다시 받아쓰기' }).first().click();
  await shot(page, 'meeting-redo');
  await page.locator('.redo-acts button', { hasText: '녹취에 반영' }).click();
  await shot(page, 'meeting-redo-applied');
  await backFromChat(page);
  await shot(page, 'meeting-review-back');
  await page.locator('.ritem button', { hasText: '채팅' }).first().click();
  await page.locator('.chat textarea').fill('캐시 얘기였어요');
  await page.locator('.chat textarea').press('Enter');
  await shot(page, 'meeting-chat');
  await page.locator('.proposal button', { hasText: /^적용$/ }).click();
  await shot(page, 'meeting-chat-applied');
  // 채팅이 열린 채라 처리함 버튼이 가려져 있다 — screens.js처럼 요소를 바로 누른다
  await page.getByRole('button', { name: /^처리함/ }).evaluate((b: HTMLElement) => b.click());
  await shot(page, 'meeting-review-done');
  await backFromChat(page);
  await tab(page, '액션');
  await shot(page, 'meeting-actions');
  await tab(page, '회의록');
  await page.locator('.doc .term.guess').first().click();
  await shot(page, 'meeting-term');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('view')!.scrollTop = 1e6; });
  await shot(page, 'meeting-glossary');
  for (const hash of ['#dictionary', '#stats']) {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await shot(page, hash.slice(1));
  }
  await page.locator('#openSettings').click();
  await shot(page, 'settings');
  await page.locator('.set-tab[data-sec=engine]').click();
  await shot(page, 'settings-engine');
}

test.describe('@screens', () => {
  test('화면 · 밝은 모양', async ({ page, id }) => tour(page, id));
  test.describe(() => {
    test.use({ stub: { E2E_DARK: '1' } });
    test('화면 · 어두운 모양', async ({ page, id }) => tour(page, id));
  });
  test.describe(() => {
    test.use({ stub: { E2E_WIDTH: '960', E2E_HEIGHT: '640' } });
    test('화면 · 최소 창 크기', async ({ page, id }) => tour(page, id));
  });
  test.describe(() => {
    test.use({ stub: { STUB_FOLDER: 'denied' } });
    test('화면 · 녹음 폴더 막힘', async ({ page }) => {
      for (const hash of ['#home', '#meetings']) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        await shot(page, hash.slice(1));
      }
    });
  });
  test.describe(() => {
    test.use({ stub: { STUB_MINUTES: 'offline' } });
    test('화면 · 회의록 쓰기에서 멈춘 회의', async ({ page, id }) => {
      await page.evaluate((h) => { location.hash = h; }, `#meeting/${id}`);
      await expect(page.getByRole('button', { name: '회의록만 다시 쓰기' })).toBeVisible();
      await shot(page, 'meeting');
    });
  });
  for (const step of ['welcome', 'permissions', 'token', 'engine', 'account', 'practice', 'done']) {
    test.describe(() => {
      test.use({ stub: { OB_STEP: step } });
      test(`화면 · 처음 설정 ${step}`, async ({ page }) => {
        await expect(page.locator('#onboard')).toBeVisible();
        await shot(page, `onboarding-${step}`);
      });
    });
  }
});
