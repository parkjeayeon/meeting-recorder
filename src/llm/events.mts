// CLI가 JSON 줄로 내는 이벤트에서 답을 꺼내고 "답이 다 됐다"를 정한다 (결정 80). 파일·프로세스를 쓰지 않는다 — providers.mts runLines가 쓴다.
// 모르는 이벤트·모양이 다른 값은 건너뛴다 → CLI가 바뀌어도 "프로세스가 끝날 때까지 기다리기"(예전 동작)로 물러날 뿐 깨지지 않는다.
import type { LineReader } from './providers.mjs';

// ok: false면 CLI가 실패를 알렸다 (text가 그 이유) — 실패한 종료와 같게 다룬다
export type Answer = { ok: boolean; text: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

// Claude Code: `--output-format stream-json --verbose --include-partial-messages` (2.1.311에서 확인)
//   stream_event{event: message_start → content_block_start{content_block:{type:'text'}} → content_block_delta{delta:{type:'text_delta',text}}…
//                → content_block_stop → message_delta{delta:{stop_reason}} → message_stop}
//   → rate_limit_event → system{subtype:'post_turn_summary'}(약 2~3초 걸림) → result{subtype, is_error, result} → 종료(약 0.5초)
// 도구를 껐으므로(--tools '') API 메시지 하나가 턴 전체다. 그 메시지가 end_turn으로 끝났고 글 덩어리가 꼭 하나일 때만 일찍 받는다.
// 다른 이유(max_tokens·refusal 등)로 끝났거나 글 덩어리가 여럿이면 result를 기다려 CLI가 낸 글을 쓴다 (예전 `--output-format text`가 찍던 글)
export function claudeReader(): LineReader<Answer> {
  let text = '';
  let textBlocks = 0;
  let stopReason: string | null = null;
  let result: string | null = null;
  return {
    text: () => result ?? text,
    line(ev) {
      if (!isObj(ev)) return undefined;
      if (ev.type === 'result') {
        const errors = Array.isArray(ev.errors) ? ev.errors.filter((e): e is string => typeof e === 'string') : [];
        result = str(ev.result) ?? errors.join('\n');
        return { ok: ev.is_error !== true && ev.subtype === 'success', text: result };
      }
      if (ev.type !== 'stream_event' || (ev.parent_tool_use_id ?? null) !== null || !isObj(ev.event)) return undefined;
      const e = ev.event;
      if (e.type === 'message_start') {
        // 다시 보내기 등으로 메시지가 새로 시작하면 처음부터
        text = '';
        textBlocks = 0;
        stopReason = null;
      } else if (e.type === 'content_block_start' && isObj(e.content_block) && e.content_block.type === 'text') {
        textBlocks += 1;
        text += str(e.content_block.text) ?? '';
      } else if (e.type === 'content_block_delta' && isObj(e.delta) && e.delta.type === 'text_delta') {
        text += str(e.delta.text) ?? '';
      } else if (e.type === 'message_delta' && isObj(e.delta)) {
        stopReason = str(e.delta.stop_reason) ?? stopReason;
      } else if (e.type === 'message_stop' && stopReason === 'end_turn' && textBlocks === 1) {
        return { ok: true, text };
      }
      return undefined;
    },
  };
}

// Codex: `codex exec --json` (0.169.0에서 확인)
//   thread.started → turn.started → item.completed{item:{type:'agent_message', text}}… → turn.completed{usage} → 종료(약 1초)
//   실패: error{message} → turn.failed{error:{message}} → 종료 코드 1. 경고는 item.completed{item:{type:'error', message}}
// 답은 마지막 agent_message (-o 파일에 쓰이는 글과 같다). turn.completed에서 정한다. agent_message가 없으면 정하지 않는다(→ -o 파일)
export function codexReader(): LineReader<Answer> {
  let last: string | null = null;
  const errors: string[] = [];
  return {
    text: () => [last ?? '', ...errors].filter(Boolean).join('\n'),
    line(ev) {
      if (!isObj(ev)) return undefined;
      if (ev.type === 'item.completed' && isObj(ev.item) && ev.item.type === 'agent_message') {
        last = str(ev.item.text) ?? last;
      } else if (ev.type === 'error') {
        const m = str(ev.message);
        if (m) errors.push(m);
      } else if (ev.type === 'turn.failed') {
        const m = isObj(ev.error) ? str(ev.error.message) : null;
        if (m && errors.at(-1) !== m) errors.push(m);
        return { ok: false, text: errors.join('\n') };
      } else if (ev.type === 'turn.completed' && last !== null) {
        return { ok: true, text: last };
      }
      return undefined;
    },
  };
}
