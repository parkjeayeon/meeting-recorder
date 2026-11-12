import { describe, expect, it } from 'vitest';
import { markParts } from './marks.ts';

describe('교정 부호', () => {
  it('고친 게 없으면 글 하나', () => {
    expect(markParts('그대로입니다', '그대로입니다')).toEqual({ text: '그대로입니다', heavy: false });
    expect(markParts('다듬기 전', undefined)).toEqual({ text: '다듬기 전', heavy: false });
  });
  it('조금 고쳤으면 지운 말·넣은 말 조각, 문장 부호 앞에는 빈칸 없음', () => {
    const m = markParts('음 다음 주에 배포 일정 잡아 주세요', '다음 주에 배포 일정을 잡아 주세요.');
    expect(m.parts?.map((p) => `${p.space ? ' ' : ''}[${p.op}]${p.words}`).join('')).toBe('[del]음 [eq]다음 주에 배포 [del]일정 [ins]일정을 [eq]잡아 주세요[ins].');
  });
  it('넣은 말이 40%를 넘으면 다듬은 글만 (많이 고침)', () => {
    expect(markParts('배포 그거', '배포 일정은 화요일 오전으로 정하고, QA는 월요일까지 마칩니다.')).toEqual({ text: '배포 일정은 화요일 오전으로 정하고, QA는 월요일까지 마칩니다.', heavy: true });
  });
});
