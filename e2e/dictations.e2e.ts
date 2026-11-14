import { test, expect } from './app.ts';
import { confirm } from './feature-helpers.ts';

test.describe('받아쓰기 5개', () => {
  test.use({ stub: { STUB_DICTS: '5' } });
  test('받아쓰기 · 복사·다시 붙여넣기·지우기', async ({ page, go, called }) => {
    await go('#dictations');
    await test.step('다시 붙여넣기는 그 글을 보냄', async () => {
      await page.getByRole('button', { name: '다시 붙여넣기', exact: true }).first().click();
      await expect.poll(() => called('repaste')).toHaveLength(1);
      expect((await called('repaste'))[0][0]).toBe('받아쓴 글 0번입니다');
    });
    await test.step('삭제는 확인 창을 거쳐 지우고 목록에서 빠짐', async () => {
      await page.getByRole('button', { name: '삭제', exact: true }).first().click();
      await confirm(page, '지우기');
      await expect.poll(() => called('deleteDictation')).toHaveLength(1);
      expect((await called('deleteDictation'))[0][0]).toBe('d0000');
      await expect(page.locator('body')).not.toContainText('받아쓴 글 0번입니다', { useInnerText: true });
    });
  });
});

test.describe('받아쓰기 3개', () => {
  test.use({ stub: { STUB_DICTS: '3' } });
  test('받아쓰기 · 원문 보기', async ({ page, go }) => {
    await go('#dictations');
    // 페이지를 그린 뒤 버튼 부재를 확인한다 (라우트 변경 직후의 빈 DOM을 검사하지 않는다).
    await page.getByRole('heading', { name: /^받아쓰기/, level: 1 }).waitFor();
    await page.getByRole('button', { name: '다시 붙여넣기', exact: true }).first().waitFor();
    await test.step('다듬기로 글이 바뀌지 않은 기록에는 원문 버튼이 없음', async () => {
      await expect(page.getByLabel('원문', { exact: true })).toHaveCount(0);
    });
  });
});
