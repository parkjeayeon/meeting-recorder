import fs from 'node:fs';
import path from 'node:path';
import { uiTest as test, expect, calls, openTab } from './fixture.ts';

test('액션 찾기 · 탭 이동 중 중복 실행 방지', async ({ page, go, id, dir }) => {
  fs.writeFileSync(path.join(dir, 'actions.json'), JSON.stringify({ kind: 'work', adviceTitle: '알아 둘 것', actions: [{ id: 'a1', owner: '화자 2', task: 'QA 마치기', due: null, kind: 'assigned', at: '00:06', quote: 'x', done: false }], advice: [] }));
  await go(`#meeting/${id}`);
  await openTab(page, '액션');
  const again = page.locator('.acts .tab-bar').getByRole('button', { name: /찾/ });
  await again.click();
  await test.step('진행 중 표시 유지 (탭 옮긴 뒤)', async () => {
    await openTab(page, '회의록');
    await openTab(page, '액션');
    await expect(again).toHaveClass(/\bbusy\b/);
    await expect(again).toBeDisabled();
  });
  await test.step('같은 작업 한 번만', async () => {
    // 옛 시험처럼 disabled 버튼에 DOM click을 시도한다. Playwright click은 활성화를 기다리므로 쓰지 않는다.
    await again.evaluate((button) => (button as HTMLButtonElement).click());
    await page.waitForTimeout(3200); // '두 번 불리지 않음'을 보는 곳 — 옛 시험처럼 가짜 작업(2.5초)이 끝날 때까지 기다린 뒤 센다
    expect((await calls(page)).makeActions).toBe(1);
  });
});

test('회의 본문 · 오류 알림과 복사', async ({ page, go, id }) => {
  await go(`#meeting/${id}`);
  await test.step('오류 알림 글자', async () => {
    await openTab(page, '확인 필요');
    await page.getByRole('button', { name: /^처리함/ }).click();
    await page.locator('.ritem-done').getByRole('button', { name: /되돌리기/ }).click();
    const toast = page.locator('#toasts .toast.bad');
    await expect(toast).toBeVisible();
    await expect.poll(() => toast.evaluate((t) => {
      const b = t.querySelector('b');
      return Boolean(b && t.textContent && getComputedStyle(b).color !== getComputedStyle(t).backgroundColor);
    })).toBe(true);
  });
  await test.step('정리본 복사 (마크다운)', async () => {
    await openTab(page, '정리본');
    const copy = page.getByRole('button', { name: '정리본 복사', exact: true });
    await expect(copy).toBeVisible();
    await copy.click();
    await expect.poll(async () => (await calls(page)).copied).toBe('- **00:02 화자 1** 다음 주 배포 일정 얘기해 볼까요?\n- **00:06 화자 2** 네, 화요일 오전이 좋을 것 같아요.\n- **00:15 화자 2** 랩캐시도 쪽 확인만 하면 됩니다.');
  });
  await test.step('회의록 복사', async () => {
    await page.getByRole('button', { name: /회의록 복사/ }).click();
    await expect.poll(async () => (await calls(page)).copied).toMatch(/^# 예시 회의/);
  });
});

test('확인 필요 · 본문 선택으로 직접 추가', async ({ page, go, id }) => {
  await go(`#meeting/${id}`);
  await openTab(page, '회의록');
  const input = page.getByPlaceholder('놓친 게 있나요?', { exact: false });
  await test.step('고른 말을 확인 필요에 추가', async () => {
    await expect(page.locator('.doc')).toContainText('일정');
    await page.locator('.doc').evaluate((doc) => {
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode()) && !node.textContent?.includes('일정')) { /* 찾을 본문 */ }
      if (!node) throw new Error('회의록에서 일정이라는 말을 찾지 못했습니다');
      const start = node.textContent!.indexOf('일정');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 2);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      node.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const add = page.getByRole('button', { name: /확인 필요에 추가/ });
    await expect(add).toBeVisible();
    await add.click();
    await expect(input).toHaveValue('"일정" ');
  });
  await test.step('확인 필요 직접 추가 보내기', async () => {
    const before = await page.locator('.ritem').count();
    await input.fill('"일정"은 일정표야');
    await page.locator('.review-add').getByRole('button').first().click();
    await expect.poll(async () => (await calls(page)).addReview).toBe('"일정"은 일정표야');
    await expect(page.locator('.ritem')).toHaveCount(before + 1);
    await expect(input).toHaveValue('');
  });
});

test('확인 필요 · 채팅 제안과 확인됨', async ({ page, go, id }) => {
  await go(`#meeting/${id}`);
  await openTab(page, '확인 필요');
  const chat = page.locator('.chat');
  await test.step('채팅 제안: 녹취에서 못 찾아도 적용 버튼', async () => {
    await page.locator('.ritem.open').getByRole('button', { name: /채팅/ }).first().click();
    await chat.getByRole('textbox').fill('띄어쓰기가 달라요');
    await chat.getByRole('textbox').press('Enter');
    const proposal = page.locator('.proposal.unmatched');
    await expect(proposal).toBeVisible();
    await expect(proposal.getByRole('textbox', { name: '고칠 대상' })).toHaveValue('랩 캐시 도');
    await expect(proposal.locator('.hint')).toContainText('그대로 찾지 못했습니다');
    await proposal.getByRole('textbox', { name: '고칠 대상' }).fill('랩캐시도');
    await proposal.getByRole('button', { name: '적용', exact: true }).click();
    await expect.poll(async () => (await calls(page)).applyReview?.at(-1)?.[0]).toMatchObject({ heard: '랩캐시도', guess: 'Memcached' });
    await chat.getByRole('button', { name: '닫기', exact: true }).click();
  });
  await test.step('채팅: 확인됨으로 처리', async () => {
    const card = page.locator('.ritem.open').filter({ hasText: '도윤님(선배님)' });
    await expect(card.getByRole('textbox', { name: '확인한 내용', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: /확인됨/ })).toBeVisible();
    await expect(card.locator('.ritem-pair input')).toHaveCount(2);
    await card.getByRole('button', { name: /채팅/ }).click();
    await chat.getByRole('textbox').fill('외부 개발자야 그냥 그 이름으로 둬');
    await chat.getByRole('textbox').press('Enter');
    const resolve = chat.getByRole('button', { name: '확인됨으로', exact: true });
    await expect(resolve).toBeVisible();
    await resolve.click();
    await expect.poll(async () => (await calls(page)).applyReview?.at(-1)?.[0]?.resolve).toBe('외부 개발자, 이름은 그대로');
    await expect(chat.locator('.proposal .proposal-state')).toContainText('확인됨');
    await chat.getByRole('button', { name: '닫기', exact: true }).click();
  });
  await test.step('처리함에 확인됨과 내용', async () => {
    await page.getByRole('button', { name: /^처리함/ }).click();
    const done = page.locator('.ritem-done').filter({ hasText: '확인됨' });
    await expect(done).toContainText('외부 개발자');
    await expect(done).toContainText('다시 열기');
  });
});

test('확인 필요 · 유실 구간', async ({ page, go, id }) => {
  await go(`#meeting/${id}`);
  await openTab(page, '확인 필요');
  await test.step('유실 구간 직접 고르기', async () => {
    const lost = page.locator('.ritem.open').filter({ hasText: '중간에 말이 끊겨' });
    await lost.getByRole('button', { name: /구간 다시 받아쓰기/ }).click();
    const start = lost.getByRole('textbox', { name: '시작 시각' });
    await expect(start).toBeVisible();
    await start.fill('00:02');
    await lost.getByRole('button', { name: '다시 받아쓰기', exact: true }).click();
    await expect.poll(async () => (await calls(page)).redoRange?.at(-1)).toMatchObject({ id: 'r4', start: 2, end: 62 });
  });
});

test('회의록 · 흐름도 내보내기와 할 일 모양', async ({ page, go, id, dir }) => {
  await test.step('흐름도 SVG 저장', async () => {
    fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify({ flows: [{
      id: 'f1', title: '배포 절차', summary: 'QA 뒤 배포', lanes: [],
      steps: [{ id: 's1', title: 'QA', detail: '결제만 확인', at: '00:02', quote: '배포 일정' }, { id: 's2', title: '배포', detail: '화요일 오전', at: '00:06', quote: '화요일 오전' }],
      edges: [{ from: 's1', to: 's2' }], notes: [], annotations: [],
    }], handoff: null }));
    await go(`#meeting/${id}`);
    await page.locator('.flow-acts').getByRole('button', { name: /SVG/ }).click();
    await expect.poll(async () => (await calls(page)).saveSvg).toBeTruthy();
    const saved = (await calls(page)).saveSvg!;
    // SVG 자체는 DOMParser로 검사하고 스타일·XML 조건도 옛 검사와 똑같이 유지한다.
    const svgOut = await page.locator('.flow-acts').evaluate((_element, c) => {
      const d = new DOMParser().parseFromString(c.svg, 'image/svg+xml');
      return { name: c.name, xml: c.svg.startsWith('<?xml'), ns: d.documentElement.namespaceURI,
        svgs: d.querySelectorAll('svg').length, cls: c.svg.includes('class='), vars: c.svg.includes('var(--'),
        bg: d.documentElement.firstElementChild?.tagName, fill: /fill:\s*rgb/.test(c.svg),
        title: c.svg.includes('결제만 확인'), err: Boolean(d.querySelector('parsererror')) };
    }, saved);
    expect(svgOut).toEqual({ name: '배포 절차', xml: true, ns: 'http://www.w3.org/2000/svg', svgs: 1,
      cls: false, vars: false, bg: 'rect', fill: true, title: true, err: false });
    fs.rmSync(path.join(dir, 'flow.json'), { force: true });
    await page.evaluate((meetingId) => (window as unknown as { stubMeetingChanged: (id: string) => void }).stubMeetingChanged(meetingId), id);
  });
  await test.step('회의록 할 일 줄', async () => {
    await page.evaluate((h) => { location.hash = h; }, `#meeting/${id}`); // 옛 시험처럼 탭을 누르지 않고 흐름도를 지운 뒤 다시 그린 화면을 본다
    const todo = page.locator('.doc li.todo');
    await expect(todo).toBeVisible();
    await expect.poll(() => todo.evaluate((li) => {
      const cs = getComputedStyle(li);
      const [a, b] = [li.querySelector('input')!, li.querySelector('span')!].map((e) => e.getBoundingClientRect());
      return { dir: cs.flexDirection, border: cs.borderTopWidth, sameLine: Math.abs(a.top - b.top) < 12 };
    })).toEqual({ dir: 'row', border: '0px', sameLine: true });
  });
});

test('녹음 · 압축 안내와 메뉴', async ({ page, go }) => {
  await go('#meetings');
  await page.getByRole('link').filter({ hasText: '주간 회의 1차' }).click();
  await test.step('녹음 압축 안내', async () => {
    const note = page.getByRole('region', { name: '녹음 압축' });
    await expect(note).toContainText('689MB → 약 86MB');
    await expect(note).toContainText('96kbps');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await note.getByRole('button', { name: '그대로 두기', exact: true }).click();
    await expect.poll(async () => (await calls(page)).decline).toHaveLength(1);
    await expect(note).toHaveCount(0);
    await page.locator('.meet-acts').getByRole('button', { name: '더 보기', exact: true }).click();
    const compress = page.getByRole('button', { name: /^녹음 압축하기/ });
    await expect(compress).toContainText('689MB → 약 86MB');
    await compress.click();
    await expect.poll(async () => (await calls(page)).compress).toHaveLength(1);
    await expect(page.locator('.meet-meta .tag').filter({ hasText: /^녹음/ })).toHaveText('녹음 86MB · 압축함');
    await expect(note).toHaveCount(0);
    const toast = page.locator('#toasts .toast').filter({ hasText: '압축했습니다' });
    await expect(toast).toContainText('689MB → 86MB');
  });
});
