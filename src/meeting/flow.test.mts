import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CompleteOptions } from '../llm/call.mjs';
import { fakeDeps, tmpDir } from '../test/meeting.mjs';
import { applyRevision, chatFlow, makeFlows, readFlow, remakeFlow, removeFlow, verifyFlow, type Materials } from './flow.mjs';

const T = [
  '[00:05] [화자 1] 먼저 저장소를 받아서 설치 스크립트를 돌립니다',
  '[01:00] [화자 2] 그다음 설정 파일을 복사하고 키를 넣어요',
  '[02:30] [화자 1] 마지막으로 서버를 켜고 상태 페이지를 확인합니다',
  '[02:50] [화자 2] 키는 절대 저장소에 올리면 안 됩니다',
].join('\n');
const MIN = '# 설치\n\n## 할 일\n- 화자 1: 금요일까지 문서를 정리해서 공유\n\n## 결정 사항\n- 키는 저장소에 올리지 않기로 함';
const m: Materials = { transcript: T, clean: '정리본에는 CLI 라는 말이 있음', minutes: MIN };
const step = (id: string, title: string, at: string, quote: string, extra = {}) => ({ id, title, detail: '', at, quote, ...extra });
const S1 = step('s1', '저장소 받기', '00:05', '저장소를 받아서 설치 스크립트를');
const S2 = step('s2', '설정 복사', '01:00', '설정 파일을 복사하고 키를');
const S3 = step('s3', '서버 켜기', '02:30', '서버를 켜고 상태 페이지를');

describe('verifyFlow (지어낸 단계 막기)', () => {
  it('인용은 그 시각 앞뒤 60초 녹취에 있어야 한다 (띄어쓰기·문장부호 무시)', () => {
    const log: string[] = [];
    const f = verifyFlow({ title: '설치', steps: [S1, { ...S2, quote: '설정 파일을, 복사하고   키를!' }, { ...S3, at: '00:10' }, step('s4', '서버 다시', '03:31', '서버를 켜고 상태 페이지를')], edges: [] }, m, log);
    expect(f!.steps.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(log).toEqual(['단계 버림 (인용이 녹취에 없음): 서버 켜기 @00:10', '단계 버림 (인용이 녹취에 없음): 서버 다시 @03:31']);
    // 03:30은 02:30에서 딱 60초 — 들어간다
    expect(verifyFlow({ steps: [S1, step('s4', '서버', '03:30', '서버를 켜고 상태 페이지를')] }, m, [])!.steps).toHaveLength(2);
  });

  it('인용이 6글자 미만이거나 시각이 없으면 버린다', () => {
    const log: string[] = [];
    expect(verifyFlow({ steps: [S1, { ...S2, quote: '설정 파일' }, { ...S3, at: '' }] }, m, log)).toBeNull();
    expect(log.at(-1)).toBe('흐름 버림 (확인된 단계 1개): ');
  });

  it('회의 어디에도 없는 영문·숫자 이름은 지어낸 것으로 본다 (정리본·회의록에 있으면 괜찮다)', () => {
    const log: string[] = [];
    const f = verifyFlow({ steps: [S1, { ...S2, title: 'API 설정' }, { ...S3, detail: 'CLI로 켜기' }] }, m, log);
    expect(f!.steps.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(log).toEqual(['단계 버림 (회의에 없는 이름 API): API 설정']);
  });

  it('레인은 둘 이상이고 모든 단계가 레인에 있을 때만, 간선은 남은 단계 사이만(제자리 빼고), 메모는 근거가 있는 것만', () => {
    const lanes = [{ id: 'a', name: '개발자' }, { id: 'b', name: '운영' }];
    const flow = { title: '설치', summary: '순서', lanes, steps: [{ ...S1, lane: 'a' }, { ...S2, lane: 'b' }, { ...S3, lane: 'b', optional: 1 }], edges: [{ from: 's1', to: 's2' }, { from: 's2', to: 's2' }, { from: 's2', to: 's9' }, { from: 's2', to: 's3' }],
      notes: [{ step: 's2', kind: 'info', text: '키 주의', at: '02:50', quote: '키는 절대 저장소에 올리면' }, { step: 's2', kind: 'x', text: '근거 없음', at: '02:50', quote: '이런 말은 하지 않았습니다' }, { step: 's9', text: '없는 단계', at: '02:50', quote: '키는 절대 저장소에 올리면' }] };
    const log: string[] = [];
    const f = verifyFlow(flow, m, log)!;
    expect(f.lanes).toEqual(lanes);
    expect(f.steps.map((s) => [s.lane, s.optional])).toEqual([['a', false], ['b', false], ['b', true]]);
    expect(f.edges).toEqual([{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }]);
    expect(f.notes).toEqual([{ step: 's2', kind: 'info', text: '키 주의', at: '02:50', quote: '키는 절대 저장소에 올리면' }]);
    expect(log).toEqual(['메모 버림 (인용이 녹취에 없음): 근거 없음']);
    // 한 레인에만 몰리면 레인을 쓰지 않는다
    const one = verifyFlow({ ...flow, steps: flow.steps.map((s) => ({ ...s, lane: 'a' })) }, m, [])!;
    expect([one.lanes, one.steps.map((s) => s.lane)]).toEqual([[], [null, null, null]]);
  });
});

describe('흐름도 만들기 · 다시 · 대화 · 지우기', () => {
  let root = '';
  let dir = '';
  beforeEach(() => {
    root = tmpDir('mr-flow-');
    dir = path.join(root, 'm');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'transcript.txt'), T);
    fs.writeFileSync(path.join(dir, 'script-clean.txt'), m.clean);
    fs.writeFileSync(path.join(dir, 'minutes.md'), MIN);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const flowsReply = (flows: object[], extra = {}) => async () => ({ text: JSON.stringify({ flows, handoff: null, reason: '이유', ...extra }), provider: 'fake' });

  it('요청과 재료를 넣어 부르고, 흐름마다 f1·f2, 인수인계는 회의록 문장이 근거인 것만 (둘 이상일 때)', async () => {
    const f = fakeDeps(root, { complete: flowsReply([{ title: 'A', steps: [S1, S2] }, { title: '근거 없음', steps: [S3] }, { title: 'B', steps: [S2, S3] }], {
      handoff: { from: '화자 1', to: '화자 2', give: [{ text: '문서', source: '금요일까지 문서를 정리해서' }], todo: [{ text: '지어냄', source: '회의록에 없는 문장입니다' }], decided: [{ text: '키', source: '키는 저장소에 올리지 않기로' }] },
    }) });
    const data = await makeFlows(dir, { focus: '  설치 순서  ' });
    expect(data.flows.map((x) => [x.id, x.title])).toEqual([['f1', 'A'], ['f2', 'B']]);
    expect(data.handoff).toEqual({ from: '화자 1', to: '화자 2', give: [{ text: '문서', source: '금요일까지 문서를 정리해서' }], todo: [], decided: [{ text: '키', source: '키는 저장소에 올리지 않기로' }] });
    expect(data).toMatchObject({ focus: '설치 순서', reason: '이유', provider: 'fake' });
    expect(data.log).toContain('인수인계 버림 (회의록에 없음): 지어냄');
    const call = f.llm[0] as CompleteOptions;
    expect(call).toMatchObject({ choice: 'auto', apiKey: 'fake-key', effort: 'high', maxTokens: 12000, timeouts: { 'claude-code': 600000, codex: 600000, api: 600000 } });
    expect(call.input).toBe(`<user_request>설치 순서</user_request>\n<transcript>\n${T}\n</transcript>\n<clean_script>\n${m.clean}\n</clean_script>\n<minutes>\n${MIN}\n</minutes>`);
    expect(readFlow(dir)!.flows).toHaveLength(2);
  });

  it('흐름을 찾았지만 근거가 없으면 그 이유로, 녹취가 없으면 실패', async () => {
    fakeDeps(root, { complete: flowsReply([{ title: 'X', steps: [S3] }]) });
    expect(await makeFlows(dir)).toMatchObject({ flows: [], reason: '흐름을 찾았지만 녹취에서 단계의 근거가 확인되지 않았습니다', focus: null });
    fs.writeFileSync(path.join(dir, 'transcript.txt'), ' ');
    await expect(makeFlows(dir)).rejects.toThrow('녹취가 없습니다');
  });

  it('다시 그리기는 그 흐름 제목을 요청으로, 대화는 고친 그림을 검증해서 돌려주고 적용은 다시 검증', async () => {
    fakeDeps(root, { complete: flowsReply([{ title: 'A', steps: [S1, S2] }, { title: 'B', steps: [S2, S3] }]) });
    await makeFlows(dir);
    const f = fakeDeps(root, { complete: flowsReply([{ title: 'B2', steps: [S1, S3] }]) });
    const again = await remakeFlow(dir, 'f2', '짧게');
    expect(again.flows.map((x) => [x.id, x.title])).toEqual([['f1', 'A'], ['f2', 'B2']]);
    expect((f.llm[0] as CompleteOptions).input.startsWith('<user_request>"B" 흐름 하나만 다시 그려 주세요. 짧게</user_request>\n')).toBe(true);
    await expect(remakeFlow(dir, 'f9')).rejects.toThrow('없는 흐름도입니다');

    const revised = { title: 'A2', steps: [S1, S3], edges: [{ from: 's1', to: 's3' }] };
    const c = fakeDeps(root, { complete: async () => ({ text: `줄였어요\n\`\`\`json\n${JSON.stringify(revised)}\n\`\`\``, provider: 'fake' }) });
    const chat = await chatFlow(dir, 'f1', [{ role: 'user', text: '줄여 줘' }]);
    expect(chat.text).toBe('줄였어요');
    expect(chat.revision?.title).toBe('A2');
    expect((c.llm[0] as CompleteOptions).input).toContain('<conversation>\n<user>\n줄여 줘\n</user>\n</conversation>\n<transcript>');
    expect(applyRevision(dir, 'f1', chat.revision).flows[0]).toMatchObject({ id: 'f1', title: 'A2' });
    expect(() => applyRevision(dir, 'f1', { steps: [S1] })).toThrow('녹취로 확인되는 단계가 모자랍니다');

    expect(removeFlow(dir, 'f1')!.flows.map((x) => x.id)).toEqual(['f2']);
    expect(removeFlow(dir, 'f2')).toBeNull();
    expect(fs.existsSync(path.join(dir, 'flow.json'))).toBe(false);
  });

  it('예전 형식(흐름 하나)도 읽는다', () => {
    fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify({ flow: { title: '옛 흐름', steps: [] } }));
    expect(readFlow(dir)!.flows).toEqual([{ id: 'f1', title: '옛 흐름', steps: [] }]);
    fs.writeFileSync(path.join(dir, 'flow.json'), JSON.stringify({ flow: null }));
    expect(readFlow(dir)!.flows).toEqual([]);
  });
});
