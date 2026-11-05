import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Value from 'typebox/value';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../core/schema.mjs';
import { makeFixture } from '../test/fixture.mjs';
import { main, type Io } from './mr.mjs';

const fx = makeFixture();
afterAll(fx.cleanup);

function run(args: string[], { tty = false, env = {} as NodeJS.ProcessEnv } = {}) {
  let stdout = '';
  let stderr = '';
  const io: Io = { stdout: (s) => void (stdout += s), stderr: (s) => void (stderr += s), env: { ...env }, isTTY: tty, home: fx.home };
  const code = main(args, io);
  return { code, stdout, stderr };
}

describe('mr', () => {
  it('파이프(에이전트)면 JSON, 스키마에 맞는다', () => {
    const r = run(['list']);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(Value.Check(schema.ListOutput, data)).toBe(true);
    expect(data.root).toBe(fx.root);
  });
  it('터미널이면 Markdown, --json으로 바꿀 수 있다', () => {
    expect(run(['list'], { tty: true }).stdout).toContain('- 2026-11-02');
    expect(() => JSON.parse(run(['list', '--json'], { tty: true }).stdout)).not.toThrow();
    expect(run(['actions', 'latest', '--md']).stdout).toContain('- [ ] QA 마치기 — 화자 2 · 화요일까지 (01:30)');
  });
  it('명령마다 출력이 스키마에 맞는다', () => {
    for (const [cmd, s] of [['minutes', schema.MinutesOutput], ['actions', schema.ActionsOutput], ['script', schema.ScriptOutput], ['speakers', schema.SpeakersOutput]] as const) {
      const r = run([cmd, 'latest']);
      expect(r.code, cmd).toBe(0);
      expect(Value.Check(s, JSON.parse(r.stdout)), cmd).toBe(true);
    }
  });
  it('오류는 stderr에 JSON, 코드는 사용법 2·그 밖 1', () => {
    const missing = run(['minutes', fx.older]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe('');
    const err = JSON.parse(missing.stderr);
    expect(Value.Check(schema.ErrorOutput, err)).toBe(true);
    expect(err.error.code).toBe('NOT_READY');
    expect(run(['minutes']).code).toBe(2);
    expect(run(['nope']).code).toBe(2);
    expect(run(['list', '--limit', '0']).code).toBe(2);
    expect(JSON.parse(run(['list', '--bogus']).stderr).error.code).toBe('USAGE');
  });
  it('--dir, MR_RECORDINGS_DIR', () => {
    expect(JSON.parse(run(['list', '--dir', path.join(fx.home, '없음')]).stderr).error.code).toBe('NOT_FOUND');
    expect(JSON.parse(run(['list'], { env: { MR_RECORDINGS_DIR: fx.root } }).stdout).meetings).toHaveLength(2);
  });
  it('schema', () => {
    expect(Object.keys(JSON.parse(run(['schema']).stdout))).toEqual(['list', 'minutes', 'actions', 'script', 'speakers', 'error']);
    expect(JSON.parse(run(['schema', 'actions']).stdout).properties.actions.type).toBe('array');
    expect(run(['schema', 'x']).code).toBe(2);
  });
  it('install: 앱 안의 mr을 bin 폴더로 복사, PATH에 없으면 알려 준다', () => {
    const wrapper = path.join(fx.home, 'mr-wrapper');
    fs.writeFileSync(wrapper, '#!/bin/sh\n');
    const bin = path.join(fx.home, 'bin');
    const r = run(['install', '--bin', bin], { env: { MR_WRAPPER: wrapper, PATH: '/usr/bin' } });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ installed: path.join(bin, 'mr'), inPath: false });
    expect(fs.statSync(path.join(bin, 'mr')).mode & 0o111).toBeTruthy();
    expect(JSON.parse(run(['install', '--bin', bin], { env: { MR_WRAPPER: wrapper, PATH: bin } }).stdout).inPath).toBe(true);
    expect(run(['install']).code).toBe(2); // 앱 밖에서 돌리면 설치할 원본이 없다
  });
});

// 빌드한 lib/를 실제 앱과 같은 방식(Electron의 Node, ELECTRON_RUN_AS_NODE)으로 돌린다
const electron = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const bin = path.resolve('lib/cli/bin.mjs');
describe.runIf(fs.existsSync(electron) && fs.existsSync(bin))('Electron의 Node로 실행', () => {
  it('list --json', () => {
    const outp = execFileSync(electron, [bin, 'list', '--dir', fx.root], { env: { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH }, encoding: 'utf8' });
    expect(JSON.parse(outp).meetings.map((m: { id: string }) => m.id)).toEqual([fx.latest, fx.older]);
  });
  it('오류 코드가 프로세스 종료 코드로', () => {
    const r = spawnSync(electron, [bin, 'minutes', 'nothing', '--dir', fx.root], { env: { ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stderr).error.code).toBe('NOT_FOUND');
  });
});
