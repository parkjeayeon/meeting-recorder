import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { clock, parseScript, scriptMarkdown, speakerStats } from './script.mjs';

describe('parseScript', () => {
  it('시각·화자·말을 나눈다', () => {
    expect(parseScript('[01:02] [화자 1] 안녕\n[1:00:05] 혼잣말\n머리말')).toEqual([
      { at: 62, stamp: '01:02', who: '화자 1', said: '안녕' },
      { at: 3605, stamp: '1:00:05', who: null, said: '혼잣말' },
      { at: null, stamp: '', who: null, said: '머리말' },
    ]);
  });
});

describe('speakerStats', () => {
  it('다음 줄까지 간격(최대 30초)으로 말한 시간을 어림하고 많이 말한 순서로', () => {
    const lines = parseScript('[00:00] [A] 1\n[00:10] [B] 2\n[01:00] [A] 3');
    expect(speakerStats(lines, 70)).toEqual([
      { who: 'B', sec: 30, lines: 1, first: '00:10' },
      { who: 'A', sec: 20, lines: 2, first: '00:00' },
    ]);
  });
});

it('clock', () => {
  expect(clock(65.9)).toBe('01:05');
  expect(clock(3725)).toBe('1:02:05');
});

// 복사한 정리본이 마크다운으로 맞게 읽히는지는 실제 해석기(marked, CommonMark+GFM)로 본다
describe('scriptMarkdown', () => {
  const html = (md: string) => marked.parse(md, { async: false });
  const items = (md: string) => [...html(md).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
  const unescape = (t: string) => t.replace(/<\/?strong>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

  it('한 줄에 목록 한 칸, 시각·화자는 굵게', () => {
    const md = scriptMarkdown('[00:02] [민준] 배포 얘기해요\n[00:10] [화자 2] 네\n[1:00:05] 혼잣말\n');
    expect(md).toBe('- **00:02 민준** 배포 얘기해요\n- **00:10 화자 2** 네\n- **1:00:05** 혼잣말');
    expect(items(md)).toEqual(['<strong>00:02 민준</strong> 배포 얘기해요', '<strong>00:10 화자 2</strong> 네', '<strong>1:00:05</strong> 혼잣말']);
  });

  it('빈 정리본은 빈 글', () => {
    expect(scriptMarkdown('')).toBe('');
    expect(scriptMarkdown(null)).toBe('');
    expect(scriptMarkdown('\n\n')).toBe('');
  });

  it('말 속 마크다운 글자는 글자 그대로 보인다', () => {
    const said = ['*별표* 강조 아님', '_밑줄_과 __두 개__', '`코드` 아님', '~~취소선~~ 아님', '[링크](주소) 아님', '<b>태그</b> 아님', 'A & B, &amp; 그대로', '역슬래시 \\ 하나', '표 | 칸 | 아님', '1. 번호 아님', '# 제목 아님', '> 인용 아님', '- 목록 아님'];
    const md = scriptMarkdown(said.map((s, i) => `[00:0${i % 10}] [화자 1] ${s}`).join('\n'));
    const got = items(md);
    expect(got).toHaveLength(said.length);
    got.forEach((li, i) => {
      expect(li).not.toMatch(/<(em|code|del|a|b|h\d|blockquote|ul|ol|table)\b/);
      expect(unescape(li)).toBe(`00:0${i % 10} 화자 1 ${said[i]}`);
    });
  });

  it('말 속 웹 주소는 누를 수 있는 링크가 되고 글자는 그대로', () => {
    const [li] = items(scriptMarkdown('[00:01] [화자 1] https://example.com 보세요'));
    expect(li).toContain('<a href="https://example.com">https://example.com</a>');
    expect(unescape(li!.replace(/<\/?a[^>]*>/g, ''))).toBe('00:01 화자 1 https://example.com 보세요');
  });

  it('시각 없는 줄의 줄머리 표시(# > - + 1.)도 막는다', () => {
    const lines = ['# 머리말', '> 인용', '- 목록', '+ 더하기', '3. 번호', '12) 괄호 번호', '=== 줄'];
    const got = items(scriptMarkdown(lines.join('\n')));
    expect(got).toHaveLength(lines.length);
    got.forEach((li, i) => {
      expect(li).not.toMatch(/<(h\d|blockquote|ul|ol|p)\b/);
      expect(unescape(li)).toBe(lines[i]);
    });
  });

  it('화자 이름의 마크다운 글자, 말이 빈 줄', () => {
    const md = scriptMarkdown('[00:01] [김*철_수] 안녕\n[00:02] [화자 1] ');
    expect(items(md).map(unescape)).toEqual(['00:01 김*철_수 안녕', '00:02 화자 1']);
  });

  it('아무 글자나 넣어도 줄 수만큼 목록이 나오고 글자가 사라지지 않는다', () => {
    const pool = ['가', '나', ' ', '*', '_', '`', '~', '[', ']', '(', ')', '<', '>', '&', '\\', '|', '#', '-', '+', '1', '.', '!', '=', ':', '"', "'"];
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    for (let k = 0; k < 300; k++) {
      const lines = Array.from({ length: 1 + rnd(5) }, () => {
        const said = Array.from({ length: 1 + rnd(12) }, () => pool[rnd(pool.length)]).join('').trim() || '가';
        return rnd(3) ? `[00:${String(rnd(60)).padStart(2, '0')}] [화자 ${1 + rnd(3)}] ${said}` : said.replace(/^\[/, '가[');
      });
      const parsed = parseScript(lines.join('\n'));
      const got = items(scriptMarkdown(lines.join('\n')));
      expect(got, lines.join('\n')).toHaveLength(parsed.length);
      got.forEach((li, i) => {
        const l = parsed[i]!;
        const want = [l.stamp, l.who, l.said.trim()].filter(Boolean).join(' ');
        // 해석기가 연속 공백을 하나로 보는 것만 빼고 같아야 한다
        expect(unescape(li).replace(/\s+/g, ' ').trim(), lines.join('\n')).toBe(want.replace(/\s+/g, ' ').trim());
      });
    }
  });
});
