import { test, expect } from './app.ts';

test.describe('회의 30개', () => {
  test.use({ stub: { STUB_MANY: '30' } });

  test('회의 목록 · 갈래와 개수', async ({ page, go }) => {
    await go('#meetings');
    const chip = (name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) }).and(page.locator('.page [aria-pressed]')).first();
    await chip('전체').waitFor();
    const chips = await page.locator('.page [aria-pressed]').evaluateAll((buttons) => buttons
      .filter((b) => (b as HTMLElement).offsetParent)
      .map((b) => [b.textContent!.replace(/\d+$/, '').trim(), Number(b.textContent!.match(/(\d+)$/)?.[1] ?? -1)] as const));
    const counts: Record<string, number> = {};
    const byChip = Object.fromEntries(chips);
    for (const [label] of chips.filter(([l]) => ['전체', '확인 완료', '확인할 회의', '녹음만 · 실패'].includes(l))) {
      await chip(label).click();
      // 클릭한 갈래의 렌더가 끝난 뒤 옛 offsetParent 조건으로 개수를 읽는다.
      await chip(label).and(page.getByRole('button', { pressed: true })).waitFor();
      counts[label] = await page.getByRole('link').evaluateAll((links) => links.filter((a) =>
        a.getAttribute('href')?.startsWith('#meeting/') && (a as HTMLElement).offsetParent).length);
    }
    await test.step('갈래 칩: 확인 완료 + 확인할 회의로 나뉘고, 나머지(짧은 녹음)는 녹음만·실패에', async () => {
      const leftover = byChip['전체'] - byChip['확인 완료'] - byChip['확인할 회의'];
      expect(byChip['전체']).toBe(31);
      expect(leftover).toBeGreaterThanOrEqual(0);
      expect(byChip['녹음만 · 실패']).toBeGreaterThanOrEqual(leftover);
      expect(byChip['확인할 회의']).toBeGreaterThan(0);
    });
    await test.step('갈래를 누르면 그 갈래의 회의만(개수 = 칩 숫자)', async () => {
      for (const label of ['확인 완료', '녹음만 · 실패']) expect(counts[label]).toBe(byChip[label]);
    });
  });

  test('회의 목록 · 검색', async ({ page, go }) => {
    await go('#meetings');
    await test.step('검색: 제목에 그 말이 든 회의만, 없으면 0', async () => {
      const search = page.getByPlaceholder('제목, 요약 검색', { exact: true });
      await search.fill('채용');
      const titles = () => page.getByRole('link').evaluateAll((links) => links
        .filter((a) => a.getAttribute('href')?.startsWith('#meeting/') && (a as HTMLElement).offsetParent)
        .map((a) => (a as HTMLElement).innerText.split('\n').find((l) => /\d차/.test(l)) ?? (a as HTMLElement).innerText.split('\n')[0]));
      await expect.poll(async () => {
        const found = await titles();
        return found.length > 0 && found.every((t) => t.includes('채용'));
      }).toBe(true);
      await search.fill('없는제목입니다');
      await expect.poll(titles).toHaveLength(0);
    });
  });
});

test.describe('회의 40개', () => {
  test.use({ stub: { STUB_MANY: '40' } });
  test('회의 목록 · 확인할 회의 넘침과 바로가기', async ({ page, go }) => {
    await go('#meetings');
    await test.step('확인할 회의가 6개를 넘으면 "N건 더 보기" → 확인할 회의 갈래', async () => {
      const more = page.getByRole('button', { name: /건 더 보기/ }).first();
      await expect.poll(async () => (await more.textContent())?.trim()).toBeTruthy();
      await more.click();
      await expect(page.locator('.page').getByRole('button', { pressed: true }).first()).toHaveText(/^확인할 회의/);
    });
    await page.locator('.page').getByRole('button', { name: /^전체/, pressed: false }).first().click();
    await test.step('묶음: 확인할 회의 → 최근 회의 → 이전 회의, 오른쪽 바로가기', async () => {
      await expect.poll(() => page.getByRole('heading', { level: 2 }).allTextContents()).toEqual(expect.arrayContaining(['확인할 회의', '최근 회의', '이전 회의']));
      await expect.poll(() => page.locator('nav button, aside button').evaluateAll((buttons) => buttons
        .filter((b) => (b as HTMLElement).offsetParent)
        .map((b) => b.textContent!.trim()).some((t) => t.startsWith('최근 회의')))).toBe(true);
    });
  });
});

test.describe('회의 폴더 없음', () => {
  test.use({ noMeeting: true });
  test('회의 목록 · 회의가 없을 때', async ({ page, go }) => {
    await page.evaluate(() => localStorage.clear());
    await go('#meetings');
    await page.getByRole('heading', { name: /^회의/, level: 1 }).waitFor();
    await test.step('회의가 없으면 빈 화면 안내', async () => {
      await expect(page.locator('.page')).toContainText(/아직|없습니다/, { useInnerText: true });
    });
  });
});
