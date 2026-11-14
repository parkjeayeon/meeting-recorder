import { uiTest as test, expect, calls } from './fixture.ts';

test('회의 목록 · 목록 밖 폴더', async ({ page, go }) => {
  await go('#meetings');
  const rows = page.locator('.stray-row');
  await test.step('목록에 안 나오는 폴더 표시', async () => {
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('날짜를 읽지 못함');
    await expect(rows.nth(2)).toContainText('meta.json');
  });
  await test.step('폴더 휴지통으로', async () => {
    await rows.first().getByRole('button', { name: '휴지통으로', exact: true }).click();
    await page.locator('#confirmYes').click();
    await expect.poll(async () => (await calls(page)).trashed).toHaveLength(1);
    expect((await calls(page)).trashed![0]).toMatch(/112-06-26_02-26-26_meeting$/);
    await expect(rows).toHaveCount(2);
  });
});

test('설정 · 다듬기 계정 사용량', async ({ page }) => {
  await page.locator('#openSettings').click();
  await page.locator('.set-tab[data-sec="cleanup"]').click();
  await test.step('다듬기 계정 남은 사용량', async () => {
    const rows = page.locator('.usage-row');
    await expect(rows).toHaveCount(4);
    // textContent에 low 표시를 붙이는 옛 계산을 유지한다 (15% 뒤 공백 검사 포함).
    await expect.poll(() => rows.evaluateAll((elements) => {
      const text = elements.map((r) => r.textContent + (r.classList.contains('low') ? ' [low]' : ''));
      return text.length === 4 && text[0].includes('85% 남음') && !text[1].includes('15% 남음 ')
        && text[1].includes('[low]') && text[3].includes('84% 남음');
    })).toBe(true);
  });
  await test.step('사용량 새로 고침', async () => {
    await page.locator('.usage-foot').getByRole('button', { name: '새로 고침', exact: true }).first().click();
    await expect.poll(async () => (await calls(page)).usage?.slice(-1)).toEqual([true]);
  });
});

test('가져오기 · 회의 시각', async ({ page, go }) => {
  await go('#meetings');
  await page.getByRole('button', { name: /파일 가져오기/ }).click();
  const date = page.getByLabel('회의 날짜', { exact: true });
  const time = page.getByLabel('회의 시작 시각', { exact: true });
  await test.step('가져오기 날짜 채움', async () => {
    await expect(date).toHaveValue('2026-11-01');
    await expect(time).toHaveValue('14:00');
    await expect(page.locator('#importWhenSrc')).toContainText('파일 이름');
  });
  await test.step('가져오기 날짜 고치기', async () => {
    await date.fill('2099-01-01');
    await page.locator('#importYes').click();
    // 잘못된 미래 시각이 비동기 API 호출을 만들지 않는지 관찰하는 음성 검사.
    await page.waitForTimeout(300);
    expect((await calls(page)).importMeeting ?? null).toBeNull();
    await date.fill('2026-10-20');
    await time.fill('09:30');
    await page.locator('#importYes').click();
    await expect.poll(async () => (await calls(page)).importMeeting?.startedAt).toBeTruthy();
    const at = new Date((await calls(page)).importMeeting!.startedAt!);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 9, 20, 9, 30]);
  });
});

test('공통 UI · 아이콘 설명', async ({ page, go }) => {
  // 앞선 화면이 있어 뒤로 버튼이 활성화된 옛 시험의 상태를 만든다.
  await go('#meetings');
  await expect(page.getByPlaceholder('제목, 요약 검색')).toBeVisible();
  await go('#home');
  await test.step('아이콘 버튼 설명', async () => {
    const back = page.getByRole('button', { name: '뒤로', exact: true });
    const tip = page.getByRole('tooltip', { includeHidden: true });
    await back.dispatchEvent('mouseover');
    // 설명이 즉시 나오지 않아야 한다: 옛 150ms 지연 전 음성 검사를 유지한다.
    await page.waitForTimeout(150);
    await expect(tip).not.toHaveClass(/\bshow\b/);
    await expect(tip).toHaveClass(/\bshow\b/);
    await expect(tip).toHaveText('뒤로 (⌘[)');
    expect(await back.getAttribute('title')).toBeNull();
    await back.evaluate((button) => button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    await expect(back).toHaveAttribute('title', '뒤로 (⌘[)');
    await page.locator('#memoBtn').dispatchEvent('mouseover');
    // 글자 버튼에는 tooltip 지연(400ms)이 지나도 설명이 생기지 않아야 한다.
    await page.waitForTimeout(550);
    await expect(tip).not.toHaveClass(/\bshow\b/);
    await page.locator('#memoBtn').evaluate((button) => button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    // 옛 시험처럼 마우스를 옮기지 않고 연다 — 진짜 클릭은 마우스가 설정 버튼(아이콘 버튼) 위에 남아 그 설명이 끼어든다
    await page.locator('#openSettings').evaluate((b: HTMLElement) => b.click());
    await expect(page.locator('#settings')).toBeVisible();
    const close = page.locator('#settings .set-close');
    await close.dispatchEvent('mouseover');
    await expect(tip).toHaveClass(/\bshow\b/);
    await expect(tip).toHaveText('닫기');
    expect(await tip.evaluate((t) => t.parentElement?.tagName)).toBe('DIALOG');
  });
});

test('홈 · 챙길 일과 저장 공간', async ({ page, go }) => {
  await go('#home');
  await test.step('홈 챙길 일·녹음 공간', async () => {
    const todo = page.locator('.todo-row').filter({ hasText: '확인할 회의' });
    await expect(todo).toBeVisible();
    const text = await todo.evaluate((r) => r.querySelector('b')!.textContent + ' ' + r.querySelector('.todo-n')!.textContent);
    expect(text.startsWith('확인할 회의')).toBe(true);
    await expect(page.locator('.store-sum > span')).toHaveText(/^원본 WAV/);
    await expect.poll(() => page.locator('.srow .ssize .num').allTextContents()).toContain('689MB');
    await todo.click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#meetings');
    await expect(page.locator('.chips .chip[aria-pressed="true"]')).toHaveText(/^확인할 회의/);
  });
});

test('받아쓰기 · 이어 받기와 전체 검색', async ({ page, go }) => {
  await go('#dictations');
  await test.step('받아쓰기 이어 받기', async () => {
    const rows = page.locator('.dlist > *');
    await expect(rows).toHaveCount(30);
    await expect(page.locator('.page-head h1 .num')).toHaveText('75');
    await page.locator('#view').evaluate((view) => { view.scrollTop = 1e7; });
    await expect(rows).toHaveCount(60);
    await page.locator('#view').evaluate((view) => { view.scrollTop = 1e7; });
    await page.waitForTimeout(500); // 옛 시험처럼 세 번째 스크롤 뒤에 센다
    await page.locator('#view').evaluate((view) => { view.scrollTop = 1e7; });
    await expect(rows).toHaveCount(75);
    await expect(page.locator('.load-more')).toContainText('다 보았습니다');
  });
  await test.step('받아쓰기 검색은 전체에서', async () => {
    await page.getByPlaceholder('받아쓴 말, 앱 이름 검색 (전체)').fill('배포');
    await expect(page.locator('.dlist > *')).toHaveCount(1);
    await expect(page.locator('.dlist')).toContainText('오래된 배포');
    await expect(page.locator('.dict-count')).toContainText('전체 75개');
  });
  await test.step('통계: 언어별 비율', async () => {
    await go('#stats');
    const card = page.locator('.card').filter({ hasText: '어떤 언어로' });
    for (const text of ['한국어', 'English', '80%', '15회']) await expect(card).toContainText(text);
  });
});

test('공통 UI · 받아쓰기 언어', async ({ page, go }) => {
  await test.step('왼쪽 아래 받아쓰기 언어', async () => {
    const language = page.getByRole('combobox', { name: '받아쓰기 언어', exact: true });
    for (const route of ['home', 'meetings', 'dictionary']) {
      await go(`#${route}`);
      await expect(language).toBeVisible();
      expect(await language.evaluate((el) => Boolean((el as HTMLElement).offsetParent))).toBe(true);
    }
    await language.selectOption('en');
    await expect.poll(async () => (await calls(page)).dictSave?.at(-1)).toEqual({ language: 'en' });
    await expect(page.locator('#dictLanguage')).toHaveValue('en');
    await expect(page.locator('#meetLanguage')).toHaveValue('ko');
    await expect(page.locator('#toasts .toast').filter({ hasText: '받아쓰기 언어' })).toContainText('English');
    await language.selectOption('ko'); // 되돌리기만 (옛 시험도 저장은 보지 않음)
  });
});
