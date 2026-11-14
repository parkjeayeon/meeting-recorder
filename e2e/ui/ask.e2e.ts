import { uiTest as test, expect, calls, checkKeys, openAsk, ask, closeAsk } from './fixture.ts';

// 기간 충돌 → 재시도 → 정상 질문 → 실패 둘 → 닫기의 순서가 마지막 탭 수·삭제 호출 수를 만든다.
test('질문으로 찾기 · 조건과 결과 탭', async ({ page, go }) => {
  await test.step('둥근 버튼이 모든 화면에', async () => {
    for (const route of ['home', 'dictations', 'meetings', 'stats']) {
      await go(`#${route}`);
      const fab = page.getByRole('button', { name: '질문으로 찾기', exact: true });
      await expect(fab).toBeVisible();
      expect(await fab.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    }
  });
  await go('#home');
  await test.step('질문으로 찾기 입력', async () => {
    const panel = await openAsk(page);
    await checkKeys(panel.getByRole('textbox', { name: '찾을 회의' }));
  });
  await test.step('최근 몇 개는 숫자만', async () => {
    await page.getByRole('button', { name: '최근 몇 개', exact: true }).click();
    const count = page.getByRole('textbox', { name: '최근 몇 개', exact: true });
    await count.focus();
    await count.press('1');
    await count.press('2');
    await count.press('a');
    await expect(count).toHaveValue('12');
    await expect(page.locator('.cchip[data-chip="count"]')).toContainText('최근 12개');
    await page.getByRole('button', { name: '최근 몇 개 지우기', exact: true }).click();
  });
  await test.step('기간은 누르면 최근 7일', async () => {
    const range = page.locator('.cchip[data-chip="range"]');
    await expect(range).toHaveText('기간');
    await range.click();
    await expect(range).toContainText('–');
    await expect(page.getByRole('button', { name: '최근 7일', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  await test.step('기간이 안 겹치면 찾지 않음', async () => {
    await page.evaluate(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))); // 옛 시험처럼 팝오버를 닫고 묻는다
    await ask(page, '작년 배포 회의');
    const warn = page.locator('.bubble.warn');
    await expect(warn).toContainText('찾지 않았습니다');
    await expect(warn).toContainText('기간 칩 빼고');
    await go('#meetings');
    await expect(page.getByPlaceholder('제목, 요약 검색')).toBeVisible();
    await expect(page.locator('.chip.ask')).toHaveCount(0);
  });
  await test.step('기간 칩 빼고 다시 찾기', async () => {
    await openAsk(page);
    await page.locator('.bubble.warn').getByRole('button', { name: /기간 칩 빼고/ }).click();
    await expect.poll(async () => {
      const retried = (await calls(page)).askStart?.at(-1);
      return Boolean(retried?.question === '작년 배포 회의' && !retried.scope.from && !retried.scope.to);
    }).toBe(true);
    await expect(page.locator('.chip.ask[title="작년 배포 회의"]')).toContainText('2');
  });
  await test.step('다른 화면에서 끝나면 알림·뱃지', async () => {
    await closeAsk(page);
    await go('#home');
    await ask(page, '배포 관련 회의');
    await closeAsk(page);
    await expect(page.locator('.fab .fab-ring')).toHaveCount(1);
    await expect(page.locator('.fab .fab-ring')).toHaveCount(0);
    await expect(page.locator('.fab-toast')).toContainText('2건을 찾았습니다');
    await expect.poll(async () => Number(await page.locator('.fab-badge').textContent())).toBeGreaterThanOrEqual(1);
  });
  await test.step('질문 탭: 주로 다룸·잠깐 언급과 이유', async () => {
    await page.locator('.fab-toast').click();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('#meetings');
    await expect(page.locator('.chip.ask[aria-pressed="true"]')).toContainText('배포');
    await expect(page.locator('.mix-sec .sec-h h2')).toHaveText(['주제로 다룬 회의', '잠깐 언급된 회의']);
    await expect.poll(() => page.locator('.ltitle .reason').allTextContents()).toContain('배포 일정을 정한 회의');
  });
  await test.step('찾기 실패 표시', async () => {
    await ask(page, '실패하는 질문');
    await expect(page.locator('.chip.ask.bad')).toHaveCount(1);
    await expect(page.locator('.askpanel .bubble.warn')).toContainText('답이 너무 늦어');
    await ask(page, '성능평가 로그인');
    const login = page.locator('.askpanel .bubble.warn').last();
    await expect(login).toContainText('Claude Code 로그인이 풀렸습니다');
    await expect(login).not.toContainText('Command failed');
    // 질문 창이 열린 채라 탭 칩이 가려져 있다 — 옛 시험처럼 요소를 바로 누른다
    await page.locator('.chip.ask').filter({ hasText: '로그인' }).evaluate((b: HTMLElement) => b.click());
    await expect(page.locator('.ask-error b')).toHaveText('Claude Code 로그인이 풀렸습니다');
    await expect(page.locator('.ask-error .why')).toHaveText('Invalid API key · Please run /login');
    await expect(page.locator('.askhead .conds').filter({ hasText: '푸는 중' })).toHaveCount(0);
  });
  await test.step('질문 탭 닫기', async () => {
    await closeAsk(page);
    await page.locator('.chip.ask.bad').first().getByRole('button', { name: '탭 닫기' }).click();
    await expect(page.locator('.chip.ask.bad')).toHaveCount(1);
    await page.locator('.chip.ask.bad').getByRole('button', { name: '탭 닫기' }).click();
    await expect.poll(async () => (await calls(page)).askRemove?.length ?? 0).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.chip.ask')).toHaveCount(2);
  });
});

test('질문으로 찾기 · 중단과 놓친 소식', async ({ page, go }) => {
  await go('#home');
  await test.step('찾는 도중 멈추기', async () => {
    await ask(page, '느린 배포 질문');
    await closeAsk(page);
    await go('#meetings');
    const chip = page.locator('.chip.ask[title="느린 배포 질문"]');
    await chip.click();
    await page.locator('.askhead').getByRole('button', { name: '멈추기', exact: true }).click();
    await expect.poll(async () => (await calls(page)).askStop).toHaveLength(1);
    await expect(chip).toContainText('멈춤');
    await expect(page.locator('.askhead .conds:last-child')).toContainText('멈췄습니다');
    // 중단한 작업에서 뒤늦게 완료 알림이 오지 않아야 한다. 옛 관찰 구간을 유지한다.
    await page.waitForTimeout(3500);
    await expect(page.locator('.fab-toast')).toHaveCount(0);
  });
  await test.step('놓친 소식은 스스로 맞춤', async () => {
    await ask(page, '소식없음 배포 질문');
    await closeAsk(page);
    const chip = page.locator('.chip.ask[title="소식없음 배포 질문"]');
    // 본체 소식을 일부러 보내지 않는 stub: 화면의 5초 동기화 주기를 기다린다.
    await expect.poll(async () => {
      const text = await chip.textContent();
      return Boolean(text && !/초$/.test(text) && text.includes('2'));
    }, { timeout: 8000 }).toBe(true);
  });
});
