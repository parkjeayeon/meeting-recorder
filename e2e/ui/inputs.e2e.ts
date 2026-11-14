import { uiTest as test, expect, checkKeys, openTab } from './fixture.ts';

test('입력칸 · 실제 영어와 Backspace', async ({ page, go, id }) => {
  await test.step('회의 목록 검색', async () => {
    await go('#meetings');
    await checkKeys(page.getByPlaceholder('제목, 요약 검색'));
  });
  await test.step('사전 단어 추가', async () => {
    await go('#dictionary');
    await checkKeys(page.getByPlaceholder('단어나 이름 (예: PJY, Whisper, 김신우)'));
  });
  await test.step('명령 팔레트(⌘K)', async () => {
    await go('#home');
    await page.locator('#openPalette').click();
    await checkKeys(page.getByPlaceholder('회의 제목, 받아쓴 말, 화면, 동작 검색'));
  });
  await test.step('가져오기 메모', async () => {
    await page.locator('#palette').evaluate((d: HTMLDialogElement) => d.close()); // 옛 시험처럼 창을 바로 닫는다
    await go('#meetings');
    await page.getByRole('button', { name: /파일 가져오기/ }).click();
    await checkKeys(page.getByPlaceholder('예: 녹음을 끝낸 뒤 배포일을 목요일로 바꾸기로 함. 디자인 검토는 화자 2가 맡음.'));
  });
  await test.step('흐름도 그릴 흐름', async () => {
    await page.locator('#importSheet').evaluate((d: HTMLDialogElement) => d.close()); // 옛 시험처럼 창을 바로 닫는다(닫기 버튼이 둘)
    await go(`#meeting/${id}`);
    await checkKeys(page.getByRole('textbox', { name: '그릴 흐름', exact: true }));
  });
  await test.step('본문 찾기(⌘F)', async () => {
    await page.keyboard.press('Meta+f');
    await checkKeys(page.getByRole('searchbox', { name: '이 탭 본문에서 찾기' }));
  });
  await test.step('확인 필요 고칠 말', async () => {
    await page.getByRole('searchbox', { name: '이 탭 본문에서 찾기' }).press('Escape');
    await openTab(page, '확인 필요');
    await checkKeys(page.getByPlaceholder('고칠 말 (기억나는 대로)'));
  });
  await test.step('확인 필요 채팅', async () => {
    await page.locator('.ritem').getByRole('button', { name: /채팅/ }).first().click();
    await checkKeys(page.getByPlaceholder('예: 화자 1 이름은 김민준이에요 / 그 부분은 기억 안 나요'));
  });
  await test.step('확인 필요 직접 추가', async () => {
    // 채팅이 열린 채 '남은 것'이 가려져 있다 — 옛 시험처럼 요소를 바로 누른다
    await page.getByRole('button', { name: /^남은 것/ }).evaluate((b: HTMLElement) => b.click());
    await checkKeys(page.locator('.review-add textarea'));
  });
  await test.step('처리함 고치기', async () => {
    await page.locator('.chat-head').getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: /^처리함/ }).click();
    await page.locator('.ritem-done').getByRole('button', { name: /고치기/ }).click();
    const input = page.locator('.ritem-done').getByRole('textbox', { name: '고칠 말', exact: true });
    await checkKeys(input);
  });
});
