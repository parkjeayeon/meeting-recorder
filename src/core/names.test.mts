import { describe, expect, it } from 'vitest';
import { nameSpeakers } from './names.mjs';

describe('nameSpeakers', () => {
  it('스크립트는 대괄호 안 표시만 바꾼다', () => {
    expect(nameSpeakers('[00:01] [화자 1] 화자 1 얘기', { '화자 1': '민준' })).toBe('[00:01] [민준] 화자 1 얘기');
  });
  it('글에서는 조사를 이름 받침에 맞춘다', () => {
    expect(nameSpeakers('화자 1은 화자 2가 제안했다', { '화자 1': '멘토', '화자 2': '민준' }, { prose: true })).toBe('멘토는 민준이 제안했다');
  });
  it("'화자 1'이 '화자 10'에 붙지 않는다", () => {
    expect(nameSpeakers('화자 10과 화자 1', { '화자 1': '민준' }, { prose: true })).toBe('화자 10과 민준');
  });
  it("'나'는 낱말 속('나눈', '모르거나')에서 바꾸지 않는다", () => {
    expect(nameSpeakers('나는 나눈 이야기를 모르거나', { 나: '지원' }, { prose: true })).toBe('지원은 나눈 이야기를 모르거나');
  });
  it('두 화자를 맞바꿔도 이어서 바뀌지 않는다', () => {
    expect(nameSpeakers('[화자 1] [화자 2]', { '화자 1': '화자 2', '화자 2': '화자 1' })).toBe('[화자 2] [화자 1]');
  });
  it('이름이 없으면 그대로', () => {
    expect(nameSpeakers('화자 1', undefined, { prose: true })).toBe('화자 1');
    expect(nameSpeakers(null, { '화자 1': '민준' })).toBe(null);
  });
});
