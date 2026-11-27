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
    for (const name of ['받아쓰기', '다듬기', '회의', '폰 녹음', '엔진', '계정·토큰', '권한']) {
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

test('설정 · 폰 녹음 받을 폴더와 스위치', async ({ page, called }) => {
  await page.getByRole('button', { name: /^설정/ }).first().click();
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  await settings.getByRole('button', { name: '폰 녹음', exact: true }).click();
  const saves = async () => (await called('dictSaveSettings')).map(([patch]) => patch);
  await test.step('처음: 폴더 없음, 두 스위치 잠김', async () => {
    await expect(settings.locator('#inboxDirPath')).toHaveText('아직 고르지 않았습니다');
    await expect(settings.locator('#inboxEnabled')).toBeDisabled();
    await expect(settings.locator('#inboxCopyMinutes')).toBeDisabled();
    await expect(settings.getByRole('button', { name: '열기', exact: true })).toBeHidden();
  });
  await test.step('Drive 내려받기 링크는 바깥 브라우저로', async () => {
    await settings.getByRole('button', { name: '내려받기 페이지', exact: true }).click();
    await expect.poll(() => called('openExternal')).toEqual([['https://www.google.com/drive/download/']]);
  });
  await test.step('폴더를 고르면 저장되고 ~로 보이며 지켜보기만 풀림', async () => {
    await settings.getByRole('button', { name: '폴더 고르기…', exact: true }).click();
    await expect.poll(saves).toEqual([{ inboxDir: '/Users/me/Google Drive/폰 녹음' }]);
    await expect(settings.locator('#inboxDirPath')).toHaveText('~/Google Drive/폰 녹음');
    await expect(settings.getByRole('button', { name: '변경…', exact: true }).last()).toBeVisible();
    await expect(settings.locator('#inboxEnabled')).toBeEnabled();
    await expect(settings.locator('#inboxCopyMinutes')).toBeDisabled();
  });
  await test.step('지켜보기를 켜면 회의록 저장이 풀리고, 켜면 저장됨', async () => {
    await settings.locator('#inboxEnabled').click();
    await expect(settings.locator('#inboxCopyMinutes')).toBeEnabled();
    await settings.locator('#inboxCopyMinutes').click();
    await expect.poll(saves).toEqual(expect.arrayContaining([{ inboxEnabled: true }, { inboxCopyMinutes: true }]));
  });
  await test.step('열기는 본체에, 선택 해제는 폴더와 두 스위치를 한 번에 끔', async () => {
    await settings.getByRole('button', { name: '열기', exact: true }).last().click();
    await expect.poll(() => called('openInbox')).toEqual([[]]);
    await settings.getByRole('button', { name: '선택 해제', exact: true }).click();
    await expect.poll(async () => (await saves()).at(-1)).toEqual({ inboxDir: null, inboxEnabled: false, inboxCopyMinutes: false });
    await expect(settings.locator('#inboxDirPath')).toHaveText('아직 고르지 않았습니다');
    await expect(settings.locator('#inboxEnabled')).toBeDisabled();
    await expect(settings.locator('#inboxEnabled')).not.toBeChecked();
    await expect(settings.locator('#inboxCopyMinutes')).not.toBeChecked();
  });
});

test.describe(() => {
  test.use({ stub: { STUB_INBOX: 'overlap' } });
  test('설정 · 폰 녹음 — 녹음 폴더와 겹치는 폴더는 저장하지 않음', async ({ page, called }) => {
    await page.getByRole('button', { name: /^설정/ }).first().click();
    const settings = page.getByRole('dialog', { name: '설정', exact: true });
    await settings.getByRole('button', { name: '폰 녹음', exact: true }).click();
    await settings.getByRole('button', { name: '폴더 고르기…', exact: true }).click();
    await expect(settings.locator('#inboxDirError')).toHaveText('녹음 폴더와 겹치는 폴더는 고를 수 없습니다.');
    await expect(settings.locator('#inboxDirPath')).toHaveText('아직 고르지 않았습니다');
    expect(await called('dictSaveSettings')).toEqual([]);
  });
});
