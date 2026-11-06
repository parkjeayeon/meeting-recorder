import { describe, expect, it } from 'vitest';
import { cleanGuess, inlineGuesses, locateHeard, noteVariants, searchKeys, stampFor, stampFromNote, toReviewItems } from './review.mjs';

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

describe('noteVariants', () => {
  const t = '[00:01] [화자 1] 원성 님 말씀처럼\n[00:05] [화자 2] 원석입니다\n[00:09] [화자 1] 원성 님은요';
  it('메모 속 따옴표 표기 중 녹취에 있는 것만, 순서대로 한 번씩', () => {
    expect(noteVariants("화자 2의 이름이 '원성'과 '원석'으로 혼재되어 정확한 이름 확인이 필요함.", t)).toEqual(['원성', '원석']);
    expect(noteVariants('"원석"과 “원성”, ‘원석’', t)).toEqual(['원석', '원성']);
    expect(noteVariants("'원선'으로도 들림", t)).toEqual([]); // 녹취에 없음
    expect(noteVariants(null, t)).toEqual([]);
  });
});

describe('stampFor', () => {
  const t = '[00:05] [화자 1] 안녕하세요\n[03:12] [화자 2] 하윤님이 말씀하신 대로\n[04:00] [화자 1] 하윤님 또\n';
  it('메모에 시각이 없으면 녹취에서 처음 나온 줄의 시각', () => {
    expect(stampFor({ at: null, heard: null, heardNote: null, note: "'하윤님'이 대표를 가리키는지 불분명함" }, t)).toBe('03:12');
    expect(toReviewItems([{ kind: 'name', note: "'하윤님'이 대표인지 불분명" }], t, [])[0]!.at).toBe('03:12');
  });
  it('적힌 시각은 그대로, 녹취에 없으면 비움', () => {
    expect(stampFor({ at: '01:00', heard: '하윤님', heardNote: null, note: '' }, t)).toBe('01:00');
    expect(stampFor({ at: null, heard: null, heardNote: '없는말', note: '내용이 끊김' }, t)).toBeNull();
  });
});

describe('locateHeard', () => {
  const t = '[00:05] [화자 1] 하윤 님이 말씀하신 대로\n[00:09] [화자 2] 랩캐시도 쪽\n';
  it('그대로 있으면 그것, 띄어쓰기만 다르면 녹취의 글자', () => {
    expect(locateHeard('랩캐시도', t)).toBe('랩캐시도');
    expect(locateHeard('하윤님이', t)).toBe('하윤 님이');
    expect(locateHeard('랩 캐시도', t)).toBe('랩캐시도');
  });
  it('시각·화자 표시는 건너뛰고, 없거나 한 글자면 null', () => {
    expect(locateHeard('화자 1', t)).toBe('화자 1'); // 줄에 그대로 있는 글자는 그대로 (적용 쪽에서 막는 일이 아님)
    expect(locateHeard('05 화자', t)).toBeNull();
    expect(locateHeard('없는말', t)).toBeNull();
    expect(locateHeard('랩', t)).toBe('랩');
    expect(locateHeard('', t)).toBeNull();
  });
});

describe('searchKeys', () => {
  const t = '[00:05] [화자 1] 오늘은 하윤님이 오셨어요\n[02:10] [화자 2] 팀장님 말씀대로 하죠\n';
  it('메모 표기가 녹취에 그대로 없으면 괄호·띄어쓰기 조각과 님을 뗀 이름으로', () => {
    expect(searchKeys({ heard: null, heardNote: '하윤님(팀장님)', note: "'하윤님(팀장님)'이 누구인지 확인이 필요함" }, t)).toEqual(['하윤님', '하윤', '팀장님', '팀장']);
    expect(stampFor({ at: null, heard: null, heardNote: '하윤님(팀장님)', note: '' }, t)).toBe('00:05');
  });
  it('녹취에 없는 말과 화자 표시는 빼고, 고칠 말이 먼저', () => {
    expect(searchKeys({ heard: '하윤님이', heardNote: null, note: "'화자 1'과 '없는이름'" }, t)).toEqual(['하윤님이']);
  });
});

describe('stampFromNote', () => {
  const t = '[00:05] [화자 1] 오늘 매출 얘기부터\n[12:10] [화자 2] 매출은 30억 정도고 내년은\n[12:30] [화자 1] 목표 얘기는 나중에\n';
  it('메모 낱말이 가장 많이 겹치는 줄 (숫자는 무겁게)', () => {
    expect(stampFromNote('매출 30억 외에 내년 목표 매출은 말이 끊겨 확인할 수 없음.', t)).toBe('12:10');
    expect(stampFor({ at: null, heard: null, heardNote: null, note: '매출 30억 외에 내년 목표 매출은 말이 끊겨 확인할 수 없음.' }, t)).toBe('12:10');
  });
  it('겹치는 말이 적거나 애매하면 null', () => {
    expect(stampFromNote('중간 일부 내용이 유실됨', t)).toBeNull();
    expect(stampFromNote('목표 얘기', t)).toBeNull(); // 1점짜리 줄끼리라 분명하지 않음
    expect(stampFromNote(null, t)).toBeNull();
  });
  it('가까운 줄끼리는 같은 곳, 멀리 비슷한 줄이 있으면 애매', () => {
    const near = '[12:10] [화자 2] 매출은 30억 정도고\n[12:36] [화자 1] 내년 목표 매출은\n[50:00] [화자 1] 매출\n';
    expect(stampFromNote('매출 30억 외에 내년 목표 매출은 말이 끊겨 확인할 수 없음.', near)).toBe('12:10');
    const far = '[12:10] [화자 2] 매출은 30억\n[50:00] [화자 1] 매출은 30억이라니까\n';
    expect(stampFromNote('매출 30억 외에 내년 목표 매출은 말이 끊겨 확인할 수 없음.', far)).toBeNull();
  });
});
