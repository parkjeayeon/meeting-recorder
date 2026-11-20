import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteOptions } from '../llm/call.mjs';
import { fakeDeps, readJson, tmpDir } from '../test/meeting.mjs';
import { makeActions, readActions, toggleAction, verify } from './actions.mjs';

const LINES = [
  '[00:05] [화자 1] 금요일까지 문서를 정리해서 공유하겠습니다',
  '[00:40] [화자 2] 처음엔 작은 단위로 나눠서 배포하는 게 좋아요',
  '[01:10] [화자 2] 로그는 꼭 남겨 두세요',
  '[01:40] [화자 1] 다음 주까지 시험 환경을 만들게요',
  '[02:00] [화자 2] 좋습니다',
  '[02:20] [화자 1] 네',
  '[02:40] [화자 2] 그럼 끝',
  '[03:00] [화자 1] 수고하셨습니다',
];
const T = LINES.join('\n');
const act = (task: string, at: string, quote: string, extra = {}) => ({ owner: '화자 1', task, due: null, kind: 'promise', at, quote, ...extra });
const adv = (text: string, at: string, quote: string, extra = {}) => ({ group: '배포', key: false, why: null, from: '화자 2', to: '화자 1', text, at, quote, ...extra });

describe('verify (LLM이 고른 할 일·조언을 녹취로 확인)', () => {
  it('하는 사람이 없거나 인용이 그 시각 앞뒤 1분 녹취에 없으면 버리고, 같은 할 일은 하나로', () => {
    const r = verify({ kind: 'work', actions: [
      act('문서 정리해서 공유하기', '00:05', '금요일까지 문서를 정리해서 공유'),
      act('주인 없음', '00:05', '금요일까지 문서를 정리해서', { owner: ' ' }),
      act('시각이 먼 인용', '03:00', '금요일까지 문서를 정리해서'),
      act('문서 정리해서 공유하기!', '00:05', '문서를 정리해서 공유하겠습니다', { owner: '화자 2' }),
      act('시험 환경 만들기', '01:40', '다음 주까지 시험 환경을', { kind: '모름', due: '' }),
    ], advice: [] }, T, null);
    expect(r.actions.map((a) => [a.id, a.task, a.kind, a.due, a.done])).toEqual([['a1', '문서 정리해서 공유하기', 'promise', null, false], ['a2', '시험 환경 만들기', 'assigned', null, false]]);
    expect(r.log).toEqual(['할 일 버림 (하는 사람 없음): 주인 없음', '할 일 버림 (인용이 녹취에 없음): 시각이 먼 인용 @03:00']);
    expect([r.kind, r.adviceTitle]).toEqual(['work', '알아 둘 것']);
  });

  it('다시 찾아도 체크해 둔 할 일은 그대로 체크', () => {
    const prev = { kind: 'work' as const, adviceTitle: '', advice: [], actions: [{ id: 'a7', owner: '화자 1', task: '문서 정리해서 공유하기', due: null, kind: 'promise' as const, at: '00:05', quote: '', done: true }] };
    const r = verify({ actions: [act('문서 정리해서 공유하기', '00:05', '금요일까지 문서를 정리해서')] }, T, prev);
    expect(r.actions[0]!.done).toBe(true);
  });

  it('조언: 근거 없는 것은 버리고, 핵심은 다섯 개까지 (넘으면 앞에서부터), 핵심이 아니면 이유를 지운다', () => {
    const advice = Array.from({ length: 7 }, (_, i) => adv(`조언 ${i}`, '00:40', '작은 단위로 나눠서 배포하는', { key: true, why: `이유 ${i}` }));
    advice.push(adv('지어냄', '00:40', '이런 말은 전혀 없었습니다'), adv('핵심 아님', '01:10', '로그는 꼭 남겨 두세요', { why: '있어도 지움', group: '' }));
    const r = verify({ kind: 'counsel', actions: [], advice }, T, null);
    expect(r.advice.filter((a) => a.key).map((a) => a.text)).toEqual(['조언 0', '조언 1', '조언 2', '조언 3', '조언 4']);
    expect(r.advice.slice(5, 7).every((a) => !a.key && a.why === null)).toBe(true);
    expect(r.advice.at(-1)).toMatchObject({ id: 'v8', text: '핵심 아님', why: null, group: '기타' });
    expect(r.log).toEqual(['조언 버림 (인용이 녹취에 없음): 지어냄 @00:40']);
    expect([r.kind, r.adviceTitle]).toEqual(['counsel', '받은 조언']);
  });
});

describe('makeActions · toggleAction', () => {
  let root = '';
  let dir = '';
  beforeEach(() => {
    root = tmpDir('mr-actions-');
    dir = path.join(root, 'm');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'transcript.txt'), T);
    fs.writeFileSync(path.join(dir, 'minutes.md'), '# 회의록');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('녹취가 8줄보다 짧으면 부르지 않고 short로 남긴다', async () => {
    fs.writeFileSync(path.join(dir, 'transcript.txt'), LINES.slice(0, 7).join('\n'));
    const f = fakeDeps(root, { complete: async () => ({ text: '{}', provider: 'fake' }) });
    expect(await makeActions(dir)).toMatchObject({ kind: null, actions: [], advice: [], skipped: 'short' });
    expect(f.llm).toHaveLength(0);
  });

  it('원본·정리본·회의록을 넣어 부르고(정리본이 없으면 빈칸), 확인한 것만 actions.json에, 체크는 파일에', async () => {
    const f = fakeDeps(root, { complete: async () => ({ text: JSON.stringify({ kind: 'work', actions: [act('문서 정리해서 공유하기', '00:05', '금요일까지 문서를 정리해서')], advice: [] }), provider: 'fake' }) });
    const data = await makeActions(dir);
    expect(data).toMatchObject({ kind: 'work', provider: 'fake', actions: [{ id: 'a1', done: false }] });
    const call = f.llm[0] as CompleteOptions;
    expect(call).toMatchObject({ choice: 'auto', apiKey: 'fake-key', effort: 'high', maxTokens: 16000, timeouts: { 'claude-code': 600000, codex: 600000, api: 600000 } });
    expect(call.input).toBe(`<transcript>\n${T}\n</transcript>\n<clean_script>\n\n</clean_script>\n<minutes>\n# 회의록\n</minutes>`);
    toggleAction(dir, 'a1', 1);
    expect(readActions(dir)!.actions[0]!.done).toBe(true);
    expect(readJson(dir, 'actions.json').updatedAt).toEqual(expect.any(String));
    expect(() => toggleAction(dir, 'a9', true)).toThrow('없는 할 일입니다');
  });

  it('답의 모양이 틀리면 실패', async () => {
    fakeDeps(root, { complete: async () => ({ text: '{"actions": []}', provider: 'fake' }) });
    await expect(makeActions(dir)).rejects.toThrow('액션을 정리하지 못했습니다');
  });
});
