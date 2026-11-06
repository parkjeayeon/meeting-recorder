import { describe, expect, it } from 'vitest';
import { cleanGuess, inlineGuesses, toReviewItems } from './review.mjs';

const transcript = '[00:05] [화자 1] 통신 한정성이 제일 중요해요\n[12:30] [화자 2] 랩캐시도 쪽은 제가 볼게요\n';

describe('inlineGuesses', () => {
  it('본문에 괄호로 쓴 추정 줄만, 확인 필요 섹션은 빼고', () => {
    const md = '# 회의\n\n## 요약\n- 통신 한정성(안정성으로 추정)이 핵심 (00:05)\n- 배포는 화요일\n- 담당은 (이름 불분명) 미정\n\n## 확인 필요\n- "랩캐시도"(12:30): Memcached로 추정\n';
    expect(inlineGuesses(md)).toEqual(['- 통신 한정성(안정성으로 추정)이 핵심 (00:05)']);
    expect(inlineGuesses('# 회의\n\n## 요약\n- 없음\n')).toEqual([]);
  });
});

describe('cleanGuess', () => {
  it('설명을 떼고 설명뿐이면 버린다', () => {
    expect(cleanGuess("'반복문'으로 추정됨")).toBe('반복문');
    expect(cleanGuess('안정성')).toBe('안정성');
    expect(cleanGuess('멘토링 관련 직무로 추정')).toBeNull();
    expect(cleanGuess(null)).toBeNull();
    expect(cleanGuess(3)).toBeNull();
  });
});

describe('toReviewItems', () => {
  const existing = [{ id: 'r1', status: 'applied', heard: '넥스트' }, { id: 'r3', status: 'open', heard: '랩캐시도' }];

  it('번호는 이어서, 녹취에 있는 글자만 고칠 대상으로', () => {
    const items = toReviewItems([
      { kind: 'word', at: '00:05', heard: '한정성', guess: '안정성으로 추정', note: '사용자가 안정성이라고 함' },
      { kind: 'name', at: '12분쯤', heard: '없는 회사', guess: null, note: '회사 이름이 이상함' },
    ], transcript, existing, { source: 'user', request: '한정성은 안정성' });
    expect(items).toEqual([
      { id: 'r4', kind: 'word', at: '00:05', heard: '한정성', heardNote: '한정성', guess: '안정성', note: '사용자가 안정성이라고 함', status: 'open', source: 'user', request: '한정성은 안정성' },
      { id: 'r5', kind: 'name', at: null, heard: null, heardNote: '없는 회사', guess: null, note: '회사 이름이 이상함', status: 'open', source: 'user', request: '한정성은 안정성' },
    ]);
  });

  it('이미 열린 같은 말·같은 요청 안의 중복·빈 항목·이상한 값은 건너뛴다', () => {
    const items = toReviewItems([
      { heard: '랩캐시도', guess: 'Memcached', note: 'x' }, // r3이 이미 열려 있음
      { heard: '한정성', guess: '안정성', note: 'a' },
      { heard: '한정성', guess: '안정성', note: 'b' },
      { heard: '없는 말' }, // 녹취에도 없고 설명도 없음
      null, 'x', 7,
      { kind: 'weird', heard: '통신', note: '종류가 이상함' },
    ], transcript, existing);
    expect(items.map((it) => [it.id, it.heard, it.kind])).toEqual([['r4', '한정성', 'word'], ['r5', '통신', 'word']]);
  });

  it('목록이 아니면 빈 목록, 항목이 없어도 r1부터', () => {
    expect(toReviewItems(undefined, transcript, [])).toEqual([]);
    expect(toReviewItems({ items: [] }, transcript, [])).toEqual([]);
    expect(toReviewItems([{ heard: '한정성', note: 'n' }], transcript, [])[0]!.id).toBe('r1');
  });
});
