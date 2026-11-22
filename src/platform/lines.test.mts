// 도우미 출력 줄 나누기와 한 줄씩 말하는 도우미 띄우기 (src/platform/lines.mts, 결정 78)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { splitLines, startLineHelper } from './lines.mjs';

const feed = (chunks: (string | Buffer)[]) => {
  const lines: string[] = [];
  const push = splitLines((l) => lines.push(l));
  for (const c of chunks) push(c);
  return lines;
};

describe('splitLines (예전 main.js startFnListener의 줄 나누기)', () => {
  it('한 조각에 여러 줄', () => {
    expect(feed(['ready\ndown\nup\n'])).toEqual(['ready', 'down', 'up']);
  });

  it('줄이 조각 사이에서 끊겨도 이어 붙인다', () => {
    expect(feed(['do', 'wn\nu', 'p', '\n'])).toEqual(['down', 'up']);
  });

  it('줄바꿈이 오지 않은 끝 조각은 넘기지 않고 기다린다', () => {
    expect(feed(['down\nchor'])).toEqual(['down']);
    expect(feed(['down\nchor', 'd\n'])).toEqual(['down', 'chord']);
  });

  it('앞뒤 공백·\\r은 뺀다, 빈 줄도 빈 문자열로 넘긴다', () => {
    expect(feed(['  ready \r\n\nerror:permission\n'])).toEqual(['ready', '', 'error:permission']);
  });

  it('Buffer 조각도 받는다 (stdout data)', () => {
    expect(feed([Buffer.from('dow'), Buffer.from('n\n')])).toEqual(['down']);
  });

  it('조각마다 따로 상태를 가진다', () => {
    const a: string[] = [];
    const b: string[] = [];
    const pa = splitLines((l) => a.push(l));
    const pb = splitLines((l) => b.push(l));
    pa('do');
    pb('up\n');
    pa('wn\n');
    expect([a, b]).toEqual([['down'], ['up']]);
  });
});

// 실제로 띄워 본다: 가짜 도우미(셸 스크립트)가 줄을 나눠 쓰고 끝 코드 2로 끝난다
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-platform-lines-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.runIf(process.platform !== 'win32')('startLineHelper', () => {
  it('표준 출력을 줄마다, 끝나면 끝 코드를', async () => {
    const bin = path.join(tmp, 'fake-listener');
    fs.writeFileSync(bin, '#!/bin/sh\nprintf "ready\\ndo"\nsleep 0.05\nprintf "wn\\nup\\ntail"\nexit 2\n', { mode: 0o755 });
    const lines: string[] = [];
    const code = await new Promise<number | null>((resolve) => startLineHelper(bin, { line: (l) => lines.push(l), exit: resolve }));
    expect(code).toBe(2);
    expect(lines).toEqual(['ready', 'down', 'up']); // 줄바꿈 없는 끝 'tail'은 넘기지 않는다 (예전과 같다)
  });

  it('띄우지 못하면(없음·실행할 수 없음) 죽지 않고 끝 코드 없이(null) 한 번만 끝났다고 알린다', async () => {
    const notExec = path.join(tmp, 'not-executable');
    fs.writeFileSync(notExec, '#!/bin/sh\necho ready\n', { mode: 0o644 });
    for (const bin of [path.join(tmp, 'no-such-listener'), notExec]) {
      const codes: (number | null)[] = [];
      await new Promise<void>((resolve) => {
        startLineHelper(bin, { line: () => {}, exit: (code) => (codes.push(code), resolve()) });
      });
      await new Promise((r) => setTimeout(r, 100)); // 'exit'가 뒤늦게 와도 두 번 부르지 않는다
      expect(codes, bin).toEqual([null]);
    }
  });

  it('kill()로 끝낼 수 있다', async () => {
    const bin = path.join(tmp, 'fake-long');
    fs.writeFileSync(bin, '#!/bin/sh\necho ready\nexec sleep 30\n', { mode: 0o755 });
    const got = await new Promise<{ code: number | null; lines: string[] }>((resolve) => {
      const lines: string[] = [];
      const h = startLineHelper(bin, {
        line: (l) => {
          lines.push(l);
          h.kill();
        },
        exit: (code) => resolve({ code, lines }),
      });
    });
    expect(got.lines).toEqual(['ready']);
    expect(got.code).toBeNull(); // 신호로 끝나면 끝 코드는 null
  });
});
