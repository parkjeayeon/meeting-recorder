import { describe, expect, it } from 'vitest';
import { flowOrder, placeLanes, wrapLines } from './layout.ts';

describe('흐름도 배치', () => {
  it('들어오는 화살표가 없는 단계부터 화살표 순서대로, 떨어진 단계는 원래 순서로 뒤에', () => {
    const f = { steps: [{ id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'z' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'z', to: 'z' }] };
    expect(flowOrder(f).map((s) => s.id)).toEqual(['a', 'b', 'c', 'z']);
  });
  it('같은 띠는 오른쪽으로, 띠를 바꾸면 같은 칸, 처음 들어가는 빈 띠는 한 칸 당김', () => {
    const lanes = new Map<string | null | undefined, number>([['dev', 0], ['qa', 1]]);
    const pos = placeLanes([{ id: '1', lane: 'dev' }, { id: '2', lane: 'dev' }, { id: '3', lane: 'qa' }, { id: '4', lane: 'dev' }], lanes);
    expect([...pos.values()]).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 0, col: 2 }]);
  });
  it('줄 나누기: 낱말 단위, 긴 낱말은 글자 단위, 넘치면 말줄임', () => {
    const fits = (t: string) => t.length <= 6;
    expect(wrapLines('배포 일정 정하기', fits, 3)).toEqual(['배포 일정', '정하기']);
    expect(wrapLines('가나다라마바사아', fits, 3)).toEqual(['가나다라마바', '사아']);
    expect(wrapLines('하나 둘 셋 넷 다섯 여섯', fits, 2)).toEqual(['하나 둘 셋', '넷 다섯…']);
  });
});
