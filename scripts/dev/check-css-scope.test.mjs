// scripts/dev/check-css-scope.js — 화면 스타일 @scope 나눔 검사
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const { check, rulesOf, sharedOf } = createRequire(import.meta.url)('./check-css-scope.js');

describe('check-css-scope', () => {
  it('화면 @scope 안에서만 쓰는 클래스는 통과', () => {
    const css = `
      .btn { height: 32px; }
      @scope (.page.home) { .todo-row { display: grid; } .todo-row > svg { width: 15px; } }
      @scope (#meeting-tabpanel) { .doc li.todo { list-style: none; } }`;
    expect(check(css)).toEqual([]);
  });

  it('@scope 안에서 만든 클래스가 밖에도 나오면 걸린다 (밖의 @media 안도)', () => {
    expect(check('@scope (#meeting-tabpanel) { .doc li.todo { list-style: none; } } .todo { color: red; }')).toEqual([
      expect.stringContaining('.todo: @scope (#meeting-tabpanel) 줄 1에서 만든 클래스가 밖(전역) 줄 1에도'),
    ]);
    expect(check('@scope (.player) {\n  .ptime { min-width: 120px; }\n}\n@media (max-width: 1100px) {\n  .ptime { min-width: 0; }\n}')).toEqual([
      expect.stringContaining('밖(전역) 줄 5'),
    ]);
  });

  it('서로 다른 뿌리의 @scope 두 곳에서 같은 클래스를 만들면 걸린다', () => {
    const p = check('@scope (.page.home) { .todo { color: red; } } @scope (.chat) { .todo { color: blue; } }');
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('서로 다른 @scope');
  });

  it('공유 클래스 주석에 적은 이름은 통과', () => {
    const css = `/* check-css-scope 공유 클래스 (설명):
       num btn — 공용 부품
    */
    .num { font-family: monospace; }
    @scope (.page.home) { .store .num { font-size: 13px; } }
    @scope (.chat) { .proposal .btn { margin-left: auto; } .redo-line .num { font-size: 11px; } }`;
    expect([...sharedOf(css)]).toEqual(['num', 'btn']);
    expect(check(css)).toEqual([]);
  });

  it('@scope 안에서 뿌리 자신을 쓰면 걸린다 (아무 데도 맞지 않는다)', () => {
    const p = check('@scope (.page.home) { .page.home .num { color: red; } }');
    expect(p[0]).toContain('뿌리 자신을 씀');
  });

  it('주석·문자열·@keyframes 안의 괄호와 클래스는 읽지 않는다', () => {
    const rules = rulesOf(`/* .x { } */ .a::before { content: '{ .y }'; } @keyframes k { from { opacity: 0; } }
      @scope (.r) { @media (max-width: 9px) { .b { c: d; } } }`);
    expect(rules.map((r) => [r.selectors, r.scope])).toEqual([[['.a::before'], null], [['.b'], '.r']]);
  });
});
