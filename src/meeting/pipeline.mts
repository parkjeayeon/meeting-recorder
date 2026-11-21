// 회의록 만들기 전체: 녹취(transcribe.mts) → 정리본 → 회의록 → 확인 필요 목록·용어 설명·형식 검사. 단계마다 minutes.json에 상태를 적는다.
// Electron을 쓰지 않는다. LLM 호출·지금 설정·인터넷 연결 여부는 deps.mts로 받는다 (결정 70).
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../core/write.mjs';
import { addCheckItems, makeReview } from '../review/assist.mjs';
import { apiKey, complete, getSettings, isOnline, makeGlossary } from './deps.mjs';
import { canResume, cleanScript, LONG_TIMEOUT_MS, minutesSystem, readStatus, writeStatus, type MinutesStatus } from './minutes.mjs';
import { enqueue } from './queue.mjs';
import { transcribeMeeting, type DiarizeInfo, type MeetingMeta } from './transcribe.mjs';
import { clock } from './transcript.mjs';

export type OnStage = (stage: { dir: string; status: string; [k: string]: unknown }) => void;

// resume: 회의록 쓰기 단계에서 멈춘 회의를 저장된 녹취(transcript.txt)로 이어서 쓴다
export function makeMinutes(dir: string, { onStage = () => {}, speakers = null, resume = false }: { onStage?: OnStage; speakers?: number | null; resume?: boolean } = {}): Promise<void> {
  const prev = resume ? readStatus(dir) : null;
  writeStatus(dir, { status: 'queued' });
  onStage({ dir, status: 'queued' });
  return enqueue(() => run(dir, onStage, { speakers, prev }));
}

// 화자 붙이기(assignSpeakers)·연달아 같은 말 합치기·스크립트 조립(buildTranscript)은 transcript.mts
export async function run(dir: string, onStage: OnStage, { speakers = null, prev = null }: { speakers?: number | null; prev?: MinutesStatus | null } = {}): Promise<void> {
  const settings = getSettings();
  const meta: MeetingMeta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const resume = canResume(dir, prev);
  // 다시 만들면 화자 구분 번호가 바뀔 수 있어 바꿔 둔 이름이 엉뚱한 사람에게 붙는다 → 지운다 (이어서 쓰면 녹취가 그대로라 둔다)
  if (meta.speakerNames && !resume) {
    delete meta.speakerNames;
    writeJsonAtomic(path.join(dir, 'meta.json'), meta);
  }
  const timing: Record<string, unknown> = resume ? { ...(prev!.timing as Record<string, unknown>) } : {};
  let diarizeInfo: DiarizeInfo = resume ? { speakers: prev!.speakers ?? null, diarizeError: prev!.diarizeError ?? null } : {};
  const report = (status: string, extra: Record<string, unknown> = {}) => {
    writeStatus(dir, { status, timing, ...extra });
    onStage({ dir, status, ...extra });
  };
  let stage = 'transcribe';
  try {
    let transcript;
    if (resume) {
      transcript = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8').trim();
    } else {
      const r = await transcribeMeeting(dir, meta, settings, speakers, timing, report);
      transcript = r.transcript;
      diarizeInfo = r.diarizeInfo;
    }
    if (!transcript) {
      report('empty', diarizeInfo);
      return;
    }

    stage = 'write';
    report('write', diarizeInfo);
    const t = Date.now();
    const durationSec = Math.max(0, ...Object.values(meta.files).map((f) => f!.durationSec ?? 0));
    const when = new Date(meta.startedAt as string).toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' });
    // 회의록은 정리본(군말·맞장구·잡담을 뺀 스크립트)으로 쓴다 — 내용의 양을 그대로 재고 곁가지를 덜 읽게 (사용자 요청).
    // 그래서 정리본을 먼저 만든다(회의록이 그만큼 늦게 나온다). 정리본이 통째로 실패하면 원본 녹취로
    let script = transcript;
    let cleaned = false;
    try {
      const r = await cleanScript(transcript, settings);
      writeFileAtomic(path.join(dir, 'script-clean.txt'), `${r.text}\n`);
      timing.scriptMs = Date.now() - t;
      if (r.text.trim()) [script, cleaned] = [r.text.trim(), true];
    } catch {}
    const tw = Date.now();
    const { text, provider } = await complete({
      system: minutesSystem(script, { cleaned }),
      // 사용자가 덧붙인 '녹음에 담기지 않은 내용' (가져오기 확인 창)
      input: `<meeting started="${when}" duration="${clock(durationSec)}">\n${script}\n</meeting>${meta.notes ? `\n<notes>\n${meta.notes}\n</notes>` : ''}`,
      choice: settings.provider,
      apiKey: apiKey(),
      effort: 'medium',
      timeouts: { 'claude-code': LONG_TIMEOUT_MS, codex: LONG_TIMEOUT_MS, api: LONG_TIMEOUT_MS },
      maxTokens: 16000,
    });
    timing.writeMs = Date.now() - tw;
    if (!text) throw new Error('회의록이 비어 있습니다');
    writeFileAtomic(path.join(dir, 'minutes.md'), `${text}\n`);
    // 확인 필요 항목 목록과 용어 설명을 함께 만든다 (어느 쪽이 실패해도 회의록은 그대로). 흐름도·액션은 사용자가 요청할 때만 (flow.js, actions.js)
    await Promise.all([makeReview(dir).catch(() => {}), makeGlossary(dir).catch(() => {})]);
    addCheckItems(dir, durationSec); // 형식 검사: LLM 없이 틀·시각·담당·기한의 근거를 보고 걸린 것을 확인 필요에
    const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
    report('done', { provider, title, ...diarizeInfo });
  } catch (err: any) {
    const error = err.killed ? '시간 초과' : err.message.split('\n')[0];
    // 회의록 쓰기는 인터넷이 필요하다. 끊겨서 실패했으면 연결이 돌아올 때 이어서 쓴다 (본체 src/app/minutes-run.mts)
    report('error', { stage, error, offline: stage === 'write' && !isOnline(), ...diarizeInfo });
  }
}
