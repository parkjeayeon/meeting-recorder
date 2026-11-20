import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteOptions } from '../llm/call.mjs';
import { echoComplete, fakeDeps, meetingDir, readJson, sleep, tmpDir } from '../test/meeting.mjs';
import { makeCleanScript } from './minutes.mjs';
import { makeMinutes } from './pipeline.mjs';

const SAID = [
  { start: 0, end: 4, text: '다음 주 배포 일정 얘기해 볼까요' },
  { start: 5, end: 9, text: '화요일 오전이 좋겠어요' },
];

let root = '';
let userData = '';
beforeEach(() => {
  root = tmpDir('mr-pipeline-');
  userData = path.join(root, 'userData');
  fs.mkdirSync(userData);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// 단계마다 onStage가 불릴 때 minutes.json에 적힌 상태도 같이 읽는다 (상태를 먼저 적고 알린다)
const watch = (dir: string) => {
  const seen: { stage: string; file: string; progress?: unknown }[] = [];
  const onStage = (s: { dir: string; status: string; [k: string]: unknown }) => seen.push({ stage: s.status, file: readJson(dir, 'minutes.json').status, ...(s.progress !== undefined ? { progress: s.progress } : {}) });
  const statuses = () => seen.map((s) => s.stage).filter((s, i, a) => s !== a[i - 1]); // 같은 상태가 이어지면 하나로
  return { seen, onStage, statuses };
};

describe('makeMinutes · run', () => {
  it('녹취 → 정리본 → 회의록 → 확인 필요·용어 설명, 상태는 queued → transcribe → write → done', async () => {
    const dir = meetingDir(root, 'ok', { meta: { notes: '녹음이 끝난 뒤 다음 회의를 목요일로 정함', speakerNames: { '화자 1': '진행자' } } });
    const f = fakeDeps(userData, { transcribe: () => SAID, complete: echoComplete });
    const w = watch(dir);
    await makeMinutes(dir, { onStage: w.onStage });

    expect(w.statuses()).toEqual(['queued', 'transcribe', 'write', 'done']);
    expect(w.seen.every((s) => s.stage === s.file)).toBe(true);
    const status = readJson(dir, 'minutes.json');
    expect(status).toMatchObject({ status: 'done', provider: 'fake', title: '배포 일정 정리', speakers: 0, diarizeError: null, updatedAt: expect.any(String) });
    expect(status.timing).toMatchObject({ model: 'large-v3', transcribeMs: expect.any(Number), scriptMs: expect.any(Number), writeMs: expect.any(Number) });

    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe('[00:00] 다음 주 배포 일정 얘기해 볼까요\n[00:05] 화요일 오전이 좋겠어요\n');
    expect(fs.readFileSync(path.join(dir, 'script-clean.txt'), 'utf8')).toBe('[00:00] 다음 주 배포 일정 얘기해 볼까요\n[00:05] 화요일 오전이 좋겠어요\n');
    expect(fs.readFileSync(path.join(dir, 'minutes.md'), 'utf8')).toMatch(/^# 배포 일정 정리\n/);

    // LLM 호출 둘: 정리본(low) → 회의록(medium), 지금 설정의 계정·키로, 10분 제한
    const [clean, write] = f.llm as [CompleteOptions, CompleteOptions];
    expect(f.llm).toHaveLength(2);
    expect(clean).toMatchObject({ effort: 'low', choice: 'auto', apiKey: 'fake-key', maxTokens: 16000, timeouts: { 'claude-code': 600000, codex: 600000, api: 600000 } });
    expect(clean.system.startsWith('You prune a timestamped Korean conversation script')).toBe(true);
    expect(write).toMatchObject({ effort: 'medium', choice: 'auto', apiKey: 'fake-key', maxTokens: 16000, timeouts: { 'claude-code': 600000, codex: 600000, api: 600000 } });
    const cleanLen = fs.readFileSync(path.join(dir, 'script-clean.txt'), 'utf8').trim().length;
    expect(write.system).toContain(`about ${cleanLen} characters once fillers are removed`); // 정리본 길이 그대로 (cleaned)
    expect(write.input).toMatch(/^<meeting started="2026년 11월 2일 .*" duration="00:30">\n\[00:00\] 다음 주/);
    expect(write.input.endsWith('</meeting>\n<notes>\n녹음이 끝난 뒤 다음 회의를 목요일로 정함\n</notes>')).toBe(true);

    expect(f.glossary).toEqual([dir]);
    expect(readJson(dir, 'review.json')).toMatchObject({ items: expect.any(Array), check: { issues: expect.any(Number) } }); // 확인 필요 목록 + 형식 검사
    expect(readJson(dir, 'meta.json').speakerNames).toBeUndefined(); // 새로 만들면 바꿔 둔 화자 이름은 지운다
    expect(f.isOnlineCalls).toBe(0);
  });

  it('녹취가 비면 empty로 끝내고 LLM을 부르지 않는다', async () => {
    const dir = meetingDir(root, 'empty');
    const f = fakeDeps(userData, { transcribe: () => [], complete: echoComplete });
    const w = watch(dir);
    await makeMinutes(dir, { onStage: w.onStage });
    expect(w.statuses()).toEqual(['queued', 'transcribe', 'empty']);
    expect(readJson(dir, 'minutes.json')).toMatchObject({ status: 'empty', speakers: 0, diarizeError: null });
    expect(f.llm).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe('');
  });

  it('회의록 쓰기에서 실패하면 error(stage write), 인터넷이 끊겼는지 함께 적는다', async () => {
    for (const online of [false, true]) {
      const dir = meetingDir(root, `fail-${online}`);
      const f = fakeDeps(userData, {
        transcribe: () => SAID,
        complete: async (o) => {
          if (o.system.startsWith('You prune')) return echoComplete(o);
          throw new Error('연결할 수 없습니다\n자세한 내용');
        },
      });
      f.online = online;
      const w = watch(dir);
      await makeMinutes(dir, { onStage: w.onStage });
      expect(w.statuses()).toEqual(['queued', 'transcribe', 'write', 'error']);
      expect(readJson(dir, 'minutes.json')).toMatchObject({ status: 'error', stage: 'write', error: '연결할 수 없습니다', offline: !online });
      expect(f.isOnlineCalls).toBe(1);
      expect(fs.existsSync(path.join(dir, 'minutes.md'))).toBe(false);
    }
  });

  it('시간 초과(killed)는 "시간 초과"로, 정리본이 실패해도 원본 녹취로 회의록을 쓴다', async () => {
    const dir = meetingDir(root, 'killed');
    let calls = 0;
    fakeDeps(userData, {
      transcribe: () => SAID,
      complete: async () => {
        calls++;
        throw Object.assign(new Error('타임아웃'), { killed: true });
      },
    });
    await makeMinutes(dir);
    expect(calls).toBe(2); // 정리본(조각 하나, 실패 → 원본) + 회의록
    expect(readJson(dir, 'minutes.json')).toMatchObject({ status: 'error', stage: 'write', error: '시간 초과' });
    // 정리본이 조각마다 실패하면 원본 줄을 그대로 쓴다
    expect(fs.readFileSync(path.join(dir, 'script-clean.txt'), 'utf8')).toBe(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8'));
  });

  it('녹취 단계에서 실패하면 stage transcribe, 인터넷 연결은 묻지 않는다', async () => {
    const dir = meetingDir(root, 'asr-fail');
    const f = fakeDeps(userData, {
      transcribe: () => {
        throw new Error('Whisper 오류 (HTTP 500)');
      },
    });
    await makeMinutes(dir);
    expect(readJson(dir, 'minutes.json')).toMatchObject({ status: 'error', stage: 'transcribe', error: 'Whisper 오류 (HTTP 500)', offline: false });
    expect(f.isOnlineCalls).toBe(0);
    expect(fs.readdirSync(dir).filter((x) => x.startsWith('.'))).toEqual([]);
  });

  it('이어서 쓰기: 저장된 녹취로 회의록만 다시, 녹취·화자 이름·지난 기록은 그대로', async () => {
    const dir = meetingDir(root, 'resume', { meta: { speakerNames: { '화자 1': '진행자' } } });
    fs.writeFileSync(path.join(dir, 'transcript.txt'), '[00:00] [화자 1] 다음 주 배포 일정 얘기해 볼까요\n');
    fs.writeFileSync(path.join(dir, 'minutes.json'), JSON.stringify({ status: 'error', stage: 'write', timing: { model: 'large-v3', transcribeMs: 1234 }, speakers: 1, diarizeError: null }));
    const f = fakeDeps(userData, { complete: echoComplete });
    const w = watch(dir);
    await makeMinutes(dir, { onStage: w.onStage, resume: true });

    expect(w.statuses()).toEqual(['queued', 'write', 'done']);
    expect(f.asr).toEqual([]);
    expect(f.servers).toEqual([]);
    expect(readJson(dir, 'meta.json').speakerNames).toEqual({ '화자 1': '진행자' });
    expect(readJson(dir, 'minutes.json')).toMatchObject({ status: 'done', speakers: 1, diarizeError: null, timing: { model: 'large-v3', transcribeMs: 1234, writeMs: expect.any(Number) } });
    expect(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8')).toBe('[00:00] [화자 1] 다음 주 배포 일정 얘기해 볼까요\n');
  });

  it('이어서 쓸 수 없는 상태면(resume을 줘도) 처음부터 만든다', async () => {
    const dir = meetingDir(root, 'no-resume', { meta: { speakerNames: { '화자 1': '진행자' } } });
    fs.writeFileSync(path.join(dir, 'minutes.json'), JSON.stringify({ status: 'error', stage: 'transcribe' }));
    const f = fakeDeps(userData, { transcribe: () => SAID, complete: echoComplete });
    await makeMinutes(dir, { resume: true });
    expect(f.asr).toHaveLength(1);
    expect(readJson(dir, 'meta.json').speakerNames).toBeUndefined();
  });

  it('회의록 만들기·정리본 따로 만들기는 한 줄로 서서 하나씩 (앞 일이 실패해도 다음 일은 한다)', async () => {
    const a = meetingDir(root, 'a');
    const b = meetingDir(root, 'b');
    const c = meetingDir(root, 'c');
    fs.writeFileSync(path.join(c, 'transcript.txt'), '[00:00] 정리본만 만들 회의\n');
    const log: string[] = [];
    let inFlight = 0;
    let most = 0;
    fakeDeps(userData, {
      transcribe: async (file) => {
        log.push(`asr ${path.basename(path.dirname(file))}`);
        await sleep(5);
        return SAID;
      },
      complete: async (o) => {
        inFlight++;
        most = Math.max(most, inFlight);
        const who = o.input.includes('정리본만') ? 'c' : '?';
        log.push(`llm ${who}`);
        await sleep(5);
        inFlight--;
        if (log.filter((l) => l.startsWith('llm')).length === 1) throw new Error('첫 호출 실패');
        return echoComplete(o);
      },
    });
    const broken = makeCleanScript(path.join(root, 'no-such-meeting')); // 녹취가 없어 실패하는 일이 맨 앞에
    const ja = makeMinutes(a, { onStage: (s) => s.status !== 'transcribe' && log.push(`a ${s.status}`) });
    const jb = makeMinutes(b, { onStage: (s) => s.status !== 'transcribe' && log.push(`b ${s.status}`) });
    const jc = makeCleanScript(c);
    await expect(broken).rejects.toThrow(/ENOENT/);
    await Promise.all([ja, jb, jc]);

    // 둘 다 바로 queued가 되지만, b의 녹취는 a가 끝난 뒤에, c의 정리본은 b가 끝난 뒤에
    expect(log.slice(0, 2)).toEqual(['a queued', 'b queued']);
    const at = (s: string) => log.indexOf(s);
    expect(at('asr b')).toBeGreaterThan(at('a done'));
    expect(at('llm c')).toBeGreaterThan(at('b done'));
    expect(most).toBe(1);
    expect(fs.readFileSync(path.join(c, 'script-clean.txt'), 'utf8')).toBe('[00:00] 정리본만 만들 회의\n');
  });
});
