import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteOptions } from '../llm/call.mjs';
import { fakeDeps, readJson, sleep, tmpDir } from '../test/meeting.mjs';
import { canResume, cleanScript, MINUTES_MAX_CHARS, minutesSystem, minutesTarget, readStatus, renameSpeaker, SCRIPT_CHUNK_CHARS, writeStatus } from './minutes.mjs';

let root = '';
beforeEach(() => {
  root = tmpDir('mr-minutes-');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const settings = { provider: 'codex' as const };
const stamp = (sec: number) => `[${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}]`;
// 화자가 번갈아 말하는 녹취: blocks = [화자, 줄 수], 줄마다 약 100자
const script = (blocks: [string, number][]): string[] => {
  const out: string[] = [];
  let t = 0;
  for (const [who, n] of blocks) for (let i = 0; i < n; i++) out.push(`${stamp(t++)} [${who}] ${'말'.repeat(80)} ${t}`);
  return out;
};
const inputLines = (o: CompleteOptions) => o.input.replace(/^<script>\n|\n<\/script>$/g, '').split('\n');
const speakerOf = (l: string) => /^\[[\d:]+\] (\[[^\]]+\])?/.exec(l)?.[1];

describe('cleanScript', () => {
  it('2500자쯤에서, 화자가 바뀌는 곳에서 조각을 나눈다', async () => {
    const lines = script([['화자 1', 26], ['화자 2', 26], ['화자 1', 26]]); // 한 덩어리 약 2600자
    const f = fakeDeps(root, { complete: async (o) => ({ text: o.input.replace(/^<script>\n|\n<\/script>$/g, ''), provider: 'codex' }) });
    const r = await cleanScript(lines.join('\n'), settings);
    expect(r).toMatchObject({ chunks: 3, failed: 0, provider: 'codex' });
    expect(r.text).toBe(lines.join('\n'));
    const chunks = f.llm.map(inputLines);
    expect(chunks.map((c) => c.length)).toEqual([26, 26, 26]);
    for (const c of chunks) expect(new Set(c.map(speakerOf)).size).toBe(1);
    expect(f.llm[0]).toMatchObject({ choice: 'codex', apiKey: 'fake-key', effort: 'low', maxTokens: 16000 });
    expect(f.llm[0]!.system.startsWith('You prune a timestamped Korean conversation script made by speech recognition')).toBe(true);
  });

  it('같은 사람이 너무 길게 말하면(5000자 넘게) 화자가 안 바뀌어도 자른다', async () => {
    const lines = script([['화자 1', 80]]);
    const f = fakeDeps(root, { complete: async (o) => ({ text: o.input.replace(/^<script>\n|\n<\/script>$/g, ''), provider: 'codex' }) });
    const r = await cleanScript(lines.join('\n'), settings);
    const sizes = f.llm.map((o) => inputLines(o).join('\n').length);
    expect(r.chunks).toBe(f.llm.length);
    expect(r.chunks).toBeGreaterThan(1);
    for (const s of sizes) expect(s).toBeLessThanOrEqual(SCRIPT_CHUNK_CHARS * 2 + 200);
  });

  it('동시에 넷까지만 부른다', async () => {
    const blocks: [string, number][] = Array.from({ length: 10 }, (_, i) => [`화자 ${(i % 2) + 1}`, 30]);
    let inFlight = 0;
    let most = 0;
    fakeDeps(root, {
      complete: async (o) => {
        most = Math.max(most, ++inFlight);
        await sleep(3);
        inFlight--;
        return { text: o.input.replace(/^<script>\n|\n<\/script>$/g, ''), provider: 'codex' };
      },
    });
    const r = await cleanScript(script(blocks).join('\n'), settings);
    expect(r.chunks).toBe(10);
    expect(most).toBe(4);
  });

  it('형식이 깨진 조각(없던 시각·늘어난 줄)이나 실패한 호출은 원래 줄을 쓰고 failed로 센다', async () => {
    const lines = script([['화자 1', 26], ['화자 2', 26], ['화자 1', 26], ['화자 2', 26]]);
    let n = 0;
    fakeDeps(root, {
      complete: async (o) => {
        const mine = inputLines(o);
        const k = n++;
        if (k === 0) return { text: `[59:59] [화자 1] 없던 시각\n${mine.slice(1).join('\n')}`, provider: 'api' };
        if (k === 1) return { text: [...mine, mine[0]].join('\n'), provider: 'api' };
        if (k === 2) throw new Error('끊김');
        return { text: mine.slice(0, 2).map((l) => `  ${l}  `).join('\n\n'), provider: 'claude-code' }; // 줄 앞뒤 빈칸·빈 줄은 무시
      },
    });
    const r = await cleanScript(lines.join('\n'), settings);
    expect(r.failed).toBe(3);
    expect(r.provider).toBe('claude-code');
    expect(r.text).toBe([...lines.slice(0, 78), ...lines.slice(78, 80)].join('\n'));
  });

  it('빈 녹취는 부르지 않는다', async () => {
    const f = fakeDeps(root, {});
    expect(await cleanScript('', settings)).toEqual({ text: '', provider: null, chunks: 0, failed: 0 });
    expect(f.llm).toEqual([]);
  });
});

describe('minutesTarget · minutesSystem', () => {
  it('짧은 회의는 2000자, 정리본 5천 자를 넘는 만큼의 10%씩 늘고 10000자에서 멈춘다', () => {
    expect(minutesTarget('가'.repeat(3000), { cleaned: true })).toEqual({ clean: 3000, target: 2000 });
    expect(minutesTarget('가'.repeat(30000), { cleaned: true })).toEqual({ clean: 30000, target: 4500 });
    expect(minutesTarget('가'.repeat(200000), { cleaned: true })).toEqual({ clean: 200000, target: MINUTES_MAX_CHARS });
  });
  it('정리본이 없으면(원본 녹취) 60%로 어림한다', () => {
    expect(minutesTarget('가'.repeat(3000))).toEqual({ clean: 1800, target: 2000 });
    expect(minutesTarget('가'.repeat(50000))).toEqual({ clean: 30000, target: 4500 });
    expect(minutesTarget('가'.repeat(1001), { cleaned: false }).clean).toBe(601);
  });
  it('프롬프트 끝의 분량 줄만 바뀐다', () => {
    const s = minutesSystem('가'.repeat(50000));
    expect(s.startsWith('You write meeting minutes in Korean from a speech-recognition script of a meeting')).toBe(true);
    expect(s).not.toContain('{{LENGTH}}');
    expect(s).toContain("- Length: this meeting's conversation is about 30000 characters once fillers are removed. Treat roughly 4500 characters of minutes");
    expect(s.endsWith('but do not drop any substantive point.')).toBe(true);
    expect(minutesSystem('가'.repeat(50000), { cleaned: true })).toContain('about 50000 characters');
  });
});

describe('minutes.json 상태 · canResume', () => {
  it('쓰면 updatedAt을 붙이고 그대로 읽힌다. 없거나 깨졌으면 null', () => {
    writeStatus(root, { status: 'error', stage: 'write', timing: { model: 'large-v3' }, error: '연결 끊김' });
    const s = readStatus(root);
    expect(s).toEqual({ status: 'error', stage: 'write', timing: { model: 'large-v3' }, error: '연결 끊김', updatedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(s!.updatedAt as string))).toBe(false);
    fs.writeFileSync(path.join(root, 'minutes.json'), '{ 깨짐');
    expect(readStatus(root)).toBeNull();
    fs.rmSync(path.join(root, 'minutes.json'));
    expect(readStatus(root)).toBeNull();
  });

  it('회의록 쓰기에서 멈췄고(write, 또는 write 단계의 error) 녹취가 있을 때만', () => {
    writeStatus(root, { status: 'write' });
    expect(canResume(root)).toBe(false); // 녹취 없음
    fs.writeFileSync(path.join(root, 'transcript.txt'), '[00:00] 안녕하세요\n');
    expect(canResume(root)).toBe(true);
    expect(canResume(root, { status: 'error', stage: 'write' })).toBe(true);
    expect(canResume(root, { status: 'error', stage: 'transcribe' })).toBe(false);
    expect(canResume(root, { status: 'done' })).toBe(false);
    expect(canResume(root, null)).toBe(false); // null을 넘기면 파일을 읽지 않는다 (makeMinutes가 resume 없이 부를 때)
  });
});

describe('renameSpeaker', () => {
  const meta = (names?: Record<string, string>) => {
    fs.writeFileSync(path.join(root, 'meta.json'), JSON.stringify({ mode: 'meeting', ...(names ? { speakerNames: names } : {}) }));
  };
  it('파일 안 표시 → 이름, 화면의 이름으로 다시 바꾸기, 원래 표시로 되돌리기', () => {
    meta();
    renameSpeaker(root, '화자 1', ' 진행자\n');
    expect(readJson(root, 'meta.json').speakerNames).toEqual({ '화자 1': '진행자' });
    renameSpeaker(root, '진행자', '[기록자]');
    expect(readJson(root, 'meta.json').speakerNames).toEqual({ '화자 1': '기록자' });
    renameSpeaker(root, '기록자', '화자 1');
    expect(readJson(root, 'meta.json').speakerNames).toEqual({});
    expect(readJson(root, 'meta.json').mode).toBe('meeting');
  });
  it('빈 이름이나 같은 이름이면 파일을 건드리지 않는다', () => {
    meta({ '나': '진행자' });
    const before = fs.readFileSync(path.join(root, 'meta.json'), 'utf8');
    renameSpeaker(root, '진행자', '  ');
    renameSpeaker(root, '진행자', '진행자');
    expect(fs.readFileSync(path.join(root, 'meta.json'), 'utf8')).toBe(before);
  });
});
