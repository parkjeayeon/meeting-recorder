import { describe, expect, it } from 'vitest';
import { flowGeometry, foldFlow, type FlowDoc } from './geometry.ts';

// 글자 폭 대신: 한 줄에 (폭/8)자
const wrap = (text: unknown, _px: number, _w: number, maxW: number, maxLines: number) => {
  const s = String(text ?? '');
  const per = Math.max(1, Math.floor(maxW / 8));
  const out: string[] = [];
  for (let i = 0; i < s.length; i += per) out.push(s.slice(i, i + per));
  return (out.length ? out : ['']).slice(0, maxLines);
};
const step = (id: string, lane?: string, over = {}) => ({ id, title: `단계 ${id}`, detail: '설명', lane, at: '00:01', ...over });
const lanes: FlowDoc['lanes'] = [{ id: 'dev', name: '개발' }, { id: 'qa', name: 'QA' }];
const f: FlowDoc = {
  id: 'f', title: '배포', lanes,
  steps: [step('1', 'dev'), step('2', 'dev'), step('3', 'qa'), step('4', 'dev')],
  edges: [{ from: '1', to: '2' }, { from: '2', to: '3' }, { from: '3', to: '4' }],
  notes: [{ step: '3', kind: 'warn', text: '늦으면 다음으로', at: '00:02' }],
  annotations: [{ from: '1', to: '2', text: '원래는 바로', at: '00:01' }, { from: '2', to: '3', text: '줄이 달라 메모로', at: '00:03' }],
};

describe('흐름도 자리', () => {
  it('띠마다 줄, 같은 띠는 오른쪽·띠를 바꾸면 같은 칸 아래, 띠 색은 화자 색 순서', () => {
    const g = flowGeometry(f, wrap);
    expect(g.steps.map((s) => [s.s.id, s.num, s.x, s.color])).toEqual([
      ['1', 1, 18 + 104, 'var(--s1)'], ['2', 2, 18 + 104 + 200, 'var(--s1)'],
      ['3', 3, 18 + 104, 'var(--s2)'], // 처음 들어가는 빈 띠는 한 칸 당긴다
      ['4', 4, 18 + 104 + 400, 'var(--s1)'],
    ]);
    expect(g.lanes.map((l) => l.name)).toEqual(['개발', 'QA']);
  });
  it('바뀐 경위: 같은 줄이면 호, 다른 줄이면 받는 단계의 메모(정보)로', () => {
    const g = flowGeometry(f, wrap);
    expect(g.arcs.map((a) => a.text)).toEqual(['원래는 바로']);
    expect(g.notes.map((n) => [n.n.kind, n.n.text, n.num])).toEqual([['warn', '늦으면 다음으로', 3], ['info', '줄이 달라 메모로', 3]]);
    expect(g.notes[1]!.y).toBe(g.notes[0]!.y + g.notes[0]!.h + 10); // 같은 칸이면 아래로 쌓는다
  });
  it('화살표: 같은 줄 오른쪽은 곧은 선, 줄이 바뀌면 사이 빈 곳에서 꺾는다', () => {
    const [a, b] = flowGeometry(f, wrap).edges;
    expect(a).toMatch(/^M\d+(\.\d+)? \d+(\.\d+)? L/);
    expect(b).toMatch(/ V\d+(\.\d+)?$/);
  });
  it('좁으면 접는다: 띠 없는 흐름은 한 줄 칸 수만, 띠 있는 흐름은 단계 순서대로 줄을 나누고 줄을 넘는 화살표를 적는다', () => {
    const wide = flowGeometry(f, wrap);
    expect(foldFlow(f, wide, 2000)).toBeNull();
    const fold = foldFlow(f, wide, 420);
    expect(fold && 'parts' in fold ? fold.parts.map((p) => [p.steps.map((s) => s.id), p.out, p.in]) : fold).toEqual([
      [['1', '2', '3'], [{ from: '3', toNum: 4 }], []],
      [['4'], [], [{ to: '4', fromNum: 3 }]],
    ]);
    const plain: FlowDoc = { ...f, lanes: [] };
    expect(foldFlow(plain, flowGeometry(plain, wrap), 420)).toEqual({ per: 2 });
  });
});
