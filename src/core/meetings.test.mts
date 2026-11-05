import fs from 'node:fs';
import path from 'node:path';
import Value from 'typebox/value';
import { afterAll, describe, expect, it } from 'vitest';
import { makeFixture } from '../test/fixture.mjs';
import { findRoot, listMeetings, readActions, readMinutes, readScript, readSpeakers, resolveMeeting, settingsFile } from './meetings.mjs';
import * as schema from './schema.mjs';

const fx = makeFixture();
afterAll(fx.cleanup);

it('앱 설정 폴더 이름은 package.json에서 (Electron의 userData와 같은 규칙)', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  expect(settingsFile('/h')).toBe(path.join('/h', 'Library', 'Application Support', pkg.productName ?? pkg.name, 'dictation.json'));
});

describe('findRoot', () => {
  it('--dir > 환경 변수 > 앱 설정 > 기본 폴더', () => {
    expect(findRoot({ dir: '/x', env: { MR_RECORDINGS_DIR: '/y' }, home: fx.home })).toEqual({ dir: '/x', from: 'option' });
    expect(findRoot({ env: { MR_RECORDINGS_DIR: '/y' }, home: fx.home })).toEqual({ dir: '/y', from: 'env' });
    expect(findRoot({ env: {}, home: fx.home })).toEqual({ dir: fx.root, from: 'default' });
    fs.mkdirSync(path.dirname(settingsFile(fx.home)), { recursive: true });
    fs.writeFileSync(settingsFile(fx.home), JSON.stringify({ recordingsDir: fx.home }));
    expect(findRoot({ env: {}, home: fx.home })).toEqual({ dir: fx.home, from: 'settings' });
    // 지정한 폴더가 사라졌으면(외장 디스크 분리 등) 앱처럼 기본 폴더
    fs.writeFileSync(settingsFile(fx.home), JSON.stringify({ recordingsDir: path.join(fx.home, '없음') }));
    expect(findRoot({ env: {}, home: fx.home }).from).toBe('default');
  });
});

describe('listMeetings', () => {
  const r = listMeetings(fx.root);
  it('출력이 스키마에 맞는다', () => expect(Value.Check(schema.ListOutput, r)).toBe(true));
  it('회의만, 최근부터 (받아쓰기·녹음 중 폴더 제외)', () => expect(r.meetings.map((m) => m.id)).toEqual([fx.latest, fx.older]));
  it('제목·요약에 바꾼 화자 이름, 상태·확인 필요 요약', () => {
    const [m] = r.meetings;
    expect(m).toMatchObject({ title: '배포 일정 정리', summary: '민준은 화요일 배포를 제안했다.\n화자 2가 QA를 맡았다.', status: 'done', speakers: 2, review: { open: 1, total: 2, finalized: false }, durationSec: 95.4 });
    expect(m?.has).toEqual({ minutes: true, actions: true, script: true, transcript: true });
    expect(r.meetings[1]).toMatchObject({ status: 'transcribe', title: null, summary: null, review: null });
  });
  it('--limit, --since', () => {
    expect(listMeetings(fx.root, { limit: 1 }).meetings).toHaveLength(1);
    expect(listMeetings(fx.root, { since: '2026-11-02' }).meetings.map((m) => m.id)).toEqual([fx.latest]);
    expect(() => listMeetings(fx.root, { since: '어제' })).toThrow(expect.objectContaining({ code: 'USAGE' }));
  });
  it('녹음 폴더가 없으면 NOT_FOUND', () => expect(() => listMeetings(path.join(fx.home, '없음'))).toThrow(expect.objectContaining({ code: 'NOT_FOUND' })));
});

describe('resolveMeeting', () => {
  it('정확한 이름·latest·하나로 정해지는 앞부분', () => {
    expect(resolveMeeting(fx.root, fx.older).id).toBe(fx.older);
    expect(resolveMeeting(fx.root, 'latest').id).toBe(fx.latest);
    expect(resolveMeeting(fx.root, '2026-11-02').id).toBe(fx.latest);
  });
  it('여러 개면 AMBIGUOUS, 없으면 NOT_FOUND', () => {
    expect(() => resolveMeeting(fx.root, '2026-11')).toThrow(expect.objectContaining({ code: 'AMBIGUOUS' }));
    expect(() => resolveMeeting(fx.root, '2025')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
  it('녹음 폴더 밖 경로는 열지 않는다', () => {
    expect(() => resolveMeeting(fx.root, '../')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => resolveMeeting(fx.root, `${fx.latest}/../${fx.older}`)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('회의 내용', () => {
  it('회의록: 화자 이름 반영', () => {
    const r = readMinutes(fx.root, 'latest');
    expect(Value.Check(schema.MinutesOutput, r)).toBe(true);
    expect(r.markdown).toContain('민준은 화요일 배포를 제안했다');
    expect(() => readMinutes(fx.root, fx.older)).toThrow(expect.objectContaining({ code: 'NOT_READY' }));
  });
  it('액션: 담당·조언의 화자 이름 반영', () => {
    const r = readActions(fx.root, 'latest');
    expect(Value.Check(schema.ActionsOutput, r)).toBe(true);
    expect(r.actions[0]).toMatchObject({ owner: '화자 2', task: 'QA 마치기', done: false });
    expect(r.advice[0]).toMatchObject({ from: '민준', text: '민준이 정한 순서를 따르기' });
    expect(() => readActions(fx.root, fx.older)).toThrow(expect.objectContaining({ code: 'NOT_READY' }));
  });
  it('정리본·원본', () => {
    const clean = readScript(fx.root, 'latest');
    expect(Value.Check(schema.ScriptOutput, clean)).toBe(true);
    expect(clean.lines[0]).toEqual({ at: 2, stamp: '00:02', speaker: '민준', text: '다음 주 배포 일정 얘기해 볼까요?' });
    expect(readScript(fx.root, 'latest', { raw: true }).lines).toHaveLength(4);
  });
  it('화자: 표시·바꾼 이름·말한 시간', () => {
    const r = readSpeakers(fx.root, 'latest');
    expect(Value.Check(schema.SpeakersOutput, r)).toBe(true);
    // 화자 1: 00:02→00:10(8초) + 00:20→01:30(70초지만 최대 30초) = 38, 화자 2: 10초 + 01:30→끝 95.4초(5.4초) ≈ 15
    expect(r.speakers).toEqual([
      { label: '화자 1', name: '민준', sec: 38, lines: 2, first: '00:02' },
      { label: '화자 2', name: '화자 2', sec: 15, lines: 2, first: '00:10' },
    ]);
  });
  it('모양이 다른 파일은 없는 것으로 본다', () => {
    fs.writeFileSync(path.join(fx.root, fx.latest, 'actions.json'), JSON.stringify({ actions: 'x' }));
    expect(() => readActions(fx.root, 'latest')).toThrow(expect.objectContaining({ code: 'NOT_READY' }));
  });
});
