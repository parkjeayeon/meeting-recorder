// 엔진 설치의 명령 실행 (src/setup/run.mts, 결정 70) — node -e로 출력·끝 코드를 만들어 본다
import { describe, expect, it } from 'vitest';
import { run, type Wrap } from './run.mjs';

const plain: Wrap = (cmd, args) => [cmd, args];
const node = (code: string) => [process.execPath, ['-e', code]] as const;

describe('run', () => {
  it('끝 코드 0이면 출력 끝(표준 출력·오류 섞어)으로 풀린다', async () => {
    const [cmd, args] = node("process.stdout.write('a\\n'); setTimeout(() => process.stderr.write('b\\n'), 20)");
    await expect(run(cmd, [...args], {}, plain)).resolves.toBe('a\nb\n');
  });

  it('출력 끝은 4000자까지만 남긴다', async () => {
    const [cmd, args] = node("process.stdout.write('x'.repeat(5000) + 'END')");
    const tail = await run(cmd, [...args], {}, plain);
    expect(tail).toHaveLength(4000);
    expect(tail.endsWith('END')).toBe(true);
  });

  it('끝 코드가 0이 아니면 마지막 줄로 거절한다', async () => {
    const [cmd, args] = node("console.log('first'); console.error('boom: last line'); process.exit(3)");
    await expect(run(cmd, [...args], {}, plain)).rejects.toThrow(/^boom: last line$/);
  });

  it('출력 없이 실패하면 종료 코드를 알린다', async () => {
    const [cmd, args] = node('process.exit(7)');
    await expect(run(cmd, [...args], {}, plain)).rejects.toThrow('종료 코드 7');
  });

  it('onLine에는 앞뒤 공백을 뺀 빈 줄 아닌 줄만 (\\r도 줄 나눔)', async () => {
    const lines: string[] = [];
    const [cmd, args] = node("process.stdout.write('  one  \\n\\n\\r two\\r\\n   \\nthree')");
    await run(cmd, [...args], { onLine: (l) => lines.push(l) }, plain);
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  it('env를 process.env 위에 얹어 넘긴다', async () => {
    const [cmd, args] = node("process.stdout.write(process.env.MR_SETUP_TEST + ':' + (process.env.PATH ? 'path' : ''))");
    await expect(run(cmd, [...args], { env: { MR_SETUP_TEST: 'yes' } }, plain)).resolves.toBe('yes:path');
  });

  it('sandboxed를 주면 wrap이 만든 명령으로 돌리고, 안 주면 wrap을 부르지 않는다', async () => {
    const calls: unknown[] = [];
    const wrap: Wrap = (cmd, args, opts) => {
      calls.push(opts);
      return [process.execPath, ['-e', "process.stdout.write('wrapped')"]];
    };
    const [cmd, args] = node("process.stdout.write('direct')");
    await expect(run(cmd, [...args], {}, wrap)).resolves.toBe('direct');
    expect(calls).toEqual([]);
    await expect(run(cmd, [...args], { sandboxed: { write: ['/x'], network: 'none' } }, wrap)).resolves.toBe('wrapped');
    expect(calls).toEqual([{ write: ['/x'], network: 'none' }]);
  });

  it('실행 파일이 없으면 거절한다', async () => {
    await expect(run('/nonexistent/mr-setup-test-bin', [], {}, plain)).rejects.toThrow(/ENOENT/);
  });
});
