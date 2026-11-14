import fs from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import { test, expect, type Fixtures } from './app.ts';

async function toReview({ go, id, page }: Pick<Fixtures, 'go' | 'id' | 'page'>) {
  await go(`#meeting/${id}`);
  await page.getByRole('tab', { name: /^확인 필요/ }).click();
}

type Review = { items: { id: string; status: string; cascade?: string[] }[] };
const review = (dir: string): Review => JSON.parse(fs.readFileSync(path.join(dir, 'review.json'), 'utf8'));
const statuses = (dir: string) => Object.fromEntries(review(dir).items.map((it) => [it.id, it.status]));

// 옛 코드도 value 속성이 아닌 현재 input.value로 첫 입력칸을 골랐다.
async function withValue(inputs: Locator, value: string) {
  let index = -1;
  await expect.poll(async () => {
    index = await inputs.evaluateAll((els, v) => els.findIndex((el) => (el as HTMLInputElement).value === v), value);
    return index;
  }).toBeGreaterThanOrEqual(0);
  return inputs.nth(index);
}

test('확인 필요 · 항목 종류와 모양', async ({ page, go, id }) => {
  await toReview({ page, go, id });
  await test.step('남은 항목 4개, 종류 표시(오인식·이름·근거 확인)', async () => {
    await expect.poll(() => page.getByRole('checkbox', { name: '고르기', exact: true }).evaluateAll((inputs) => {
      const tags = inputs.map((c) => c.closest('div')!.parentElement!.innerText.split('\n')[0]);
      return { count: tags.length, word: tags.some((t) => t.includes('오인식')), name: tags.some((t) => t.includes('이름')), evidence: tags.some((t) => t.includes('근거 확인')) };
    })).toEqual({ count: 4, word: true, name: true, evidence: true });
  });
  await test.step('추정이 있는 항목은 고칠 말 칸에 추정이 채워짐', async () => {
    await withValue(page.locator('input'), 'Memcached');
  });
  await test.step('녹취에 글자가 없는 이름 항목: "확인한 내용"·"녹취에 적힌 글자"·"고칠 말" 칸', async () => {
    await expect(page.getByLabel('확인한 내용', { exact: true }).first()).toBeVisible();
    await expect(page.getByLabel('녹취에 적힌 글자', { exact: true }).first()).toBeVisible();
    await expect(page.getByPlaceholder(/^고칠 말/).first()).toBeVisible();
  });
});

test('확인 필요 · 적용(추정·직접 입력)', async ({ page, go, id, dir, called }) => {
  await toReview({ page, go, id });
  await test.step('추정대로 적용 → r1을 Memcached로, Enter로 직접 입력 → r2를 수요일로', async () => {
    const guess = await withValue(page.locator('input'), 'Memcached');
    await guess.locator('..').getByRole('button').first().click();
    await expect.poll(async () => ((await called('applyReview'))[0]?.[1] as unknown[])?.[0]).toMatchObject({ id: 'r1', guess: 'Memcached' });
    const input = await withValue(page.getByPlaceholder(/^고칠 말/), '');
    await input.fill('수요일');
    await input.press('Enter');
    await expect.poll(async () => ((await called('applyReview'))[1]?.[1] as unknown[])?.[0]).toMatchObject({ id: 'r2', guess: '수요일' });
    await expect.poll(() => statuses(dir)).toMatchObject({ r1: 'applied', r2: 'applied' });
  });
  await test.step('적용하면 남은 수가 줄어듦', async () => {
    await expect(page.getByRole('tab', { selected: true })).toHaveText('확인 필요2');
  });
});

test('확인 필요 · 확인됨·그대로 두기', async ({ page, go, id, dir, called }) => {
  await toReview({ page, go, id });
  await test.step('이름 항목에 확인한 내용 → 확인됨, 근거 확인 항목 → 그대로 두기', async () => {
    await page.getByLabel('확인한 내용', { exact: true }).first().fill('외부 개발자');
    await page.getByRole('button', { name: '확인됨', exact: true }).first().click();
    await expect.poll(async () => ((await called('applyReview'))[0]?.[1] as unknown[])?.[0]).toMatchObject({ id: 'r3', resolve: '외부 개발자' });
    // 옛 고르기 input의 closest('div').parentElement와 같은 카드 범위.
    const card = page.getByRole('checkbox', { name: '고르기', exact: true }).locator('../..').filter({ hasText: '근거 확인' }).first();
    await card.getByRole('button', { name: '그대로 두기', exact: true }).click();
    await expect.poll(async () => (await called('setReviewStatus'))[0]?.slice(1, 3)).toEqual([['r4'], 'kept']);
    await expect.poll(() => statuses(dir)).toMatchObject({ r3: 'resolved', r4: 'kept' });
  });
});

test('확인 필요 · 여러 개 한꺼번에', async ({ page, go, id, called }) => {
  await toReview({ page, go, id });
  await test.step('모두 고르기 → "4개 선택", 추정대로 적용은 고칠 말이 있는 항목만(r1)', async () => {
    await page.getByRole('checkbox', { name: '모두 고르기', exact: true }).click();
    await expect(page.locator('body')).toContainText('4개 선택', { useInnerText: true });
    await expect.poll(() => page.getByRole('button').evaluateAll((buttons) => buttons.some((b) =>
      (b as HTMLElement).offsetParent && (b.textContent ?? '').trim().startsWith('추정대로 적용')))).toBe(true);
    await page.getByRole('button', { name: /^추정대로 적용/ }).first().click();
    await expect.poll(async () => ((await called('applyReview'))[0]?.[1] as { id: string }[] | undefined)?.map((f) => f.id)).toEqual(['r1']);
  });
});

test('확인 필요 · 처리함: 되돌리기·다시 열기', async ({ page, go, id, dir, called }) => {
  await toReview({ page, go, id });
  await test.step('처리함: 고친 항목 되돌리기(r5), 그대로 둔 항목 다시 열기(r6)', async () => {
    await page.getByRole('button', { name: /^처리함/ }).first().click();
    await expect(page.locator('body')).toContainText('큐에이', { useInnerText: true });
    await expect(page.locator('body')).toContainText('잠깐 끊긴 말', { useInnerText: true });
    await page.getByRole('button', { name: '되돌리기', exact: true }).first().click();
    await expect.poll(async () => (await called('revertReview'))[0]?.[1]).toBe('r5');
    await page.getByRole('button', { name: '다시 열기', exact: true }).first().click();
    await expect.poll(async () => (await called('setReviewStatus')).at(-1)?.slice(1, 3)).toEqual([['r6'], 'open']);
    await expect.poll(() => statuses(dir)).toMatchObject({ r5: 'open', r6: 'open' });
  });
});

test('확인 필요 · 같은 줄을 나중에 고친 항목이 있을 때 되돌리기', async ({ page, go, id, dir }) => {
  const rv = review(dir);
  rv.items.find((it) => it.id === 'r5')!.cascade = ['r1'];
  fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(rv));
  await toReview({ page, go, id });
  await test.step('되돌리기 알림: 같은 줄을 나중에 고친 항목은 다시 적용했다고 알림', async () => {
    await page.getByRole('button', { name: /^처리함/ }).first().click();
    await page.getByRole('button', { name: '되돌리기', exact: true }).first().click();
    await expect(page.getByRole('status').filter({ hasText: '되돌렸습니다' }).first()).toContainText('같은 줄을 나중에 고친 1개는 다시 적용했습니다');
  });
});

test('확인 필요 · 확인 마치기', async ({ page, go, id, called }) => {
  await toReview({ page, go, id });
  await test.step('남은 항목이 있으면 "남은 N개는 그대로 두고 확인 마치기", 확정 뒤 처리함은 잠김', async () => {
    const finish = page.getByRole('button', { name: /확인 마치기/ }).first();
    await expect(finish).toHaveText('남은 4개는 그대로 두고 확인 마치기');
    await finish.click();
    await expect.poll(() => called('finalizeReview')).toHaveLength(1);
    await expect(page.getByRole('status').filter({ hasText: '확정' }).first()).toBeVisible();
    await page.getByRole('button', { name: /^처리함/ }).first().click();
    await expect.poll(() => page.getByRole('button').evaluateAll((buttons) => !buttons.some((b) =>
      (b as HTMLElement).offsetParent && /되돌리기|다시 열기/.test(b.textContent ?? '')))).toBe(true);
  });
});
