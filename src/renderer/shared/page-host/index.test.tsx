// @vitest-environment jsdom
// 화면을 옮길 때마다 기대는 이음새(reactPage) — 옛 라우터가 기대하는 동작을 그대로 지키는지
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { reactPage } from './index.tsx';

function Counter({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (
    <div className="page">
      <b>{label}</b>
      <input aria-label="입력" />
      <button onClick={() => setN(n + 1)}>{`눌림 ${n}`}</button>
    </div>
  );
}

describe('reactPage', () => {
  it('처음 그리기는 바로 끝나고, el은 상자를 만들지 않는 껍데기', () => {
    const page = reactPage(Counter, { label: '사전' });
    expect(page.el.style.display).toBe('contents');
    expect(page.el.querySelector('.page b')?.textContent).toBe('사전');
    page.leave?.();
  });
  it('update는 같은 뿌리를 다시 그려 입력 중인 글자·상태가 남는다', () => {
    const page = reactPage(Counter, { label: '사전' });
    document.body.append(page.el);
    const input = page.el.querySelector('input')!;
    input.value = 'Whisper';
    page.el.querySelector('button')!.click();
    page.update?.();
    expect(page.el.querySelector('input')).toBe(input);
    expect(input.value).toBe('Whisper');
    page.leave?.();
    page.el.remove();
  });
  it('leave는 두 번 불러도 안전하고, 내린 뒤 update는 아무것도 그리지 않는다', () => {
    const page = reactPage(Counter, { label: '사전' });
    page.leave?.();
    expect(() => page.leave?.()).not.toThrow();
    page.update?.();
    expect(page.el.children.length).toBe(0);
  });
  it('reload는 넘겨줄 때만 있다', () => {
    let n = 0;
    expect(reactPage(Counter, { label: 'a' }).reload).toBeUndefined();
    const p = reactPage(Counter, { label: 'a' }, { reload: () => n++ });
    p.reload?.();
    p.leave?.();
    p.reload?.();
    expect(n).toBe(1);
  });
});
