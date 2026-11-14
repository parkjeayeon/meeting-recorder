// 회의 페이지 — 옛 scripts/dev/feature-test.js의 '회의 페이지 · …' 묶음을 옮긴 것. 묶음 하나 = test 하나, 옛 check 하나 = test.step 하나(이름 그대로).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './app.ts';
import { confirm, confirmIfOpen } from './feature-helpers.ts';

test('회의 페이지 · 탭과 본문', async ({ page, go, id }) => {
  await go(`#meeting/${id}`);
  const tabs = page.getByRole('tab');
  const selected = page.getByRole('tab', { selected: true });
  const open = (name: string) => tabs.filter({ hasText: new RegExp(`^${name}`) }).click();
  await test.step('탭: 회의록·확인 필요·정리본·원본·화자', async () => {
    for (const name of ['회의록', '확인 필요', '정리본', '원본', '화자']) await expect(tabs.filter({ hasText: new RegExp(`^${name}`) })).toHaveCount(1);
  });
  await test.step('처음 탭은 회의록, 요약이 보임', async () => {
    await expect(selected).toHaveText('회의록');
    await expect(page.getByText('배포 일정과 QA 범위를 정리함')).toBeVisible();
  });
  await test.step('원본 탭: 녹취 줄이 보임', async () => {
    await open('원본');
    await expect(selected).toHaveText('원본');
    await expect(page.getByText('랩캐시도 쪽 확인만').first()).toBeVisible();
  });
  await test.step('정리본 탭', async () => {
    await open('정리본');
    await expect(selected).toHaveText('정리본');
    await expect(page.getByText('화요일 오전이 좋을').first()).toBeVisible();
  });
  await test.step('화자 탭: 화자 둘', async () => {
    await open('화자');
    await expect(selected).toHaveText(/^화자/);
    await expect(page.getByText('화자 1').first()).toBeVisible();
    await expect(page.getByText('화자 2').first()).toBeVisible();
  });
  await test.step('확인 필요 탭 숫자는 남은 항목 수', async () => {
    await open('확인 필요');
    await expect(selected).toHaveText('확인 필요4');
  });
  await test.step('회의 제목·메타', async () => {
    await expect(page.getByText('예시 회의: 배포 일정 정리').first()).toBeVisible();
    await expect(page.getByText('화자 2명').first()).toBeVisible();
  });
});

test('회의 페이지 · 할 일 체크', async ({ page, go, id, dir, called }) => {
  await go(`#meeting/${id}`);
  await test.step('할 일 체크 → 두 번째 할 일만 완료로 저장', async () => {
    const todos = page.getByRole('checkbox', { name: '할 일 완료' });
    await expect(todos).toHaveCount(2);
    await expect(todos.nth(0)).not.toBeChecked();
    await expect(todos.nth(1)).not.toBeChecked();
    await todos.nth(1).click();
    await expect.poll(() => called('toggleTodo')).toHaveLength(1);
    const [call] = await called('toggleTodo');
    expect(call.slice(1, 3)).toEqual([1, true]);
    const md = () => fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8');
    await expect.poll(md).toContain('- [x] 배포 공지 쓰기');
    expect(md()).toContain('- [ ] QA 마치기');
  });
});

test('회의 페이지 · 화자 이름 바꾸기', async ({ page, go, id, called }) => {
  await go(`#meeting/${id}`);
  await test.step('화자 칩을 누르면 이름 입력칸(지금 이름), Enter로 저장', async () => {
    await page.getByRole('button', { name: '화자 1' }).first().click();
    const input = page.locator('input:focus');
    await expect(input).toHaveValue('화자 1');
    await input.fill('민준');
    await input.press('Enter');
    await expect.poll(() => called('renameSpeaker')).toHaveLength(1);
    const [call] = await called('renameSpeaker');
    expect(call.slice(1, 3)).toEqual(['화자 1', '민준']);
    await expect(page.getByRole('status').filter({ hasText: '민준' })).toBeVisible();
  });
});

test('회의 페이지 · 본문 찾기(⌘F)', async ({ page, go, id }) => {
  await go(`#meeting/${id}`);
  await test.step('⌘F: 찾은 수 "1/N"·강조, 없으면 "없음", Esc로 닫힘', async () => {
    await page.keyboard.press('Meta+f');
    const search = page.getByRole('search');
    const input = search.getByRole('searchbox');
    await input.fill('배포');
    await expect(search).toContainText(/1\/\d+/);
    await expect.poll(() => page.evaluate(() => {
      const highlights = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
      return highlights.get('find')?.size ?? 0;
    })).toBeGreaterThan(1);
    await input.fill('없는말쓰기');
    await expect(search).toContainText('없음');
    await input.press('Escape');
    await expect(search).toHaveCount(0);
  });
});

test('회의 페이지 · 용어', async ({ page, go, id, called }) => {
  await go(`#meeting/${id}`);
  await test.step('용어 칸: 확인한 것과 추정(점선·"추정")', async () => {
    await expect(page.locator('body')).toContainText('용어', { useInnerText: true });
    await expect(page.locator('body')).toContainText('추정', { useInnerText: true });
  });
  await test.step('용어: 추정 카드의 "맞아요" → 확인, 확인한 카드엔 "맞아요" 없음, "지우기"', async () => {
    // 옛 sel: 'button': 본문의 span[role=button] 대신 용어 칸의 실제 button.
    await page.getByRole('button', { name: /^알림/ }).and(page.locator('button')).first().click();
    await expect(page.getByRole('dialog', { name: '알림 설명', exact: true })).toContainText('앱 푸시 알림');
    await page.getByRole('button', { name: '맞아요', exact: true }).first().click();
    await expect.poll(async () => (await called('updateTerm')).at(-1)?.slice(1, 3)).toEqual(['g2', expect.objectContaining({ status: 'confirmed' })]);
    await page.getByRole('button', { name: /^QA/ }).and(page.locator('button')).first().click();
    const qa = page.getByRole('dialog', { name: 'QA 설명', exact: true });
    await expect.poll(() => qa.innerText()).not.toBe('');
    await expect(qa).not.toContainText('맞아요');
    await qa.getByRole('button', { name: '지우기', exact: true }).click();
    await expect.poll(async () => (await called('updateTerm')).at(-1)?.slice(1, 3)).toEqual(['g1', expect.objectContaining({ remove: true })]);
  });
});

test('회의 페이지 · … 메뉴와 휴지통', async ({ page, go, id, dir, called }) => {
  await go(`#meeting/${id}`);
  await test.step('… 메뉴: 휴지통은 확인 창을 거침(취소하면 안 옮김)', async () => {
    await page.getByRole('button', { name: '더 보기', exact: true }).first().click();
    // 옛 메뉴에는 role=menu가 없어 같은 .menu 범위도 포함한다.
    await expect.poll(() => page.locator('[role=menu] button, .menu button').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('휴지통')]));
    await page.getByRole('button', { name: '휴지통으로 옮기기', exact: true }).click();
    await confirm(page, '취소');
    // 취소 뒤 호출이 발생하지 않는지 확인하는 관찰 시간 (옛 confirm의 400ms).
    await page.waitForTimeout(400);
    expect(await called('trashMeeting')).toHaveLength(0);
    await page.getByRole('button', { name: '더 보기', exact: true }).first().click();
    await page.getByRole('button', { name: '휴지통으로 옮기기', exact: true }).click();
    await confirm(page, '휴지통으로');
    await expect.poll(() => called('trashMeeting')).toHaveLength(1);
    expect((await called('trashMeeting'))[0][0]).toBe(dir);
  });
});

test('회의 페이지 · 다시 만들기', async ({ page, go, id, dir, called }) => {
  await go(`#meeting/${id}`);
  await test.step('다시 만들기 → "녹취부터 다시 만들기"가 회의록 만들기를 부름', async () => {
    await page.getByRole('button', { name: '다시 만들기', exact: true }).first().click();
    await expect.poll(() => page.getByRole('button').evaluateAll((buttons) => buttons
      .filter((b) => (b as HTMLElement).offsetParent && /다시 (만들기|쓰기)/.test(b.textContent ?? ''))
      .map((b) => b.textContent?.trim()))).toEqual(expect.arrayContaining([expect.stringContaining('녹취부터')]));
    await page.getByRole('button', { name: '녹취부터 다시 만들기', exact: true }).click();
    await confirmIfOpen(page);
    await expect.poll(() => called('makeMinutes')).toHaveLength(1);
    expect((await called('makeMinutes'))[0][0]).toBe(dir);
  });
});

test.describe('인터넷 연결 없음', () => {
  test.use({ stub: { STUB_MINUTES: 'offline' } });
  test('회의 페이지 · 인터넷이 끊겨 멈춘 회의', async ({ page, go, id, dir, called }) => {
    await go(`#meeting/${id}`);
    await test.step('인터넷이 끊겨 멈춘 회의: 이유 안내와 "회의록만 다시 쓰기"(저장된 녹취로)', async () => {
      await expect(page.locator('.page')).toContainText('인터넷 연결이 없어 회의록을 쓰지 못했습니다', { useInnerText: true });
      await page.getByRole('button', { name: '회의록만 다시 쓰기', exact: true }).click();
      await expect.poll(() => called('resumeMinutes')).toHaveLength(1);
      expect((await called('resumeMinutes'))[0][0]).toBe(dir);
    });
  });
});

test('회의 페이지 · 액션 할 일 체크', async ({ page, go, id, dir, called }) => {
  fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify({ actions: [
    { id: 'a1', task: 'QA 마치기', kind: 'assigned', owner: '화자 2', due: '월요일', at: '00:11', done: false },
    { id: 'a2', task: '배포 공지', kind: 'promise', owner: '화자 1', due: null, at: '00:40', done: false },
  ], advice: [] }));
  await page.evaluate((meetingId) => (window as unknown as { stubMeetingChanged: (id: string) => void }).stubMeetingChanged(meetingId), id);
  await go(`#meeting/${id}`);
  await test.step('액션 탭: 할 일 체크 → 그 할 일만 완료로 저장, 진행 수', async () => {
    await page.getByRole('tab', { name: /^액션/ }).click();
    const todo = page.getByRole('checkbox', { name: 'QA 마치기 했음', exact: true });
    await expect(page.locator('.page')).toContainText('0/2', { useInnerText: true });
    await todo.click();
    await expect(page.getByRole('tab', { selected: true })).toHaveText(/^액션/);
    await expect.poll(() => called('toggleAction')).toHaveLength(1);
    expect((await called('toggleAction'))[0].slice(1, 3)).toEqual(['a1', true]);
  });
});
