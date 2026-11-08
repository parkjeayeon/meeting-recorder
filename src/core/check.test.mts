import { describe, expect, it } from 'vitest';
import { checkMinutes } from './check.mjs';

const transcript = [
  '[00:05] [화자 1] 다음 주 배포 일정 얘기해 볼까요?',
  '[00:20] [화자 2] 화요일 오전에 배포하는 게 좋겠어요.',
  '[00:40] [화자 1] QA는 김민준 님이 월요일까지 끝내 주세요.',
  '[05:00] [화자 2] 점심 메뉴는 국수로 하죠.',
  '[05:30] [화자 1] 네 좋습니다.',
].join('\n');
const md = (body: string) => `# 배포 일정\n\n## 요약\n배포 일정을 정함.\n\n## 논의 내용\n### 배포\n${body}\n\n## 결정 사항\n- 없음\n\n## 할 일\n- [ ] QA 마치기 — 담당: 김민준, 기한: 월요일\n`;

describe('checkMinutes', () => {
  it('근거가 있는 회의록은 걸지 않음', () => {
    expect(checkMinutes(md('- 화요일 오전에 배포하기로 하고 일정 공유함 (00:20)'), transcript, { durationSec: 400 })).toEqual([]);
  });
  it('시각 앞뒤 녹취에 관련 말이 없으면 근거 없음', () => {
    const issues = checkMinutes(md('- 화요일 오전에 배포하기로 하고 일정 공유함 (05:20)'), transcript, { durationSec: 400 });
    expect(issues.map((i) => [i.code, i.at])).toEqual([['ungrounded', '05:20']]);
  });
  it('녹음 길이를 넘는 시각', () => {
    expect(checkMinutes(md('- 배포 일정 (12:00)'), transcript, { durationSec: 400 })[0]?.code).toBe('time-range');
  });
  it('빠진 칸·녹취에 없는 담당과 기한', () => {
    const bad = '# 제목\n\n## 요약\n요약.\n\n## 할 일\n- [ ] 문서 정리 — 담당: 박서연, 기한: 금요일\n- [ ] QA — 담당: 화자 2\n';
    const codes = checkMinutes(bad, transcript).map((i) => i.code);
    expect(codes).toEqual(['section', 'section', 'owner-unknown', 'due-unknown']);
  });
  it('화자 이름으로 바꾼 담당은 녹취에 없어도 됨, 짧은 줄과 확인 필요 칸·녹음 외 메모는 보지 않음', () => {
    const m = md('- 점심 (00:20)\n- 회의 뒤 따로 정한 출시일 (녹음 외 메모)') .replace('담당: 김민준', '담당: 이도윤') + '\n## 확인 필요\n- 국수 이야기는 무슨 뜻인지 (00:20)\n';
    expect(checkMinutes(m, transcript, { durationSec: 400, names: ['이도윤'] })).toEqual([]);
  });
});
