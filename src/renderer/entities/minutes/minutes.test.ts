import { describe, expect, it } from 'vitest';
import { inlinePieces, minutesBlocks, speakerOrder, termMatcher, termPieces } from './index.ts';

describe('회의록 마크다운', () => {
  const md = ['# 제목', '## 요약', '배포 일정을 정함 (00:06).', '## 논의 내용', '- 화요일 오전', '* QA 범위', '', '## 할 일', '- [ ] QA 마치기', '- [x] 공지', '## 확인 필요', '- "랩캐시도"(00:15)', '### 메모', '끝'].join('\n');
  it('제목은 빼고, 확인 필요 섹션은 건너뛰고(다음 소제목까지 — ###도 끝냄), 할 일에 번호', () => {
    expect(minutesBlocks(md)).toEqual([
      { kind: 'h3', text: '요약' }, { kind: 'p', text: '배포 일정을 정함 (00:06).' }, { kind: 'h3', text: '논의 내용' },
      { kind: 'list', items: [{ todo: false, text: '화요일 오전' }, { todo: false, text: 'QA 범위' }] },
      { kind: 'h3', text: '할 일' },
      { kind: 'list', items: [{ todo: true, checked: false, index: 0, text: 'QA 마치기' }, { todo: true, checked: true, index: 1, text: '공지' }] },
      { kind: 'h4', text: '메모' }, { kind: 'p', text: '끝' },
    ]);
  });
  it('흐름도는 요약 다음 소제목 앞에, 요약이 없으면 끝에', () => {
    expect(minutesBlocks(md, { flows: true }).map((b) => b.kind).slice(0, 4)).toEqual(['h3', 'p', 'flows', 'h3']);
    expect(minutesBlocks('## 논의\n본문', { flows: true }).at(-1)).toEqual({ kind: 'flows' });
  });
  it('한 줄: 굵게, 시각 묶음(여럿·시:분:초)과 바로 뒤 문장부호, 굵게 안의 시각은 글 그대로', () => {
    expect(inlinePieces('**배포**는 화요일 (00:06, 1:02:03). 끝 **(00:09)**')).toEqual([
      { kind: 'bold', text: '배포' }, { kind: 'text', text: '는 화요일 ' }, { kind: 'stamps', times: ['00:06', '1:02:03'], punct: '.' },
      { kind: 'text', text: ' 끝 ' }, { kind: 'bold', text: '(00:09)' },
    ]);
  });
});

describe('용어 밑줄', () => {
  const m = termMatcher([{ id: 'g1', term: 'QA' }, { id: 'g2', term: '나' }, { id: 'g3', term: 'QA 범위' }]);
  it('긴 용어 먼저, 낱말 속 글자에는 안 긋고 조사 앞은 긋는다, 한 문단에서 처음 나온 곳만', () => {
    expect(termPieces('QA 범위는 QA가 나눈 것, 나는', m).map((p) => (typeof p === 'string' ? p : `[${p.text}]`)).join('')).toBe('[QA 범위]는 [QA]가 나눈 것, [나]는');
    const seen = new Set<string>();
    termPieces('QA', m, seen);
    expect(termPieces('QA 다시', m, seen)).toEqual(['QA 다시']);
  });
  it('용어가 없으면 그대로', () => {
    expect(termMatcher([])).toBeNull();
    expect(termPieces('글', null)).toEqual(['글']);
  });
});

it('화자 색 순서는 처음 나온 순서', () => {
  expect(speakerOrder([{ who: '화자 2' }, { who: null }, { who: '화자 1' }, { who: '화자 2' }])).toEqual(['화자 2', '화자 1']);
});
