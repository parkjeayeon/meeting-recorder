import { test, expect } from './app.ts';

test.describe('이동용 회의 3개', () => {
  test.use({ stub: { STUB_MANY: '3' } });
  test('이동 · 사이드바·뒤로·⌘K', async ({ page, id }) => {
    await test.step('사이드바로 각 화면', async () => {
      for (const [nav, hash] of [['받아쓰기', '#dictations'], ['회의', '#meetings'], ['사전', '#dictionary'], ['통계', '#stats'], ['홈', '#home']]) {
        await page.getByRole('navigation', { name: '화면', exact: true }).getByRole('link', { name: new RegExp(`^${nav}`) }).first().click();
        await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
      }
    });
    await test.step('뒤로·앞으로', async () => {
      await page.getByRole('button', { name: '뒤로', exact: true }).click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#stats');
      await page.getByRole('button', { name: '앞으로', exact: true }).click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe('#home');
    });
    await test.step('⌘K: 회의 제목으로 찾아 Enter → 그 회의', async () => {
      await page.getByRole('button', { name: /^검색/ }).first().click();
      const input = page.getByRole('dialog', { name: '빠른 검색', exact: true }).getByPlaceholder('회의 제목, 받아쓴 말, 화면, 동작 검색', { exact: true });
      await input.fill('예시 회의');
      await input.press('Enter');
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#meeting/${id}`);
    });
  });
});

test.describe('홈 회의 12개', () => {
  test.use({ stub: { STUB_MANY: '12' } });
  test('홈 · 챙길 일에서 이동', async ({ page, go, id }) => {
    await go('#home');
    await test.step('챙길 일 "회의록이 없는 녹음" → 녹음만·실패 갈래', async () => {
      await expect.poll(() => page.getByRole('button').evaluateAll((buttons) => buttons.filter((b) =>
        (b as HTMLElement).offsetParent && /확인할 회의|회의록이 없는 녹음|압축할 수 있는 녹음/.test(b.textContent ?? '')).length)).toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: /회의록이 없는 녹음/ }).first().click();
      await expect(page.locator('.page').getByRole('button', { pressed: true }).first()).toHaveText(/^녹음만/);
    });
    await test.step('최근 회의 줄 → 그 회의', async () => {
      await go('#home');
      await page.getByRole('link', { name: /예시 회의: 배포 일정 정리/ }).first().click();
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#meeting/${id}`);
    });
  });
});

test.describe('홈 회의 8개', () => {
  test.use({ stub: { STUB_MANY: '8' } });
  test('홈 · 녹음 공간', async ({ page, go }) => {
    await go('#home');
    await test.step('녹음 공간: 전체 크기·원본/압축 개수, 압축할 수 있는 녹음만 목록, 16kHz는 빼고 개수만', async () => {
      const storage = page.locator('section').filter({ has: page.getByRole('heading', { name: '녹음 공간', exact: true, level: 2 }) }).first();
      // 옛 시험처럼 보이는 글자(innerText)로
      await expect(storage).toContainText(/원본 WAV \d+개/, { useInnerText: true });
      await expect(storage).toContainText('압축할 수 있는 녹음', { useInnerText: true });
      await expect(storage).not.toContainText('16kHz · 압축 안 함', { useInnerText: true });
      await expect(storage).toContainText(/압축하지 않습니다/, { useInnerText: true });
    });
  });
});

test.describe('녹음 폴더 권한 없음', () => {
  test.use({ stub: { STUB_FOLDER: 'denied' } });
  test('녹음 폴더 접근이 막혔을 때', async ({ page, go, called }) => {
    await go('#meetings');
    await test.step('폴더 접근이 막히면 빈 목록 대신 이유와 "권한 열기"', async () => {
      await expect(page.locator('.page')).toContainText('녹음 폴더를 읽을 수 없습니다', { useInnerText: true });
      await page.getByRole('button', { name: '권한 열기', exact: true }).first().click();
      await expect.poll(async () => (await called('permOpenSettings')).length).toBeGreaterThanOrEqual(1);
      expect((await called('permOpenSettings'))[0][0]).toBe('files');
    });
  });
});
