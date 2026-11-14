import type { Page } from '@playwright/test';

// #confirm에는 accessible name이 없다. 실제 버튼 이름으로 확인 창을 좁힌다.
export async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '취소', exact: true }) });
  await dialog.getByRole('button', { name, exact: true }).click();
}

// 옛 confirm(true)는 창이 없으면 false를 반환한다. 다시 만들기는 그 반환값을 검사하지 않았다.
export async function confirmIfOpen(page: Page) {
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#confirmYes') });
  // 옛 시험은 누른 뒤 잠깐 기다렸다 창을 찾았다 — 늦게 뜨는 창을 놓치지 않게 잠깐 기다린다
  if (await dialog.waitFor({ timeout: 1000 }).then(() => true, () => false)) await dialog.locator('#confirmYes').click();
}
