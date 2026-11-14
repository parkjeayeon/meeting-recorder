import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../app.ts';

test.use({ entry: path.join(__dirname, 'overlay.cjs'), noMeeting: true });

test('떠 있는 막대 · 언어와 창 크기', async ({ page }) => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../../src/main.js'), 'utf8');
  const height = Number(/const OVERLAY_SIZE = \{ width: \d+, height: (\d+) \}/.exec(mainSrc)?.[1]);
  expect(Number.isFinite(height)).toBe(true);
  await page.locator('#dock').evaluate((dock) => dock.classList.add('open'));
  const language = page.getByRole('button', { name: '받아쓰기 언어 바꾸기' });
  await test.step('언어 버튼이 지금 언어를 보이고 누르면 바뀜', async () => {
    const seen: string[] = [];
    for (const value of ['KO', 'EN', 'JA', '자동', 'KO']) {
      await expect(page.locator('#langCode')).toHaveText(value);
      seen.push((await page.locator('#langCode').textContent())!);
      await language.click();
    }
    expect(seen).toEqual(['KO', 'EN', 'JA', '자동', 'KO']);
    await expect(page.locator('#langCode')).toHaveText('EN');
  });
  await test.step('언어 툴팁', async () => {
    await language.dispatchEvent('mouseenter');
    await expect(page.locator('#tip')).toHaveText(/^받아쓰기 언어 · English/);
  });
  await test.step('버튼이 막대 창 안에', async () => {
    await expect.poll(() => page.locator('.buttons').evaluate((buttons, h) => {
      const { top, bottom } = buttons.getBoundingClientRect();
      return top >= 0 && bottom <= h;
    }, height)).toBe(true);
  });
});
