import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyFileAtomic, writeFileAtomic, writeJsonAtomic } from './write.mjs';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-write-'));
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
let dir = '';
let n = 0;
beforeEach(() => {
  dir = path.join(base, String(n++));
  fs.mkdirSync(dir);
});
afterEach(() => vi.restoreAllMocks());
const leftovers = () => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

describe('writeFileAtomic', () => {
  it('새로 쓰기·덮어쓰기·바이너리, 임시 파일이 남지 않는다', () => {
    const f = path.join(dir, 'a.txt');
    writeFileAtomic(f, '처음');
    writeFileAtomic(f, '두 번째');
    expect(fs.readFileSync(f, 'utf8')).toBe('두 번째');
    const bin = path.join(dir, 'b.bin');
    writeFileAtomic(bin, new Uint8Array([0, 255, 1]));
    expect([...fs.readFileSync(bin)]).toEqual([0, 255, 1]);
    writeFileAtomic(f, '');
    expect(fs.readFileSync(f, 'utf8')).toBe('');
    expect(leftovers()).toEqual([]);
  });

  // 디스크 가득 참은 쓰기·기록·이름 바꾸기 어느 단계에서도 날 수 있다
  for (const step of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
    it(`${step} 단계에서 실패하면 원래 파일이 그대로, 임시 파일은 지운다`, () => {
      const f = path.join(dir, 'review.json');
      fs.writeFileSync(f, '{"items":[]}');
      const real = fs[step] as (...a: unknown[]) => unknown;
      vi.spyOn(fs, step).mockImplementation(((...args: unknown[]) => {
        // 이 함수가 쓰는 호출(임시 파일 대상)만 실패시킨다
        if (step === 'writeFileSync' && typeof args[0] !== 'number') return real(...args);
        throw Object.assign(new Error('디스크 가득 참 흉내'), { code: 'ENOSPC' });
      }) as never);
      expect(() => writeJsonAtomic(f, { items: [{ id: 'r1' }] })).toThrow('디스크 가득 참 흉내');
      vi.restoreAllMocks();
      expect(fs.readFileSync(f, 'utf8')).toBe('{"items":[]}');
      expect(leftovers()).toEqual([]);
    });
  }

  it('폴더가 없으면 오류 (임시 파일도 만들지 않음)', () => {
    expect(() => writeFileAtomic(path.join(dir, '없음', 'a.txt'), 'x')).toThrow(expect.objectContaining({ code: 'ENOENT' }));
  });

  it('writeJsonAtomic: 기본은 들여쓰기, 0이면 한 줄', () => {
    const f = path.join(dir, 'a.json');
    writeJsonAtomic(f, { a: [1] });
    expect(fs.readFileSync(f, 'utf8')).toBe('{\n  "a": [\n    1\n  ]\n}');
    writeJsonAtomic(f, { a: [1] }, 0);
    expect(fs.readFileSync(f, 'utf8')).toBe('{"a":[1]}');
  });

  it('copyFileAtomic: 보관본 복사', () => {
    const from = path.join(dir, 'transcript.txt');
    fs.writeFileSync(from, '[00:01] 안녕\n');
    copyFileAtomic(from, path.join(dir, 'transcript.before-review.txt'));
    expect(fs.readFileSync(path.join(dir, 'transcript.before-review.txt'), 'utf8')).toBe('[00:01] 안녕\n');
    expect(leftovers()).toEqual([]);
  });
});

// ── 실제 다른 프로세스와 함께 (앱 + mr, 강제 종료) ────────────────────
// 빌드한 lib/core/write.mjs를 앱과 같은 Electron의 Node로 돌린다
const electron = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const child = (name: string) => path.resolve('src/test/children', name);
const env = { ELECTRON_RUN_AS_NODE: '1' };
const LEN_A = 3_000_000;
const LEN_B = 2_000_000; // 길이를 다르게 해 반쯤 쓴 파일을 길이로도 알아본다

function readWhileWriting(mode: 'atomic' | 'plain') {
  const f = path.join(dir, `${mode}.txt`);
  fs.writeFileSync(f, 'a'.repeat(LEN_A));
  const reader = spawn(electron, [child('reader.mjs'), f, String(LEN_A), String(LEN_B), '2500'], { env });
  let out = '';
  reader.stdout.on('data', (d) => (out += d));
  const done = new Promise<{ reads: number; torn: number }>((resolve) => reader.on('close', () => resolve(JSON.parse(out))));
  const writer = spawnSync(electron, [child('writer.mjs'), mode, f, String(LEN_A), String(LEN_B), '150'], { env });
  expect(writer.status).toBe(0);
  return done;
}

describe.runIf(fs.existsSync(electron) && fs.existsSync('lib/core/write.mjs'))('다른 프로세스와 함께', () => {
  it('읽는 쪽(mr)은 언제나 이전 전체 또는 새 전체만 본다', async () => {
    const plain = await readWhileWriting('plain');
    const atomic = await readWhileWriting('atomic');
    console.log(`읽기 중 반쯤 쓴 파일: 덮어쓰기 ${plain.torn}/${plain.reads}번, 원자적 ${atomic.torn}/${atomic.reads}번`);
    // 예전 방식(덮어쓰기)은 1만 번에 1번꼴로 걸린다 (2026-11-05 실측). 드물어서 매번 걸린다고 기대하지는 않고 숫자만 남긴다
    expect(atomic.reads).toBeGreaterThan(50);
    expect(atomic.torn).toBe(0);
  }, 20000);

  async function killDuringWrites(mode: 'atomic' | 'plain', trials: number) {
    let broken = 0;
    for (let i = 0; i < trials; i++) {
      const f = path.join(dir, `${mode}-${i}.txt`);
      fs.writeFileSync(f, 'a'.repeat(LEN_A));
      const w = spawn(electron, [child('writer.mjs'), mode, f, String(LEN_A), String(LEN_B)], { env });
      await new Promise<void>((resolve) => w.stdout.once('data', () => resolve()));
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60)); // 쓰는 도중 아무 때나
      const closed = new Promise((r) => w.on('close', r));
      w.kill('SIGKILL');
      await closed;
      const text = fs.readFileSync(f, 'utf8');
      const whole = (text.length === LEN_A && /^a+$/.test(text)) || (text.length === LEN_B && /^b+$/.test(text));
      if (!whole) broken++;
    }
    return broken;
  }

  it('쓰는 도중 강제 종료(SIGKILL)해도 파일은 이전 전체 또는 새 전체', async () => {
    const plain = await killDuringWrites('plain', 15);
    const atomic = await killDuringWrites('atomic', 40);
    console.log(`강제 종료 뒤 깨진 파일: 덮어쓰기 ${plain}/15, 원자적 ${atomic}/40`);
    // 예전 방식은 15번에 0~2번 깨졌다 (실측, 강제 종료는 쓰기 시스템 호출 한가운데를 끊지 못해 드물다). 숫자만 남긴다
    expect(atomic).toBe(0);
  }, 60000);
});
