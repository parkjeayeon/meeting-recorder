import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteOptions } from '../llm/call.mjs';
import { fakeDeps, readJson, tmpDir } from '../test/meeting.mjs';
import { explainTerm, makeGlossary, readGlossary, updateTerm } from './glossary.mjs';

const MINUTES = '# 배포 정리\n\n## 요약\n- 배포봇으로 스테이징에 올림\n- OAuth 토큰 갱신은 다음 주\n- 화자 1이 정리';
const TRANSCRIPT = ['[00:05] [화자 1] 배포봇이 스테이징에 올려 줘요', '[00:30] [화자 2] 배포봇은 우리 팀이 만든 거죠', '[01:00] [화자 1] OAuth 토큰은 다음 주에', '[01:30] [화자 2] 배포봇 로그도 봐요'].join('\n');
let root = '';
let dir = '';
beforeEach(() => {
  root = tmpDir('mr-glossary-');
  dir = path.join(root, 'm');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'minutes.md'), MINUTES);
  fs.writeFileSync(path.join(dir, 'transcript.txt'), TRANSCRIPT);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const reply = (o: object) => async () => ({ text: JSON.stringify(o), provider: 'fake' });

describe('makeGlossary', () => {
  it('회의록에 그대로 있는 말만, 일반 용어는 확인됨·나머지는 추정, 시각은 녹취에서', async () => {
    const f = fakeDeps(root, { complete: reply({ terms: [
      { term: '배포봇', note: '팀이 만든 배포 도구', basis: 'meeting' },
      { term: 'OAuth', note: '권한 위임 표준', basis: 'general' },
      { term: '없는말', note: 'x', basis: 'general' }, // 회의록에 없음
      { term: '배포 봇', note: '겹침', basis: 'meeting' }, // 띄어쓰기만 다른 같은 말
      { term: '스테이징', note: '', basis: '이상한 값' }, // 근거가 이상하면 unknown, 빈 설명은 기본 문구
    ] }) });
    const g = await makeGlossary(dir);
    expect(g.terms.map((t) => [t.id, t.term, t.basis, t.status, t.note, t.at])).toEqual([
      ['g1', '배포봇', 'meeting', 'suggested', '팀이 만든 배포 도구', ['00:05', '00:30', '01:30']],
      ['g2', 'OAuth', 'general', 'confirmed', '권한 위임 표준', ['01:00']],
      ['g3', '스테이징', 'unknown', 'suggested', '회의에서 설명 없음', ['00:05']],
    ]);
    expect(readJson(dir, 'glossary.json')).toMatchObject({ provider: 'fake', updatedAt: expect.any(String) });
    const call = f.llm[0] as CompleteOptions;
    expect(call).toMatchObject({ choice: 'auto', apiKey: 'fake-key', effort: 'low', maxTokens: 4000, timeouts: { 'claude-code': 300000, codex: 300000, api: 300000 } });
    expect(call.system.startsWith('You pick terms in Korean meeting minutes')).toBe(true);
    expect(call.input).toBe(`<minutes>\n${MINUTES}\n</minutes>\n<transcript>\n${TRANSCRIPT}\n</transcript>`);
  });

  it('다시 만들면 사용자가 고치거나 넣은 말과 확인한 회의 용어는 두고 추정만 새로', async () => {
    fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify({ terms: [
      { id: 'g1', term: '배포봇', note: '내가 고친 설명', basis: 'meeting', status: 'confirmed', source: 'llm', edited: true, at: [] },
      { id: 'g2', term: '스테이징', note: '추정', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
      { id: 'g5', term: '토큰', note: '직접 넣음', basis: 'meeting', status: 'suggested', source: 'user', at: [] },
    ] }));
    fakeDeps(root, { complete: reply({ terms: [{ term: '배포봇', note: '덮어쓰면 안 됨', basis: 'meeting' }, { term: '스테이징', note: '새 추정', basis: 'meeting' }] }) });
    const g = await makeGlossary(dir);
    expect(g.terms.map((t) => [t.id, t.term, t.note])).toEqual([['g1', '배포봇', '내가 고친 설명'], ['g5', '토큰', '직접 넣음'], ['g6', '스테이징', '새 추정']]);
    expect(g.terms[0]!.at).toEqual(['00:05', '00:30', '01:30']); // 남긴 말도 시각은 다시
  });

  it('회의록이 비면 LLM을 부르지 않고 빈 목록, 답이 이상하면 실패', async () => {
    fs.writeFileSync(path.join(dir, 'minutes.md'), '  ');
    const f = fakeDeps(root, { complete: reply({}) });
    expect((await makeGlossary(dir)).terms).toEqual([]);
    expect(f.llm).toHaveLength(0);
    fs.writeFileSync(path.join(dir, 'minutes.md'), MINUTES);
    await expect(makeGlossary(dir)).rejects.toThrow('용어를 정리하지 못했습니다');
  });
});

describe('explainTerm · updateTerm', () => {
  it('고른 말의 앞뒤 두 줄을 근거로 묻고 사용자가 넣은 것으로 남긴다', async () => {
    const f = fakeDeps(root, { complete: reply({ note: '토큰 갱신', basis: 'meeting' }) });
    const t = await explainTerm(dir, '  OAuth   토큰 ');
    expect(t).toMatchObject({ id: 'g1', term: 'OAuth 토큰', source: 'user', status: 'suggested', at: ['01:00'] });
    const call = f.llm[0] as CompleteOptions;
    expect(call).toMatchObject({ effort: 'low', maxTokens: 600 });
    expect(call.input).toBe(`<term>OAuth 토큰</term>\n<excerpts>\n${TRANSCRIPT}\n</excerpts>`);
    await expect(explainTerm(dir, 'oauth토큰')).rejects.toThrow('이미 설명이 있는 말입니다');
    await expect(explainTerm(dir, '')).rejects.toThrow('1~40자');
  });

  it('녹취에 없는 말은 그렇다고 알리고 묻는다', async () => {
    const f = fakeDeps(root, { complete: reply({ note: '모름', basis: 'unknown' }) });
    await explainTerm(dir, '없는 말');
    expect((f.llm[0] as CompleteOptions).input).toContain('(녹취에서 이 말을 찾지 못함)');
  });

  it('고치면 확인됨·고친 표시, 지우기, 모두 확인', () => {
    fs.writeFileSync(path.join(dir, 'glossary.json'), JSON.stringify({ terms: [
      { id: 'g1', term: 'a', note: 'x', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
      { id: 'g2', term: 'b', note: 'y', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
      { id: 'g3', term: 'c', note: 'z', basis: 'meeting', status: 'suggested', source: 'llm', at: [] },
    ] }));
    updateTerm(dir, 'g1', { note: '  새 설명 ' });
    expect(readGlossary(dir)!.terms[0]).toMatchObject({ note: '새 설명', edited: true, status: 'confirmed' });
    updateTerm(dir, 'g2', { remove: true });
    expect(readGlossary(dir)!.terms.map((t) => t.id)).toEqual(['g1', 'g3']);
    updateTerm(dir, '*', { status: 'confirmed' });
    expect(readGlossary(dir)!.terms.every((t) => t.status === 'confirmed')).toBe(true);
    expect(() => updateTerm(dir, 'g9', {})).toThrow('없는 용어입니다');
    fs.rmSync(path.join(dir, 'glossary.json'));
    expect(() => updateTerm(dir, 'g1', {})).toThrow('용어 설명이 없습니다');
  });
});
