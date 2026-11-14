import { test, expect } from './app.ts';

test('사전 · 추가와 지우기', async ({ page, go, called }) => {
  await go('#dictionary');
  await test.step('사전: 쉼표로 여러 개 추가(이미 있는 Whisper는 다시 안 넣음), 지우기', async () => {
    const input = page.getByPlaceholder(/^단어나 이름/).first();
    await input.fill('메모리캐시, Whisper');
    await input.press('Enter');
    await expect.poll(async () => (await called('dictSaveSettings')).at(-1)?.[0]).toMatchObject({ vocabulary: 'PJY, Whisper, 메모리캐시' });
    await expect(page.locator('body')).toContainText('메모리캐시', { useInnerText: true });
    await page.getByRole('button', { name: '메모리캐시 지우기', exact: true }).click();
    await expect.poll(async () => (await called('dictSaveSettings')).at(-1)?.[0]).toMatchObject({ vocabulary: 'PJY, Whisper' });
  });
});

test('설정 · 탭과 저장', async ({ page, called }) => {
  await page.getByRole('button', { name: /^설정/ }).first().click();
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  await test.step('설정 탭마다 그 칸이 보임', async () => {
    for (const name of ['받아쓰기', '다듬기', '회의', '엔진', '계정·토큰', '권한']) {
      await settings.getByRole('button', { name, exact: true }).click();
      await expect.poll(() => settings.locator('section').evaluateAll((sections) => sections.find((s) => !(s as HTMLElement).hidden)?.querySelector('h3')?.textContent?.trim() ?? null)).toMatch(new RegExp(`^${name === '권한' ? 'macOS 권한' : name}`));
    }
  });
  await test.step('다듬기 끄기·계정 고르기·회의 언어가 저장됨', async () => {
    await settings.getByRole('button', { name: '다듬기', exact: true }).click();
    // 이 두 설정 컨트롤에는 연결된 label/accessible name이 없다.
    await settings.locator('#dictCleanup').click();
    await settings.getByRole('radio', { name: /^Codex/ }).check();
    await settings.getByRole('button', { name: '회의', exact: true }).click();
    await settings.locator('#meetLanguage').selectOption('en');
    await expect.poll(async () => (await called('dictSaveSettings')).map(([patch]) => patch)).toEqual(expect.arrayContaining([
      expect.objectContaining({ cleanup: false }),
      expect.objectContaining({ provider: 'codex' }),
      expect.objectContaining({ meetingLanguage: 'en' }),
    ]));
  });
  await test.step('닫기', async () => {
    await settings.getByRole('button', { name: '닫기', exact: true }).click();
    await expect.poll(() => page.getByRole('dialog', { name: '설정', exact: true, includeHidden: true }).evaluate((d) => (d as HTMLDialogElement).open)).toBe(false);
  });
});
