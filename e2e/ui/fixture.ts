import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../app.ts';

// scripts/dev/ui-test.js의 예시를 그대로 사용한다. DARK 분기는 실행하지 않는다:
// 공용 e2e/main.cjs의 E2E_DARK도 비워 스타일 검사를 기존 light 기준으로 고정한다.
export function makeUiMeeting(): string {
  const meeting = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mr-ui-')), '2026-11-01_23-00-00_meeting');
  fs.mkdirSync(meeting, { recursive: true });
  const lines = ['[00:02] [화자 1] 다음 주 배포 일정 얘기해 볼까요?', '[00:06] [화자 2] 네, 화요일 오전이 좋을 것 같아요.', '[00:15] [화자 2] 랩캐시도 쪽 확인만 하면 됩니다.'];
  fs.writeFileSync(path.join(meeting, 'transcript.txt'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(meeting, 'script-clean.txt'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(meeting, 'minutes.md'), '# 예시 회의\n\n## 요약\n배포 일정을 정리함.\n\n## 할 일\n- [ ] QA 마치기 — 담당: 화자 2\n\n## 확인 필요\n- "랩캐시도"(00:15)\n');
  fs.writeFileSync(path.join(meeting, 'review.json'), JSON.stringify({ items: [
    { id: 'r1', kind: 'word', at: '00:15', heard: '랩캐시도', guess: 'Memcached', note: '오인식', status: 'open' },
    { id: 'r2', kind: 'word', at: '00:06', heard: '화요일', applied: '수요일', count: 1, note: '요일', status: 'applied', undo: { 'transcript.txt': { changed: [], inserted: [] } }, failRevert: true },
    { id: 'r4', kind: 'lost', at: null, heard: null, heardNote: null, note: '중간에 말이 끊겨 확인할 수 없음.', status: 'open' },
    { id: 'r3', kind: 'name', at: null, heard: null, heardNote: '도윤님(선배님)', note: "'도윤님(선배님)'이 누구인지 확인이 필요함", status: 'open' },
  ] }));
  return meeting;
}

export const uiTest = test.extend({
  makeDir: async ({}, use) => use(makeUiMeeting),
  // 공용 fixture의 빠른 feature-test 기본값 대신 옛 UI 시험의 기본값.
  stub: { STUB_MANY: '2', STUB_DICTS: '75', STUB_STRAY: 'sample', STUB_JOB_MS: '2500', STUB_ASK_MS: '300', E2E_DARK: process.env.DARK ? '1' : '' }, // DARK=1이면 어두운 모양 (옛 ui-test.js와 같이)
  go: async ({ go, page }, use) => use(async (hash) => {
    await go(hash);
    // 공통 버튼은 라우트가 바뀌기 전에도 보인다. 각 화면이 실제 그려진 뒤 검사한다.
    if (hash === '#home') await expect(page.locator('.page.home')).toBeVisible();
    const headings: Record<string, RegExp> = {
      '#meetings': /^회의/, '#dictations': /^받아쓰기/, '#stats': /^통계/, '#dictionary': /^사전/,
    };
    if (headings[hash]) await expect(page.getByRole('heading', { level: 1, name: headings[hash] })).toBeVisible();
  }),
});
export { expect };

type Fix = { heard?: string; guess?: string; resolve?: string };
export interface UiCalls {
  makeActions?: number;
  copied?: string;
  trashed?: string[];
  addReview?: string;
  usage?: boolean[];
  importMeeting?: { startedAt?: string };
  askStart?: { question: string; scope: { from?: string; to?: string } }[];
  askRemove?: string[];
  askStop?: string[];
  applyReview?: Fix[][];
  redoRange?: { id: string; start: number; end: number }[];
  saveSvg?: { name: string; svg: string };
  decline?: unknown[];
  compress?: string[];
  dictSave?: { language?: string }[];
}

export function calls(page: Page): Promise<UiCalls> {
  return page.evaluate(() => (window as unknown as { stubCalls: () => UiCalls }).stubCalls());
}

export async function openTab(page: Page, name: string) {
  await page.getByRole('tab').filter({ hasText: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(new RegExp(`^${name}`));
}

// 값 주입으로는 영어·Backspace를 막는 keydown 회귀를 잡을 수 없다.
// 기존 값 지우기까지 실제 키로 하고, a → b → Backspace 결과를 검사한다.
export async function checkKeys(input: Locator) {
  // 옛 시험처럼 값은 바로 비우고(input 이벤트), 진짜 키는 a·b·Backspace만 보낸다
  await input.focus();
  await input.fill('');
  await expect(input).toBeFocused();
  await input.press('a');
  await input.press('b');
  await input.press('Backspace');
  await expect(input).toHaveValue('a');
}

export async function openAsk(page: Page) {
  const panel = page.getByRole('dialog', { name: '질문으로 찾기' });
  if (!(await panel.isVisible())) await page.getByRole('button', { name: '질문으로 찾기', exact: true }).click();
  await expect(panel).toBeVisible();
  return panel;
}

export async function ask(page: Page, question: string) {
  const panel = await openAsk(page);
  await panel.getByRole('textbox', { name: '찾을 회의' }).fill(question);
  await panel.getByRole('button', { name: '찾기', exact: true }).click();
}

export async function closeAsk(page: Page) {
  await page.getByRole('dialog', { name: '질문으로 찾기' }).getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('.askpanel')).toHaveCount(0);
}
