// 엔진 설치의 실행 도우미: 명령을 돌리며 진행을 줄 단위로 읽기, 파일을 진행률과 함께 내려받기 (src/setup.js에서 옮김, 결정 70)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { SandboxOptions } from '../platform/index.mjs';

export type Wrap = (cmd: string, args: string[], opts: SandboxOptions) => [string, string[]];

export interface RunOptions {
  env?: Record<string, string>;
  sandboxed?: SandboxOptions | null; // 주면 wrap으로 샌드박스에 넣어 돌린다
  onLine?: (line: string) => void; // 앞뒤 공백을 뺀 빈 줄 아닌 줄
}

// 줄 단위로 진행 상황을 읽으며 실행한다. 끝 코드 0이면 출력 끝(최대 4000자)으로 풀리고, 아니면 마지막 줄로 거절한다
export function run(cmd: string, args: string[], { env = {}, sandboxed = null, onLine = () => {} }: RunOptions, wrap: Wrap): Promise<string> {
  return new Promise((resolve, reject) => {
    const [bin, argv] = sandboxed ? wrap(cmd, args, sandboxed) : [cmd, args];
    const proc = spawn(bin, argv, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const feed = (d: Buffer) => {
      tail = (tail + d).slice(-4000);
      for (const line of d.toString().split(/[\r\n]+/)) if (line.trim()) onLine(line.trim());
    };
    proc.stdout.on('data', feed);
    proc.stderr.on('data', feed);
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve(tail) : reject(new Error(tail.trim().split('\n').pop() || `종료 코드 ${code}`))));
  });
}

// url을 dest로 내려받는다 (dest.part에 쓰고 다 받으면 이름을 바꾼다). onProgress는 0.3초에 한 번까지
export async function download(url: string, dest: string, onProgress: (received: number, total: number) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`다운로드 실패 (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(`${dest}.part`);
  let received = 0;
  let last = 0;
  // 본문이 없으면 예전 코드(for await … of null)와 같이 TypeError로 끝난다
  if (!res.body) throw new TypeError('res.body is not async iterable');
  for await (const chunk of res.body) {
    if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    received += chunk.length;
    if (Date.now() - last > 300) {
      last = Date.now();
      onProgress(received, total);
    }
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  fs.renameSync(`${dest}.part`, dest);
}
