import { describe, expect, it } from 'vitest';
import { apiKey, configure, transcribeSegments, userData } from './deps.mjs';
import { makeCleanScript } from './minutes.mjs';

// 이 파일은 시험 파일마다 따로 불러오므로(vitest 기본) 아직 configure()를 부르지 않은 상태에서 시작한다
describe('deps', () => {
  it('이어지지 않은 채 쓰면 어느 것이 빠졌는지 알리며 바로 실패한다', async () => {
    expect(() => userData()).toThrow('회의 모듈에 userData이(가) 이어지지 않았습니다 (meeting.configure)');
    expect(() => transcribeSegments('a.wav', { provider: 'auto' })).toThrow(/transcribeSegments/);
    await expect(makeCleanScript('/없는/폴더')).rejects.toThrow(); // 줄에 선 일은 실패로 돌아온다
  });

  it('넘긴 것만 바꾸고, 부를 때마다 함수를 부른다', () => {
    let key = 'a';
    configure({ apiKey: () => key });
    expect(apiKey()).toBe('a');
    key = 'b';
    expect(apiKey()).toBe('b');
    configure({ userData: () => '/tmp/x' });
    expect(apiKey()).toBe('b');
    expect(userData()).toBe('/tmp/x');
  });
});
